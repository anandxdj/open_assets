"use client";
import { useRef } from "react";
import { KeyRound, Pause, Play, Plus } from "lucide-react";
import { FPS_OPTIONS, type Clip, type Fps, type Keyframe } from "@/features/anibuddy/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";

/** The keyframe sitting on a frame column, if any. */
export function keyAtFrame(clip: Clip, frame: number, frameCount: number): Keyframe | undefined {
  const t = frame / frameCount;
  return clip.keyframes.find((item) => Math.abs(item.t - t) < 1 / (frameCount * 2));
}

const FPS_SEGMENTS = FPS_OPTIONS.map((value) => ({ value: String(value), label: String(value) }));

interface Props {
  clips: Clip[];
  clip: Clip | null;
  frameCount: number;
  currentFrame: number;
  playing: boolean;
  fps: Fps;
  onFps: (fps: Fps) => void;
  onTogglePlay: () => void;
  onKey: () => void;
  onSetActive: (id: string) => void;
  onNewClip: () => void;
  onScrub: (frame: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (t: number) => void;
}

export function Timeline({ clips, clip, frameCount, currentFrame, playing, fps, onFps, onTogglePlay, onKey, onSetActive, onNewClip, onScrub, onMove, onRemove }: Props) {
  const drag = useRef<number | null>(null);
  const timeFor = (frame: number) => frame / frameCount;
  const frames = Array.from({ length: frameCount }, (_, frame) => frame);
  const pad = (value: number) => String(value).padStart(2, "0");

  return (
    <section aria-label="Timeline" className="flex h-[212px] flex-none flex-col border-t-[1.5px] border-line bg-surface">
      <div className="flex h-10 flex-none items-center gap-2 overflow-x-auto border-b-[1.5px] border-line px-2.5">
        <Button variant="ghost" size="sm" icon aria-label={playing ? "Pause" : "Play"} disabled={!clip} onClick={onTogglePlay}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
        </Button>
        <span className="oa-value whitespace-nowrap">
          <span className="sr-only">Frame </span>
          <span className="text-ink">{pad(currentFrame + 1)}</span>
          <span className="text-ink-3"> / {pad(frameCount)}</span>
        </span>
        <span aria-hidden className="oa-vsep" />
        <span aria-hidden className="oa-label">FPS</span>
        <Segmented ariaLabel="Frames per second" value={String(fps)} options={FPS_SEGMENTS} onChange={(value) => onFps(Number(value) as Fps)} />
        <span className="flex-1" />
        <Button variant="secondary" size="sm" disabled={!clip} onClick={onKey}>
          <KeyRound aria-hidden />
          Key this frame
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-[140px] flex-none flex-col gap-px overflow-y-auto border-r-[1.5px] border-line p-1.5 md:w-[180px]">
          <ul aria-label="Clips" className="flex flex-col gap-px">
            {clips.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="oa-layer h-[30px] w-full text-left"
                  data-selected={item.id === clip?.id}
                  aria-pressed={item.id === clip?.id}
                  onClick={() => onSetActive(item.id)}
                >
                  <Play aria-hidden className={cn("size-3.5 flex-none", item.id === clip?.id ? "text-ink" : "text-ink-3")} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" className="justify-start px-2.5" onClick={onNewClip}>
            <Plus aria-hidden />
            New clip
          </Button>
        </div>

        <div className="relative min-w-0 flex-1 overflow-auto">
          {clip ? (
            <div
              className="grid"
              style={{ gridTemplateColumns: `64px repeat(${frameCount}, minmax(28px, 1fr))`, minWidth: 64 + frameCount * 28 }}
            >
              <span />
              {frames.map((frame) => (
                <button
                  key={frame}
                  type="button"
                  aria-label={`Frame ${frame + 1}`}
                  aria-current={frame === currentFrame ? "true" : undefined}
                  onClick={() => onScrub(frame)}
                  className={cn(
                    "oa-value flex h-6 items-center justify-center border-l border-rule text-[10.5px] hover:bg-hover",
                    frame === currentFrame ? "bg-brand-soft text-ink" : "text-ink-3",
                  )}
                >
                  {frame + 1}
                </button>
              ))}

              <span className="oa-value flex h-[30px] items-center border-t border-rule pl-2.5 text-ink-2">Keys</span>
              {frames.map((frame) => {
                const t = timeFor(frame);
                const key = keyAtFrame(clip, frame, frameCount);
                const current = frame === currentFrame;
                return (
                  <div
                    key={frame}
                    onClick={() => onScrub(frame)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => { if (drag.current !== null) onMove(drag.current, t); drag.current = null; }}
                    className={cn(
                      "flex h-[30px] cursor-pointer items-center justify-center border-l border-t border-rule",
                      current && "bg-brand-soft",
                    )}
                  >
                    {key && (
                      <span
                        draggable
                        role="img"
                        aria-label={`Key at frame ${frame + 1}`}
                        onDragStart={() => { drag.current = key.t; }}
                        onContextMenu={(event) => { event.preventDefault(); onRemove(key.t); }}
                        className={cn("size-[9px] rotate-45 cursor-grab", current ? "bg-brand outline outline-1 outline-ink" : "bg-ink-2")}
                        title="Drag to move; right-click to remove"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="flex h-full items-center justify-center px-4 text-center text-xs leading-[18px] text-ink-3">
              Generate a motion or add a clip to see its keys.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
