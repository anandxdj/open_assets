import { NextRequest, NextResponse } from "next/server";

import { isMockMode, refundCredits, resolveKeyAndCredits } from "../../../studio/_lib/openrouter";
import { callLlm, providerHeaders, LLM_LONG_BUDGET_MS } from "../../../studio/_lib/llm";
import type { LlmContentPart } from "../../../studio/_lib/llm";

export const maxDuration = 120;

// AniBuddy only describes the user's supplied image; it never generates pixels.
// The first Open Quota attempt is an explicitly configured Gemini vision model.
// `auto` is retained as a provider fallback for deployments where that model is
// temporarily unavailable or exhausted.
const RIG_OPENQUOTA_GEMINI_MODEL =
  process.env.ANIBUDDY_RIG_OPENQUOTA_MODEL || "google/gemini-2.5-flash";
const RIG_OPENQUOTA_AUTO_MODEL = process.env.ANIBUDDY_RIG_OPENQUOTA_FALLBACK_MODEL || "auto";
const ROLES = [
  "root", "spine", "head", "eye", "jaw", "limbUpper", "limbLower",
  "limbTip", "tail", "wing", "ear", "prop", "other",
] as const;

interface RigJoint {
  id: string;
  name: string;
  role: (typeof ROLES)[number];
  x: number;
  y: number;
  parent: string | null;
}

interface ValidAnalysis {
  joints: RigJoint[];
  warnings: string[];
}

type Validation = { ok: true; value: ValidAnalysis } | { ok: false; error: string };

const RIG_ANALYSIS_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "anibuddy_rig_analysis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        joints: {
          type: "array",
          minItems: 3,
          maxItems: 48,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", pattern: "^[A-Za-z0-9_-]{1,24}$" },
              name: { type: "string", minLength: 1, maxLength: 80 },
              role: { type: "string", enum: ROLES },
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              parent: { type: ["string", "null"] },
            },
            required: ["id", "name", "role", "x", "y", "parent"],
          },
        },
        warnings: {
          type: "array",
          maxItems: 6,
          items: { type: "string", minLength: 1, maxLength: 240 },
        },
      },
      required: ["joints", "warnings"],
    },
  },
} as const;

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: { text?: string }) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

function parseAnalysis(raw: string): Record<string, unknown> | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
}

function validateAnalysis(value: Record<string, unknown> | null): Validation {
  if (!value || !Array.isArray(value.joints)) {
    return { ok: false, error: "Response must contain a joints array." };
  }
  if (value.joints.length < 3 || value.joints.length > 48) {
    return { ok: false, error: "A rig must contain between 3 and 48 joints." };
  }
  if (!Array.isArray(value.warnings) || value.warnings.some((warning) => typeof warning !== "string")) {
    return { ok: false, error: "Warnings must be an array of strings." };
  }

  const ids = new Set<string>();
  const joints: RigJoint[] = [];
  for (const entry of value.joints) {
    if (!entry || typeof entry !== "object") return { ok: false, error: "Every joint must be an object." };
    const joint = entry as Record<string, unknown>;
    const id = typeof joint.id === "string" ? joint.id.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(id)) return { ok: false, error: "Every joint id must use only letters, numbers, underscores, or hyphens." };
    if (ids.has(id)) return { ok: false, error: `Joint id "${id}" is duplicated.` };
    if (typeof joint.name !== "string" || !joint.name.trim() || joint.name.length > 80) return { ok: false, error: `Joint "${id}" needs a short name.` };
    if (!(ROLES as readonly string[]).includes(String(joint.role))) return { ok: false, error: `Joint "${id}" has an unknown role.` };
    if (!Number.isFinite(joint.x) || !Number.isFinite(joint.y) || Number(joint.x) < 0 || Number(joint.x) > 1 || Number(joint.y) < 0 || Number(joint.y) > 1) {
      return { ok: false, error: `Joint "${id}" must use normalized x and y coordinates between 0 and 1.` };
    }
    if (joint.parent !== null && (typeof joint.parent !== "string" || !joint.parent.trim())) return { ok: false, error: `Joint "${id}" needs a parent id or null.` };
    ids.add(id);
    joints.push({ id, name: joint.name.trim(), role: joint.role as RigJoint["role"], x: Number(joint.x), y: Number(joint.y), parent: joint.parent === null ? null : joint.parent.trim() });
  }

  const roots = joints.filter((joint) => joint.parent === null);
  if (roots.length !== 1) return { ok: false, error: "The graph must have exactly one parent:null root." };
  const byId = new Map(joints.map((joint) => [joint.id, joint]));
  for (const joint of joints) {
    if (joint.parent !== null && !byId.has(joint.parent)) return { ok: false, error: `Joint "${joint.id}" references a missing parent.` };
    let cursor: RigJoint | undefined = joint;
    let depth = 0;
    while (cursor?.parent !== null) {
      cursor = byId.get(cursor.parent);
      if (!cursor || ++depth > joints.length) return { ok: false, error: "The joint graph contains a parent cycle." };
    }
    if (depth > 8) return { ok: false, error: "The joint graph is deeper than eight parent links." };
  }
  return {
    ok: true,
    value: { joints, warnings: value.warnings.map((warning) => warning.trim()).filter(Boolean).slice(0, 6) },
  };
}

