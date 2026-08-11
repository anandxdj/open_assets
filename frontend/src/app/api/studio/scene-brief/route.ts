// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender
// Derives a shared parallax scene brief from the Near-layer anchor prompt.
import { NextRequest, NextResponse } from 'next/server'
import { isMockMode, refundCredits, resolveKeyAndCredits } from '../_lib/openrouter'
import { callLlm, providerHeaders } from '../_lib/llm'
import { OPENROUTER_FALLBACK_MODEL } from '../_lib/llm/config'

export const maxDuration = 60

const DEFAULT_MODEL = OPENROUTER_FALLBACK_MODEL

const artStyleDescriptions: Record<string, string> = {
  cinematic: 'cinematic photography with dramatic lighting and film grain',
  vintage: 'vintage film photography with faded colors and retro feel',
  'black-white': 'black and white photography with rich contrast',
  'oil-painting': 'oil painting style with visible brush strokes and rich textures',
  watercolor: 'watercolor painting with soft washes and flowing colors',
  impressionism: 'impressionist painting style with loose brushwork',
  'digital-art': 'digital art with smooth gradients and modern aesthetics',
  cyberpunk: 'cyberpunk style with neon colors and futuristic elements',
  vaporwave: 'vaporwave aesthetic with pastel colors and retro-futuristic vibes',
  'low-poly': 'low poly 3D art with geometric faceted surfaces',
  'pixel-art': 'pixel art style with retro video game aesthetics',
  '3d-render': '3D rendered look with realistic lighting and materials',
  anime: 'anime/manga style with bold lines and vibrant colors',
  cartoon: 'cartoon illustration with exaggerated features',
  'studio-ghibli': 'Studio Ghibli animation style with whimsical hand-drawn aesthetics',
  fantasy: 'fantasy art with magical and ethereal elements',
  'sci-fi': 'science fiction with futuristic technology and environments',
}

export async function POST(request: NextRequest) {
  try {
    const { anchorPrompt, artStyle, model } = await request.json()

    if (!anchorPrompt || typeof anchorPrompt !== 'string' || !anchorPrompt.trim()) {
      return NextResponse.json({ error: 'Missing anchor prompt' }, { status: 400 })
    }

    const modelId = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL

    const auth = await resolveKeyAndCredits(request, 'scene-brief', modelId, 1)
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status })
    }

    if (isMockMode()) {
      return NextResponse.json({
        sceneBrief:
          'A tranquil pine valley at golden hour. Warm amber rim light with soft ambient fill, horizontally even with no directional sun. Palette: deep forest green, warm ochre, dusty teal sky. Painterly digital art with crisp silhouettes. Calm, slightly nostalgic mood.',
      })
    }

    const styleLine =
      artStyle && artStyleDescriptions[artStyle]
        ? `\nArt style: ${artStyleDescriptions[artStyle]}.`
        : ''

    const systemPrompt = `You help game designers build multi-layer parallax backgrounds. Given the prompt used for the NEAR (foreground) anchor layer, write a concise SCENE BRIEF that every other layer (mid-ground, far distance, sky/back) must follow so the final composite feels like one cohesive world.

Rules for your brief:
- 3–5 sentences, plain text only — no markdown, no bullet lists, no headers.
- Capture: setting/environment, time of day, lighting quality, color palette (name specific colors), art style, mood/atmosphere.
- Lighting must be ambient and horizontally even (no sun/moon on one side) because the sky layer will tile horizontally in-game.
- Write as instructions an artist would follow when painting matching layers behind the foreground — not layer-specific composition rules.
- Do NOT repeat the anchor prompt verbatim; distill the shared art direction.`

    const userPrompt = `Near (foreground) layer prompt:
"${anchorPrompt.trim()}"${styleLine}

Write the shared scene brief for all parallax layers.`

    const result = await callLlm({
      byok: auth.byok,
      key: auth.key,
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 400,
      temperature: 0.4,
      title: 'OpenAssets Studio - Scene Brief',
      referer: request.headers.get('referer'),
      signal: request.signal,
    })

    if (!result.ok) {
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId)
      return NextResponse.json(
        { error: result.error || 'Failed to generate scene brief' },
        { status: result.status || 502 },
      )
    }

    const data = result.data
    const content = data.choices?.[0]?.message?.content
    const sceneBrief =
      typeof content === 'string'
        ? content.trim()
        : Array.isArray(content)
          ? content
              .map((p: { text?: string; type?: string }) =>
                typeof p?.text === 'string' ? p.text : '',
              )
              .join('')
              .trim()
          : ''

    if (!sceneBrief) {
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId)
      return NextResponse.json({ error: 'No scene brief returned from model' }, { status: 500 })
    }

    return NextResponse.json({ sceneBrief }, { headers: providerHeaders(result) })
  } catch (error) {
    console.error('Error in scene-brief route:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    )
  }
}
