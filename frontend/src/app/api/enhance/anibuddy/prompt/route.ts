import { NextRequest, NextResponse } from "next/server";
import { isMockMode, refundCredits, resolveKeyAndCredits } from "../../../studio/_lib/openrouter";
import { callLlm, providerHeaders, LLM_LONG_BUDGET_MS } from "../../../studio/_lib/llm";
export const maxDuration = 120;
const REQUIREMENTS = ["exactly one character, alone in frame", "the entire body visible, nothing cropped", "a clean, readable silhouette", "arms held clear of the torso so they read as separate shapes", "consistent, unexaggerated proportions", "a transparent or flat single-colour background that is easy to remove", "no scenery, props, text, watermarks, borders, or extra characters"];
const MOCK_PROMPT = "Full-body mock character, single subject, front-facing, clean readable silhouette, arms held clear of the torso, consistent proportions, flat removable background, no scenery or text.";
function textOf(content: unknown) { return typeof content === "string" ? content : Array.isArray(content) ? content.map((part: { text?: string }) => part.text ?? "").join("") : ""; }
const ANIBUDDY_TEXT_MODEL = process.env.ANIBUDDY_PROMPT_OPENQUOTA_MODEL || "google/gemini-2.5-flash";
const ANIBUDDY_TEXT_FALLBACK_MODEL = process.env.ANIBUDDY_PROMPT_OPENQUOTA_FALLBACK_MODEL || "auto";
const INTERVIEW_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "anibuddy_interview_turn",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        questions: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", maxLength: 40 },
              question: { type: "string", maxLength: 280 },
              options: { type: "array", maxItems: 6, items: { type: "string" } },
              allowFree: { type: "boolean" },
              multi: { type: "boolean" },
            },
            required: ["id", "question", "options", "allowFree", "multi"],
          },
        },
        done: { type: "boolean" },
      },
      required: ["questions", "done"],
    },
  },
} as const;
function cleanPrompt(raw: string) { return raw.trim().replace(/^```(?:\w+)?\s*/i, "").replace(/\s*```$/i, "").replace(/^(?:prompt|output)\s*[:\-]\s*/i, "").replace(/^["'`]|["'`]$/g, "").trim(); }
function parsed(content: unknown): Record<string, unknown> | null { const value = textOf(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""); try { return JSON.parse(value) as Record<string, unknown>; } catch { const a = value.indexOf("{"); const b = value.lastIndexOf("}"); try { return a >= 0 && b > a ? JSON.parse(value.slice(a, b + 1)) as Record<string, unknown> : null; } catch { return null; } } }
function questions(value: unknown) { if (!Array.isArray(value)) return null; const result = value.slice(0, 3).map((item, index) => { if (!item || typeof item !== "object") return null; const q = item as Record<string, unknown>; if (typeof q.question !== "string" || !q.question.trim()) return null; return { id: typeof q.id === "string" ? q.id.slice(0, 40) : `q-${index + 1}`, question: q.question.slice(0, 280), options: Array.isArray(q.options) ? q.options.filter((x): x is string => typeof x === "string").slice(0, 6) : [], allowFree: q.allowFree !== false, multi: q.multi === true }; }); return result.some((item) => item === null) ? null : result; }
export async function POST(request: NextRequest) {
  try {
    const body = await request.json(); const action = body.action;
    if (action !== "ask" && action !== "write") return NextResponse.json({ error: "Choose ask or write." }, { status: 400 });
    if (typeof body.idea !== "string" || !body.idea.trim()) return NextResponse.json({ error: "Describe the character you want" }, { status: 400 });
    const transcript = Array.isArray(body.transcript) ? body.transcript.filter((turn: unknown): turn is { question: string; answer: string } => Boolean(turn) && typeof (turn as { question?: unknown }).question === "string" && typeof (turn as { answer?: unknown }).answer === "string").slice(0, 6) : [];
    if (action === "ask" && transcript.length >= 6) return NextResponse.json({ questions: [], done: true });
    const auth = await resolveKeyAndCredits(request, "anibuddy-prompt", ANIBUDDY_TEXT_MODEL, 1, { allowByok: false }); if (!auth.ok) return NextResponse.json({ error: auth.error, code: auth.code }, { status: auth.status });
    if (isMockMode()) { if (action === "write") return NextResponse.json({ prompt: MOCK_PROMPT }); const round = transcript.length; return NextResponse.json({ questions: round === 0 ? [{ id: "style", question: "What visual style fits this character?", options: ["Clean vector", "Hand-painted", "Pixel art"], allowFree: true, multi: false }] : [{ id: "mood", question: "What mood should the pose convey?", options: ["Cheerful", "Brave", "Calm"], allowFree: true, multi: false }], done: round >= 2 }); }
    const history = transcript.map((turn: { question: string; answer: string }) => `Q: ${turn.question}\nA: ${turn.answer}`).join("\n\n");
    const system = action === "ask" ? `You interview a user about a single character illustration that will become a rigged 2D puppet. Ask 1–3 concise adaptive questions about subject, art style, palette, mood, detail, silhouette readability, or reference points. Return strict JSON {"questions":[{"id","question","options","allowFree","multi"}],"done":boolean}. Do not negotiate technical constraints. After enough detail set done true.` : `You write image prompts for an external image tool. Return only one 40–90 word prompt. It MUST explicitly encode these hard requirements:\n${REQUIREMENTS.map((item) => `- ${item}`).join("\n")}`;
    const result = await callLlm({ byok: false, openQuotaOnly: true, openQuotaModel: ANIBUDDY_TEXT_MODEL, openQuotaFallbackModel: ANIBUDDY_TEXT_FALLBACK_MODEL, responseFormat: action === "ask" ? INTERVIEW_RESPONSE_FORMAT : undefined, key: auth.key, model: ANIBUDDY_TEXT_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: `Character idea: ${body.idea.trim()}\n\nInterview so far:\n${history || "(none)"}` }], maxTokens: action === "ask" ? 700 : 400, temperature: action === "ask" ? 0.3 : 0.4, title: "AniBuddy - Concept interview", referer: request.headers.get("referer"), signal: request.signal, budgetMs: LLM_LONG_BUDGET_MS });
    if (!result.ok) { if (!auth.byok && auth.eventId) await refundCredits(auth.eventId); return NextResponse.json({ error: result.error || "The interview failed" }, { status: result.status || 502 }); }
    if (action === "write") { const prompt = cleanPrompt(textOf(result.data.choices?.[0]?.message?.content)); if (prompt.length < 40) { if (!auth.byok && auth.eventId) await refundCredits(auth.eventId); return NextResponse.json({ error: "The model returned no usable prompt" }, { status: 502 }); } return NextResponse.json({ prompt }, { headers: providerHeaders(result) }); }
    const response = parsed(result.data.choices?.[0]?.message?.content); const next = questions(response?.questions); if (!next) { if (!auth.byok && auth.eventId) await refundCredits(auth.eventId); return NextResponse.json({ error: "The model returned an invalid interview question" }, { status: 502 }); }
    return NextResponse.json({ questions: next, done: response?.done === true }, { headers: providerHeaders(result) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 }); }
}
