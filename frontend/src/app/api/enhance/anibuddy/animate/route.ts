import { NextRequest, NextResponse } from "next/server";
import { isMockMode, refundCredits, resolveKeyAndCredits } from "../../../studio/_lib/openrouter";
import { callLlm, providerHeaders } from "../../../studio/_lib/llm";
import type { LlmContentPart } from "../../../studio/_lib/llm";
import { MAX_KEYFRAMES, type Clip, type JointPose } from "@/features/anibuddy/types";

export const maxDuration = 120;

const ANIMATION_TOTAL_BUDGET_MS = 105_000;
const FIRST_ATTEMPT_BUDGET_MS = 60_000;

const ANIMATION_OPENQUOTA_GEMINI_MODEL =
  process.env.ANIBUDDY_ANIMATE_OPENQUOTA_MODEL || "google/gemini-2.5-flash";
const ANIMATION_OPENQUOTA_AUTO_MODEL = process.env.ANIBUDDY_ANIMATE_OPENQUOTA_FALLBACK_MODEL || "auto";
const ANIMATION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "anibuddy_animation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", minLength: 1, maxLength: 80 },
        loop: { type: "boolean" },
        keyframes: {
          type: "array", minItems: 2, maxItems: MAX_KEYFRAMES,
          items: {
            type: "object", additionalProperties: false,
            properties: {
              t: { type: "number", minimum: 0, maximum: 1 },
              joints: {
                type: "array", minItems: 1, maxItems: 48,
                items: {
                  type: "object", additionalProperties: false,
                  properties: {
                    id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,24}$" },
                    rot: { type: ["number", "null"], minimum: -170, maximum: 170 },
                    tx: { type: ["number", "null"], minimum: -0.4, maximum: 0.4 },
                    ty: { type: ["number", "null"], minimum: -0.4, maximum: 0.4 },
                    scale: { type: ["number", "null"], minimum: 0.2, maximum: 5 },
                  },
                  required: ["id", "rot", "tx", "ty", "scale"],
                },
              },
              ease: { type: "string", enum: ["linear", "ease", "hold"] },
            },
            required: ["t", "joints", "ease"],
          },
        },
        warnings: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 240 } },
      },
      required: ["name", "loop", "keyframes", "warnings"],
    },
  },
} as const;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content.map((part: { text?: string }) => typeof part?.text === "string" ? part.text : "").join("")
    : "";
}
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
    if (!Array.isArray(key.joints) || key.joints.length === 0) return null;
    const joints: Record<string, JointPose> = {};
    for (const entry of key.joints) {
      if (!entry || typeof entry !== "object") return null;
      const channels = entry as Record<string, unknown>;
      const id = typeof channels.id === "string" ? channels.id : "";
      if (!knownIds.has(id) || !channels || typeof channels !== "object") return null;
      const pose: JointPose = {};
      for (const name of ["rot", "tx", "ty", "scale"] as const) {
        const raw = (channels as Record<string, unknown>)[name];
        if (raw === undefined || raw === null) continue;
        const n = Number(raw);
        const minimum = name === "rot" ? -170 : name === "scale" ? 0.2 : -0.4;
        const maximum = name === "rot" ? 170 : name === "scale" ? 5 : 0.4;
        if (!Number.isFinite(n) || n < minimum || n > maximum) return null;
        pose[name] = n;
      }
      if (Object.keys(pose).length === 0) return null;
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
    const model = ANIMATION_OPENQUOTA_GEMINI_MODEL;
    const auth = await resolveKeyAndCredits(request, "anibuddy-animate", model, 1, { allowByok: false });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    if (isMockMode()) {
      const root = joints.find((joint: { parent?: unknown }) => joint.parent === null)?.id ?? joints[0].id;
      return NextResponse.json({ clip: { id: crypto.randomUUID(), name: "Gentle breathing", request: body.request, loop: true, source: "model", keyframes: [{ t: 0, joints: { [root]: { ty: 0 } } }, { t: 0.5, joints: { [root]: { ty: -0.03 } } }] }, warnings: [] });
    }
    const system = `You author sparse 2D-puppet keyframes, never images. Return the schema exactly. Keyframes are strictly increasing t=0..1; the first is t=0; use 2 to ${MAX_KEYFRAMES} keyframes. Joint ids and roles: ${JSON.stringify(joints.map((joint: { id: string; role?: string; x?: number; y?: number; parent?: string | null }) => joint))}. rot is local clockwise degrees in [-170,170]; tx/ty are figure-height fractions in [-0.4,0.4]; scale is in [0.2,5]. Only use supplied joint ids.`;
    const callAnimation = (instruction: string, budgetMs: number) => {
      const content: LlmContentPart[] = [
        { type: "text", text: instruction },
        { type: "image_url", image_url: { url: body.image } },
      ];
      return callLlm({
        byok: false, key: auth.key, model, openQuotaOnly: true, openQuotaModel: ANIMATION_OPENQUOTA_GEMINI_MODEL, openQuotaFallbackModel: ANIMATION_OPENQUOTA_AUTO_MODEL, responseFormat: ANIMATION_RESPONSE_FORMAT,
        messages: [{ role: "system", content: system }, { role: "user", content }],
        maxTokens: 2400, temperature: 0.1, title: "AniBuddy - Animate",
        referer: request.headers.get("referer"), signal: request.signal, budgetMs,
      });
    };

    const started = Date.now();
    let result = await callAnimation(`Create this motion: ${body.request}`, FIRST_ATTEMPT_BUDGET_MS);
    let parsed = result.ok ? parse(extractText(result.data.choices?.[0]?.message?.content)) : null;
    let clip = parsed && clipFrom(parsed, ids, body.request);
    if (result.ok && !clip) {
      console.warn("[anibuddy][animate] retrying invalid animation", { provider: result.provider });
      const remainingBudget = ANIMATION_TOTAL_BUDGET_MS - (Date.now() - started);
      if (remainingBudget >= 5_000) {
        result = await callAnimation("Your prior response did not meet the required keyframe contract. Return a complete corrected replacement only.", remainingBudget);
        parsed = result.ok ? parse(extractText(result.data.choices?.[0]?.message?.content)) : null;
        clip = parsed && clipFrom(parsed, ids, body.request);
      }
    }

    if (!clip) {
      console.warn("[anibuddy][animate] animation rejected", {
        provider: result.provider,
        status: result.ok ? 422 : result.status,
        reason: result.ok ? "invalid_keyframe_contract" : "provider_failure",
      });
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId);
      return NextResponse.json(
        { error: result.ok ? "Automatic animation could not produce a valid keyframe clip. Please retry or animate it by hand." : result.error || "Animation failed", code: result.ok ? "ANIMATION_INVALID" : undefined },
        { status: result.ok ? 422 : result.status || 502 },
      );
    }
    return NextResponse.json({ clip, warnings: Array.isArray(parsed?.warnings) ? parsed.warnings.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, 6) : [] }, { headers: providerHeaders(result) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 }); }
}
