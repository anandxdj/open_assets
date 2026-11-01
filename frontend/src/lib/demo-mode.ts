/** What the server reports at /api/studio/status. */
export interface AiStatus {
  /** True when every AI route answers with procedural placeholders instead of calling a provider. */
  mock: boolean;
  /** True when the server holds an OpenRouter or Open Quota key. */
  providerConfigured: boolean;
}

export const PLACEHOLDER_LABEL = "Placeholder";

/**
 * The notice shown near a generate action while the server is in demo mode, or null when results
 * are real. It says what is happening and, when it is a missing key, the one thing that fixes it.
 */
export function demoModeMessage(status: AiStatus | null): string | null {
  if (!status?.mock) return null;
  if (status.providerConfigured) {
    return "Demo mode is switched on for this server, so results are placeholders. Turn it off to generate real art.";
  }
  return "No AI provider is configured, so results are placeholders. Add an OpenRouter or Open Quota key to generate real art.";
}
