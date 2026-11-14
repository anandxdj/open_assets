// What the server will do with an AI request, for the Studio and AniBuddy screens to show.
// Pure and secret-free: it reports whether keys exist, never their values.
import type { AiStatus } from '@/lib/demo-mode'

export function getAiStatus(env: Record<string, string | undefined> = process.env): AiStatus {
  return {
    mock: env.OPENROUTER_MOCK === '1',
    providerConfigured: Boolean(env.OPENROUTER_API_KEY?.trim() || env.OPENQUOTA_API_KEY?.trim()),
  }
}