const SYSTEM_PROMPT = `You locate visible articulation joints in a single piece of character artwork so it can be animated as a 2D puppet. You do not draw or modify the image.

The artwork can be any creature, not just a human. Return only the 3–48 visible joints that meaningfully articulate: a root, spine/body, head, limbs, tail segments, wings, ears, jaws, or props where visible. Omit hidden parts and do not invent anatomy. Use one connected tree with exactly one parent:null root. A child parent must be the id of another returned joint; do not make cycles or chains deeper than eight links.

Coordinates are normalized against this image: x=0 left, x=1 right, y=0 top, y=1 bottom. Put each point on the body part it controls. Use short unique ids such as root, spine, tail_1, wing_left, or leg_front; ids may contain only letters, numbers, underscores, and hyphens. Roles must be one of: ${ROLES.join(", ")}.

Return the schema exactly. Warnings are short limitations for the artist, such as an overlapped limb or an indistinct feature.`;

function contentFor(image: string, instruction: string): LlmContentPart[] {
  return [
    { type: "text", text: instruction },
    { type: "image_url", image_url: { url: image } },
  ];
}

export async function POST(request: NextRequest) {
  try {
    const { image } = await request.json();
    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json({ error: "A prepared image data URL is required" }, { status: 400 });
    }

    const auth = await resolveKeyAndCredits(request, "anibuddy-rig", RIG_OPENQUOTA_GEMINI_MODEL, 1, { allowByok: false });
    if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });

    if (isMockMode()) {
      return NextResponse.json({
        joints: [
          { id: "root", name: "Root", role: "root", x: 0.5, y: 0.62, parent: null },
          { id: "spine", name: "Spine", role: "spine", x: 0.5, y: 0.4, parent: "root" },
          { id: "head", name: "Head", role: "head", x: 0.5, y: 0.2, parent: "spine" },
          { id: "tail", name: "Tail", role: "tail", x: 0.7, y: 0.7, parent: "root" },
          { id: "ear", name: "Ear", role: "ear", x: 0.42, y: 0.12, parent: "head" },
        ],
        warnings: [],
      });
    }

    const callAnalysis = (instruction: string) => callLlm({
      byok: false,
      key: auth.key,
      model: RIG_OPENQUOTA_GEMINI_MODEL,
      openQuotaOnly: true,
      openQuotaModel: RIG_OPENQUOTA_GEMINI_MODEL,
      openQuotaFallbackModel: RIG_OPENQUOTA_AUTO_MODEL,
      responseFormat: RIG_ANALYSIS_RESPONSE_FORMAT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: contentFor(image, instruction) },
      ],
      maxTokens: 1200,
      temperature: 0.1,
      title: "AniBuddy - Rig Analysis",
      referer: request.headers.get("referer"),
      signal: request.signal,
      budgetMs: LLM_LONG_BUDGET_MS,
    });

    let result = await callAnalysis("Locate a safe free-form joint graph in this artwork. Return schema-valid JSON only.");
    if (!result.ok) {
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId);
      return NextResponse.json({ error: result.error || "Rig analysis failed" }, { status: result.status || 502 });
    }

    let validation = validateAnalysis(parseAnalysis(extractText(result.data.choices?.[0]?.message?.content)));
    if (!validation.ok) {
      console.warn("[anibuddy][rig-analysis] retrying invalid graph", { provider: result.provider, reason: validation.error });
      result = await callAnalysis(`Your prior graph was rejected: ${validation.error} Return a complete corrected replacement, not an explanation.`);
      if (!result.ok) {
        if (!auth.byok && auth.eventId) await refundCredits(auth.eventId);
        return NextResponse.json({ error: result.error || "Rig analysis failed" }, { status: result.status || 502 });
      }
      validation = validateAnalysis(parseAnalysis(extractText(result.data.choices?.[0]?.message?.content)));
    }

    if (!validation.ok) {
      console.warn("[anibuddy][rig-analysis] rejected graph after correction", { provider: result.provider, reason: validation.error });
      if (!auth.byok && auth.eventId) await refundCredits(auth.eventId);
      return NextResponse.json(
        { error: "Automatic analysis could not produce a safe joint graph. A manual starter rig is ready instead.", code: "RIG_ANALYSIS_INVALID" },
        { status: 422 },
      );
    }

    return NextResponse.json(validation.value, { headers: providerHeaders(result) });
  } catch (error) {
    console.error("Error in anibuddy/rig-analysis route:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
