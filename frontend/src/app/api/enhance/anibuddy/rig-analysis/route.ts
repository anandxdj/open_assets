import { NextRequest, NextResponse } from 'next/server'
import { isMockMode, refundCredits, resolveKeyAndCredits } from '../../../studio/_lib/openrouter'
import { callLlm, providerHeaders, LLM_LONG_BUDGET_MS } from '../../../studio/_lib/llm'
import { OPENROUTER_FALLBACK_MODEL } from '../../../studio/_lib/llm/config'
import type { LlmContentPart } from '../../../studio/_lib/llm'

export const maxDuration = 120

// AniBuddy is a NON-GENERATIVE feature (F9 §2). This route may only call a
// text/vision reasoning model. It must never call an image model, and never
// /api/studio/generate. It READS the user's prepared artwork and returns
// coordinates describing it. No pixels are produced anywhere in this file.
const DEFAULT_MODEL = OPENROUTER_FALLBACK_MODEL

// Deliberate narrowing of F9 §4, which describes this endpoint as returning
// joints, mesh topology, weights and templates. Only joints and templates are
// asked for here; mesh and weights are derived deterministically on the client
// (features/anibuddy/lib/mesh.ts).
//
// A few hundred triangles plus a full weight matrix is a large, error-prone
// payload, and a hallucinated triangle produces deformation that is visibly
// broken with no way for the user to diagnose it. Joints are ~32 numbers a
// vision model estimates well, and they are directly draggable.
const JOINT_IDS = [
  'hip',
  'torso',
  'neck',
  'head',
  'eyeA',
  'eyeB',
  'shoulderA',
  'elbowA',
  'handA',
  'shoulderB',
  'elbowB',
  'handB',
  'kneeA',
  'footA',
  'kneeB',
  'footB',
] as const

const BODY_PLANS = ['biped', 'quadruped', 'serpent', 'flyer', 'blob'] as const
const MOTIONS = ['idle', 'bounce', 'wave', 'blink'] as const

/** Mock fixture: a plausible front-facing biped, so OPENROUTER_MOCK=1 exercises
 *  the whole client pipeline (harden → mesh → weights → deform) at zero spend. */
const MOCK_ANALYSIS = {
  bodyPlan: 'biped',
  joints: [
    { id: 'hip', x: 0.5, y: 0.56 },
    { id: 'torso', x: 0.5, y: 0.34 },
    { id: 'neck', x: 0.5, y: 0.28 },
    { id: 'head', x: 0.5, y: 0.16 },
    { id: 'eyeA', x: 0.44, y: 0.14 },
    { id: 'eyeB', x: 0.56, y: 0.14 },
    { id: 'shoulderA', x: 0.38, y: 0.33 },
    { id: 'elbowA', x: 0.33, y: 0.45 },
    { id: 'handA', x: 0.3, y: 0.57 },
    { id: 'shoulderB', x: 0.62, y: 0.33 },
    { id: 'elbowB', x: 0.67, y: 0.45 },
    { id: 'handB', x: 0.7, y: 0.57 },
    { id: 'kneeA', x: 0.44, y: 0.78 },
    { id: 'footA', x: 0.44, y: 0.98 },
    { id: 'kneeB', x: 0.56, y: 0.78 },
    { id: 'footB', x: 0.56, y: 0.98 },
  ],
  supported: ['idle', 'bounce', 'wave', 'blink'],
  warnings: [],
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: { text?: string }) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
  }
  return ''
}

/** Loose JSON extraction, same approach as sprite-review: strip fences, then
 *  fall back to the outermost {...} slice. */
function parseAnalysis(raw: string): Record<string, unknown> | null {
  if (!raw) return null
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  const tryParse = (value: string): unknown => {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }

  let data = tryParse(text)
  if (!data) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) data = tryParse(text.slice(start, end + 1))
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

/** Keep only recognised ids with finite, in-range coordinates. The client
 *  hardens again — this just avoids shipping obvious garbage over the wire. */
function sanitizeJoints(value: unknown) {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const joints: Array<{ id: string; x: number; y: number }> = []

  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Record<string, unknown>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    if (!(JOINT_IDS as readonly string[]).includes(id) || seen.has(id)) continue
    const x = Number(candidate.x)
    const y = Number(candidate.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    seen.add(id)
    joints.push({ id, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) })
  }
  return joints
}

