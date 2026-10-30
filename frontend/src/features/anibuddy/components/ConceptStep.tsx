"use client";

import { useId, useState } from "react";
import { Copy, LoaderCircle, Sparkles } from "lucide-react";
import type { QaTurn } from "@/features/anibuddy/types";
import { requestPromptTurn } from "@/features/anibuddy/api/anibuddyClient";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Hint, Inspector, PanelSection, StageArea } from "@/features/anibuddy/components/WorkspacePanels";

interface Question {
  id: string;
  question: string;
  options: string[];
  allowFree: boolean;
  multi: boolean;
}
interface Props {
  idea: string;
  prompt: string | null;
  transcript: QaTurn[];
  onIdea: (value: string) => void;
  onPrompt: (value: string | null) => void;
  onTranscript: (value: QaTurn[]) => void;
  onSkip: () => void;
}

export function ConceptStep({ idea, prompt, transcript, onIdea, onPrompt, onTranscript, onSkip }: Props) {
  const id = useId();
  const [question, setQuestion] = useState<Question | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [free, setFree] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ask = async () => {
    if (!idea.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestPromptTurn({ action: "ask", idea: idea.trim(), transcript });
      if (result.done) {
        setQuestion(null);
      } else setQuestion(result.questions?.[0] ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The interview failed.");
    } finally {
      setBusy(false);
    }
  };
  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await requestPromptTurn({ action: "write", idea: idea.trim(), transcript });
      if (result.prompt) onPrompt(result.prompt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The prompt helper failed.");
    } finally {
      setBusy(false);
    }
  };
  const answer = async () => {
    if (!question) return;
    const value = [...selected, free.trim()].filter(Boolean).join(", ");
    if (!value) return;
    onTranscript([...transcript, { question: question.question, answer: value }]);
    setQuestion(null);
    setSelected([]);
    setFree("");
    window.setTimeout(() => void ask(), 0);
  };

  const mainLabel = question ? "Write my prompt" : transcript.length ? "Ask next question" : "Start interview";
  const showWrite = transcript.length >= 2 || !question;

  return (
    <>
      <StageArea label="Interview" className="overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 p-4 md:p-6">
          {transcript.length === 0 && !question && !prompt && (
            <div className="flex flex-col items-center gap-3 border-2 border-dashed border-line bg-surface px-6 py-10 text-center">
              <span className="oa-icon-box">
                <Sparkles aria-hidden className="size-5" />
              </span>
              <h3 className="oa-section">Start from an idea</h3>
              <p className="max-w-sm text-xs leading-[18px] text-ink-2">
                Describe your character, then answer a few questions. You get a rig-friendly prompt to use in
                another art tool.
              </p>
            </div>
          )}

          {transcript.length > 0 && (
            <ol aria-label="Answers so far" className="flex flex-col gap-2">
              {transcript.map((turn, index) => (
                <li key={`${turn.question}-${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onTranscript(transcript.slice(0, index));
                      setQuestion({ id: `edit-${index}`, question: turn.question, options: [], allowFree: true, multi: false });
                      setFree(turn.answer);
                    }}
                    className="flex w-full flex-col gap-1 border-[1.5px] border-line bg-surface px-3 py-2.5 text-left hover:bg-hover"
                    aria-label={`Edit answer: ${turn.question}`}
                  >
                    <span className="text-xs font-bold leading-[18px] text-ink">{turn.question}</span>
                    <span className="text-xs leading-[18px] text-ink-2">{turn.answer}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}

          {question && (
            <fieldset className="flex flex-col gap-3 border-[1.5px] border-line-strong bg-surface p-4 shadow-float">
              <legend className="sr-only">{question.question}</legend>
              <p aria-hidden className="text-[13px] font-bold leading-5">
                {question.question}
              </p>
              {question.options.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {question.options.map((option) => {
                    const active = selected.includes(option);
                    return (
                      <Button
                        key={option}
                        size="sm"
                        aria-pressed={active}
                        className={active ? "bg-inverse text-inverse-fg" : undefined}
                        onClick={() =>
                          setSelected(
                            question.multi
                              ? active
                                ? selected.filter((value) => value !== option)
                                : [...selected, option]
                              : [option],
                          )
                        }
                      >
                        {option}
                      </Button>
                    );
                  })}
                </div>
              )}
              {question.allowFree && (
                <Input
                  aria-label="Your own answer"
                  value={free}
                  onChange={(event) => setFree(event.target.value)}
                  placeholder="Or add your own answer"
                />
              )}
              <Button variant="secondary" className="self-start" onClick={() => void answer()}>
                Save answer
              </Button>
            </fieldset>
          )}

          {prompt && (
            <section aria-labelledby={`${id}-prompt`} className="flex flex-col gap-3 border-[1.5px] border-line-strong bg-surface p-4">
              <h3 id={`${id}-prompt`} className="oa-panel-title">
                Your prompt
              </h3>
              <p className="whitespace-pre-wrap text-[13px] leading-5">{prompt}</p>
              <Button
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() =>
                  void navigator.clipboard.writeText(prompt).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  })
                }
              >
                <Copy aria-hidden />
                {copied ? "Copied" : "Copy prompt"}
              </Button>
              <span role="status" className="sr-only">
                {copied ? "Prompt copied" : ""}
              </span>
            </section>
          )}
        </div>
      </StageArea>

      <Inspector
        title="Concept"
        footer={
          <Button variant="ghost" size="sm" className="self-center" onClick={onSkip}>
            Skip to my artwork
          </Button>
        }
      >
        <PanelSection>
          <Field label="Your character" htmlFor={`${id}-idea`} help="Optional. Skip this if you already have art.">
            <Textarea
              id={`${id}-idea`}
              aria-describedby={`${id}-idea-note`}
              value={idea}
              onChange={(event) => onIdea(event.target.value)}
              rows={3}
              placeholder="A red fox courier in a canvas backpack"
              className="min-h-[76px]"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              disabled={busy || !idea.trim()}
              onClick={() => void (question ? write() : ask())}
            >
              {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />}
              {mainLabel}
            </Button>
            {showWrite && mainLabel !== "Write my prompt" && (
              <Button variant="secondary" size="sm" disabled={busy || !idea.trim()} onClick={() => void write()}>
                Write my prompt
              </Button>
            )}
          </div>
          <Hint>The interview and prompt use AI. No images are made here.</Hint>
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
        </PanelSection>
      </Inspector>
    </>
  );
}
