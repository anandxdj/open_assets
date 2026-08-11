import { NextRequest, NextResponse } from "next/server";
import { isMockMode, refundCredits, resolveKeyAndCredits } from "../../../studio/_lib/openrouter";
import { callLlm, providerHeaders, LLM_LONG_BUDGET_MS } from "../../../studio/_lib/llm";
import { OPENROUTER_FALLBACK_MODEL } from "../../../studio/_lib/llm/config";
import type { LlmContentPart } from "../../../studio/_lib/llm";
import { MAX_KEYFRAMES, type Clip, type JointPose } from "@/features/anibuddy/types";

export const maxDuration = 120;

function parse(raw: unknown): Record<string, unknown> | null {
  const text = typeof raw === "string" ? raw : Array.isArray(raw)
    ? raw.map((part: { text?: string }) => part.text ?? "").join("") : "";
  const source = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(source) as Record<string, unknown>; } catch {
    const start = source.indexOf("{"); const end = source.lastIndexOf("}");
    try { return start >= 0 && end > start ? JSON.parse(source.slice(start, end + 1)) as Record<string, unknown> : null; } catch { return null; }
  }
}

function clipFrom(value: unknown, knownIds: Set<string>, request: string): Clip | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.keyframes) || input.keyframes.length < 2 || input.keyframes.length > MAX_KEYFRAMES) return null;
  let previous = -1;
  const keyframes = [] as Clip["keyframes"];
  for (const item of input.keyframes) {
    if (!item || typeof item !== "object") return null;
    const key = item as Record<string, unknown>; const t = Number(key.t);
    if (!Number.isFinite(t) || t < 0 || t > 1 || t <= previous) return null;
    previous = t;
    if (!key.joints || typeof key.joints !== "object" || Array.isArray(key.joints)) return null;
    const joints: Record<string, JointPose> = {};
    for (const [id, channels] of Object.entries(key.joints as Record<string, unknown>)) {
      if (!knownIds.has(id) || !channels || typeof channels !== "object") return null;
      const pose: JointPose = {};
      for (const name of ["rot", "tx", "ty", "scale"] as const) {
        const n = Number((channels as Record<string, unknown>)[name]);
        if ((channels as Record<string, unknown>)[name] !== undefined) {
          if (!Number.isFinite(n) || (name === "scale" && (n < 0.2 || n > 5))) return null;
          pose[name] = n;
        }
      }
      joints[id] = pose;
    }
    keyframes.push({ t, joints, ease: key.ease === "linear" || key.ease === "hold" ? key.ease : "ease" });
  }
  if (keyframes[0].t !== 0) return null;
  return { id: crypto.randomUUID(), name: typeof input.name === "string" ? input.name.slice(0, 80) : "Generated motion", request, loop: input.loop !== false, keyframes, source: "model" };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) return NextResponse.json({ error: "A prepared image data URL is required" }, { status: 400 });
    if (typeof body.request !== "string" || !body.request.trim() || body.request.length > 500) return NextResponse.json({ error: "Describe a motion in 1–500 characters" }, { status: 400 });
    const joints = Array.isArray(body.rig?.joints) ? body.rig.joints : [];
    const ids = new Set<string>(joints.map((joint: { id?: unknown }) => joint.id).filter((id: unknown): id is string => typeof id === "string"));
    if (ids.size < 3) return NextResponse.json({ error: "A valid rig is required" }, { status: 400 });
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : OPENROUTER_FALLBACK_MODEL;
    const auth = await resolveKeyAndCredits(request, "anibuddy-animate", model, 1);
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    if (isMockMode()) {
      const root = joints.find((joint: { parent?: unknown }) => joint.parent === null)?.id ?? joints[0].id;
      return NextResponse.json({ clip: { id: crypto.randomUUID(), name: "Gentle breathing", request: body.request, loop: true, source: "model", keyframes: [{ t: 0, joints: { [root]: { ty: 0 } } }, { t: 0.5, joints: { [root]: { ty: -0.03 } } }] }, warnings: [] });
    }
    const system = `You author sparse 2D-puppet keyframes, never images. Return strict JSON {name,loop,keyframes,warnings}. Keyframes are strictly increasing t=0..1; first t is 0; at most ${MAX_KEYFRAMES}. Joint ids and roles: ${JSON.stringify(joints.map((joint: { id: string; role?: string; x?: number; y?: number; parent?: string | null }) => joint))}. rot is local clockwise degrees; tx/ty are figure-height fractions; scale is 0.2..5. Only use supplied joint ids.`;
    const content: LlmContentPart[] = [{ type: "text", text: `Animate this rig: ${body.request}` }, { type: "image_url", image_url: { url: body.image } }];
    const result = await callLlm({ byok: auth.byok, key: auth.key, model, messages: [{ role: "system", content: system }, { role: "user", content }], maxTokens: 2400, temperature: 0.2, title: "AniBuddy - Animate", referer: request.headers.get("referer"), signal: request.signal, budgetMs: LLM_LONG_BUDGET_MS });
    const parsed = result.ok ? parse(result.data.choices?.[0]?.message?.content) : null;
    const clip = parsed && clipFrom(parsed, ids, body.request);
    if (!clip) { if (!auth.byok && auth.eventId) await refundCredits(auth.eventId); return NextResponse.json({ error: result.ok ? "The model returned an invalid animation" : result.error || "Animation failed" }, { status: result.ok ? 502 : result.status || 502 }); }
    return NextResponse.json({ clip, warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((v): v is string => typeof v === "string").slice(0, 6) : [] }, { headers: providerHeaders(result) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 }); }
}