export async function POST(request: NextRequest) {
  try {
    const { image, model } = await request.json()

    // Mirrors sprite-review's guard: only accept an inline data URL, never a
    // remote reference this server would then go and fetch.
    if (typeof image !== 'string' || !image.startsWith('data:image/')) {
      return NextResponse.json(
        { error: 'A prepared image data URL is required' },
        { status: 400 }
      )
    }

    const modelId = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL

    const auth = await resolveKeyAndCredits(request, 'anibuddy-rig', modelId, 1)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
    }

    if (isMockMode()) {
      return NextResponse.json(MOCK_ANALYSIS)
    }

    const systemPrompt = `You locate skeleton joints in a single piece of character artwork so it can be animated as a 2D puppet. You do not draw or modify the image.

Coordinates are NORMALIZED: x = 0 at the left edge, 1 at the right edge; y = 0 at the top edge, 1 at the bottom edge. Report where each joint appears IN THIS IMAGE. Precision matters more than completeness — a joint placed on the wrong body part bends the artwork incorrectly.

Joint ids, and where each belongs:
- hip: pelvis centre
- torso: chest centre, at the shoulder line
- neck: base of the neck
- head: centre of the head
- eyeA / eyeB: the two eyes (A = the one further LEFT in the image)
- shoulderA / elbowA / handA: the arm further LEFT in the image
- shoulderB / elbowB / handB: the arm further RIGHT in the image
- kneeA / footA: the leg further LEFT in the image
- kneeB / footB: the leg further RIGHT in the image

Omit any joint whose body part is not visible — do NOT guess a position for a hidden or absent limb.

Also judge which motion templates this artwork can support:
- idle: always supported
- bounce: always supported
- wave: only if an arm is drawn clear of the torso, so it can rotate without tearing the body
- blink: only if the eyes are visible

Body plan is one of: ${BODY_PLANS.join(', ')}.

Output STRICT JSON only — no prose, no markdown fences:
{"bodyPlan":"biped","joints":[{"id":"hip","x":0.5,"y":0.55}],"supported":["idle","bounce"],"warnings":["one short sentence per limitation, addressed to the artist"]}`

    const content: LlmContentPart[] = [
      {
        type: 'text',
        text: 'Locate the joints in this character artwork and judge which motions it supports. Strict JSON only.',
      },
      { type: 'image_url', image_url: { url: image } },
    ]

    const result = await callLlm({
      byok: auth.byok,
      key: auth.key,
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      maxTokens: 1200,
      // Low: this is measurement, not invention.
      temperature: 0.2,
      title: 'AniBuddy - Rig Analysis',
      referer: request.headers.get('referer'),
      signal: request.signal,
      budgetMs: LLM_LONG_BUDGET_MS,
    })

    if (!result.ok) {
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId)
      return NextResponse.json(
        { error: result.error || 'Rig analysis failed' },
        { status: result.status || 502 }
      )
    }

    const parsed = parseAnalysis(extractText(result.data.choices?.[0]?.message?.content))
    const joints = sanitizeJoints(parsed?.joints)

    // Fail loudly rather than defaulting, unlike sprite-review's "treat as
    // approved" fallback. A silently empty rig would strand the user on the rig
    // step with nothing to edit and no explanation.
    if (joints.length < 3) {
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId)
      return NextResponse.json(
        { error: 'The model could not locate joints in this artwork. Try clearer, full-body art.' },
        { status: 502 }
      )
    }

    const bodyPlan = (BODY_PLANS as readonly string[]).includes(String(parsed?.bodyPlan))
      ? String(parsed?.bodyPlan)
      : 'biped'

    const supported = Array.isArray(parsed?.supported)
      ? (parsed.supported as unknown[])
          .map((entry) => String(entry))
          .filter((entry) => (MOTIONS as readonly string[]).includes(entry))
      : ['idle', 'bounce']

    const warnings = Array.isArray(parsed?.warnings)
      ? (parsed.warnings as unknown[])
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim())
          .slice(0, 6)
      : []

    return NextResponse.json(
      { bodyPlan, joints, supported, warnings },
      { headers: providerHeaders(result) }
    )
  } catch (error) {
    console.error('Error in anibuddy/rig-analysis route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
