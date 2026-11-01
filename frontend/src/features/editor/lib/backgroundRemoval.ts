import type { BackgroundRemovalMode, SheetBackground } from "@/types";

/** What the server can do about a background (from GET /api/plans/me). */
export interface BackgroundCapabilities {
  /** Our own flat and chroma-key keyer: free, every provider. */
  server: boolean;
  /** The provider's AI removal: paid, not on local storage. */
  ai: boolean;
  /** Part of the API, but the UI does not name the provider. */
  aiProvider: "Cloudinary" | "ImageKit" | null;
}

/**
 * The server's background capabilities, or null until the plan has loaded. A server from before the
 * `backgroundRemoval` capability existed only keyed on local storage and only ever sent `enclosedBackground`
 * there, so its answer is mapped to the same two facts.
 */
export function readBackgroundCapabilities(
  capabilities:
    | { enclosedBackground?: boolean; aiUpscale?: boolean; backgroundRemoval?: BackgroundCapabilities }
    | undefined,
): BackgroundCapabilities | null {
  if (!capabilities) return null;
  if (capabilities.backgroundRemoval) return capabilities.backgroundRemoval;
  return { server: capabilities.enclosedBackground === true, ai: capabilities.aiUpscale === true, aiProvider: null };
}

/** A plain name for the background colour: White, Black, or just the hex. */
function colourLabel(kind: "flat" | "chroma", hex: string | undefined): string {
  const colour = hex?.toUpperCase();
  if (!colour) return kind === "chroma" ? "Chroma-key" : "Flat colour";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16));
  if (Math.min(r, g, b) >= 225) return "White";
  if (Math.max(r, g, b) <= 30) return "Black";
  return kind === "chroma" ? "Chroma-key" : "Flat colour";
}

export type RemovalMethod = "server" | "ai" | "none";

/** What "Name and export" will do with the background for the chosen mode, from the job's classification. */
export function plannedMethod(
  background: SheetBackground | undefined,
  mode: BackgroundRemovalMode,
  caps: BackgroundCapabilities | null,
): RemovalMethod | "unknown" {
  if (mode === "none") return "none";
  if (background?.kind === "transparent") return "none";
  const plain = background?.kind === "flat" || background?.kind === "chroma";
  if (mode === "flat") return background && !plain ? "none" : "server";
  if (mode === "ai") return caps?.ai ? "ai" : "none";
  // auto
  if (!background) return "unknown";
  if (plain) return "server";
  return caps?.ai ? "ai" : "none";
}

/** The "Also remove enclosed background" switch applies whenever our keyer will run (or might, for a sheet not classified). */
export function keyerMayRun(
  background: SheetBackground | undefined,
  mode: BackgroundRemovalMode,
  caps: BackgroundCapabilities | null,
): boolean {
  if (!caps?.server) return false;
  const method = plannedMethod(background, mode, caps);
  return method === "server" || method === "unknown";
}

export type StatusTone = "ok" | "note" | "warn";

/** The status line under "Background removal": what will happen to this sheet's background, in plain words. */
export function describeBackground(
  background: SheetBackground | undefined,
  mode: BackgroundRemovalMode,
  caps: BackgroundCapabilities | null,
): { text: string; tone: StatusTone } {
  if (!caps) return { text: "Checking what this server can do.", tone: "note" };
  if (background?.kind === "transparent") return { text: "Already transparent.", tone: "ok" };
  const plain = background?.kind === "flat" || background?.kind === "chroma";
  const sheet = plain
    ? `${colourLabel(background.kind as "flat" | "chroma", background.color)} background${background.color ? ` (${background.color.toUpperCase()})` : ""}`
    : background
      ? "Gradient or textured background"
      : "Background not checked yet";

  switch (plannedMethod(background, mode, caps)) {
    case "server":
      return { text: `${sheet}: removed on our server, free.`, tone: "ok" };
    case "ai":
      return { text: `${sheet}: AI removal.`, tone: "warn" };
    case "unknown":
      return { text: "Background not checked yet. It is checked when you export: plain colours are removed free.", tone: "note" };
    default:
      if (mode === "none") return { text: `${sheet}: kept as it is.`, tone: "note" };
      if (mode === "flat") return { text: `${sheet}: not one plain colour, so it will be kept.`, tone: "warn" };
      return {
        text: `${sheet}. AI removal is not available on this server; the background will be kept.`,
        tone: "warn",
      };
  }
}

/** Why the AI option is disabled, or null when it can be chosen. */
export function aiUnavailableReason(caps: BackgroundCapabilities | null): string | null {
  if (!caps) return "Checking what this server can do.";
  return caps.ai ? null : "Not available on this server.";
}
