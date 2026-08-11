import { NextRequest, NextResponse } from 'next/server'
import { isMockMode, refundCredits, resolveKeyAndCredits } from '../../../studio/_lib/openrouter'
import { callLlm, providerHeaders, LLM_LONG_BUDGET_MS } from '../../../studio/_lib/llm'
import { OPENROUTER_FALLBACK_MODEL } from '../../../studio/_lib/llm/config'

export const maxDuration = 120

// AniBuddy is a NON-GENERATIVE feature (F9 §2). This route may only call a
// text/vision reasoning model. It must never call an image model, and never
// /api/studio/generate. All it produces is a string the user copies into a
// third-party image tool of their own choosing.
const DEFAULT_MODEL = OPENROUTER_FALLBACK_MODEL

const VIEWS = { front: 'front-facing', 'three-quarter': 'three-quarter' } as const
type View = keyof typeof VIEWS

const MOCK_PROMPT =
  'Full-body mock character, single subject, front-facing, clean readable silhouette, arms held clear of the torso, consistent proportions, flat removable background, no scenery or text.'

/** The rig can only fit art that satisfies these; the prompt has to demand them. */
const REQUIREMENTS = [
  'exactly one character, alone in frame',
  'the entire body visible, nothing cropped',
  'a clean, readable silhouette',
  'arms held clear of the torso so they read as separate shapes',
  'consistent, unexaggerated proportions',
  'a transparent or flat single-colour background that is easy to remove',
  'no scenery, props, text, watermarks, borders, or extra characters',
]

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: { text?: string }) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
  }
  return ''
}

/** Strip fences and any leading "Prompt:" label the model may prepend. */
function cleanPrompt(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^(?:prompt|output)\s*[:\-]\s*/i, '')
    .replace(/^["'`]|["'`]$/g, '')
    .trim()
}

export async function POST(request: NextRequest) {
  try {
    const { idea, view, model } = await request.json()

    if (!idea || typeof idea !== 'string' || !idea.trim()) {
      return NextResponse.json({ error: 'Describe the character you want' }, { status: 400 })
    }

    const requestedView: View = view === 'three-quarter' ? 'three-quarter' : 'front'
    const modelId = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL

    const auth = await resolveKeyAndCredits(request, 'anibuddy-prompt', modelId, 1)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
    }

    if (isMockMode()) {
      return NextResponse.json({ prompt: MOCK_PROMPT })
    }

    const systemPrompt = `You write image prompts for an EXTERNAL image tool. You do not generate images yourself.

The resulting artwork will be rigged as a 2D puppet: a mesh is fitted to the silhouette and bent by a skeleton. Art that fails the requirements below cannot be rigged, so the prompt must state each one explicitly.

Requirements the prompt must demand:
${REQUIREMENTS.map((line) => `- ${line}`).join('\n')}
- a ${VIEWS[requestedView]} view

Write ONE paragraph, 40-90 words, in the flat comma-separated style image tools respond to. Describe the user's character concretely — subject, clothing, colours, art style — then state the framing and background requirements. Output the prompt text alone: no preamble, no explanation, no markdown, no quotes.`

    const userPrompt = `Character idea: "${idea.trim()}"

Write the image prompt.`

    const result = await callLlm({
      byok: auth.byok,
      key: auth.key,
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 400,
      // Low: this is a constraint-carrying prompt, not a creative act. The
      // creativity belongs to the user's idea and their image tool.
      temperature: 0.4,
      title: 'AniBuddy - External Art Prompt',
      referer: request.headers.get('referer'),
      signal: request.signal,
      budgetMs: LLM_LONG_BUDGET_MS,
    })

    if (!result.ok) {
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId)
      return NextResponse.json(
        { error: result.error || 'Failed to write a prompt' },
        { status: result.status || 502 }
      )
    }

    const prompt = cleanPrompt(extractText(result.data.choices?.[0]?.message?.content))
    if (prompt.length < 40) {
      // Too short to carry the requirements, so it is not worth a credit.
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId)
      return NextResponse.json({ error: 'The model returned no usable prompt' }, { status: 502 })
    }

    return NextResponse.json({ prompt }, { headers: providerHeaders(result) })
  } catch (error) {
    console.error('Error in anibuddy/prompt route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
