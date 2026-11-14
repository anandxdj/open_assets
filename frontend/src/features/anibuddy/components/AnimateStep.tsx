"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { LoaderCircle, Plus, Sparkles, Trash2 } from "lucide-react";
import { MAX_FRAMES, type Clip, type Fps, type Pose, type PreparedAsset, type Rig } from "@/features/anibuddy/types";
import { requestAnimation } from "@/features/anibuddy/api/anibuddyClient";
import { poseAt } from "@/features/anibuddy/lib/clip";
import { createDeformer, STRETCH_WARNING } from "@/features/anibuddy/lib/deform";
import { loadImageElement } from "@/features/anibuddy/lib/raster";
import { Timeline, keyAtFrame } from "@/features/anibuddy/components/Timeline";
import { Badge } from "@/components/ui/badge";
import { DemoModeNotice, PlaceholderLabel } from "@/components/ui/demo-mode";
import { Button } from "@/components/ui/button";
import { Range, Switch } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Hint, Inspector, PanelSection, Prop, StageArea } from "@/features/anibuddy/components/WorkspacePanels";

const MAX_PREVIEW_EDGE = 420;

interface Props {
  prepared: PreparedAsset;
  rig: Rig;
  clips: Clip[];
  activeClipId: string | null;
  fps: Fps;
  frameCount: number;
  onFps: (fps: Fps) => void;
  onFrameCount: (count: number) => void;
  onAddClip: (clip: Clip) => void;
  onSetActive: (id: string | null) => void;
  onUpsert: (id: string, t: number, pose: Pose) => void;
  onMove: (id: string, from: number, to: number) => void;
  onRemove: (id: string, t: number) => void;
  onDelete: (id: string) => void;
  onToggleLoop: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onContinue: () => void;
}

/** Keyboard alternative to dragging a diamond: move or remove the key on this frame. */
function KeyEditor({ frame, frameCount, onMove, onRemove }: { frame: number; frameCount: number; onMove: (to: number) => void; onRemove: () => void }) {
  const id = useId();
  const [target, setTarget] = useState(String(frame + 1));
  const to = Number(target) - 1;
  const valid = Number.isInteger(to) && to >= 0 && to < frameCount && to !== frame;
  return (
    <>
      <Prop label="Frame">
        <span className="oa-value text-ink">{frame + 1}</span>
      </Prop>
      <Prop label="Move to" htmlFor={`${id}-to`}>
        <div className="flex gap-1.5">
          <Input id={`${id}-to`} size="sm" type="number" min={1} max={frameCount} value={target} onChange={(event) => setTarget(event.target.value)} />
          <Button size="sm" disabled={!valid} onClick={() => onMove(to)}>
            Move
          </Button>
        </div>
      </Prop>
      <Button variant="danger" size="sm" className="self-start" onClick={onRemove}>
        <Trash2 aria-hidden />
        Remove key
      </Button>
      <Hint>You can also drag diamonds to retime them. Right-click a diamond to remove it.</Hint>
    </>
  );
}

export function AnimateStep({ prepared, rig, clips, activeClipId, fps, frameCount, onFps, onFrameCount, onAddClip, onSetActive, onUpsert, onMove, onRemove, onDelete, onToggleLoop, onRename, onContinue }: Props) {
  const id = useId();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [frame, setFrame] = useState(0);
  const [showDistortion, setShowDistortion] = useState(false);
  const [worst, setWorst] = useState(1);
  const [folds, setFolds] = useState(0);
  const active = clips.find((clip) => clip.id === activeClipId) ?? null;

  useEffect(() => {
    let cancel = false;
    void loadImageElement(prepared.dataUrl).then((value) => { if (!cancel) setImage(value); });
    return () => { cancel = true; };
  }, [prepared.dataUrl]);

  const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(prepared.width, prepared.height));
  const width = Math.round(prepared.width * scale), height = Math.round(prepared.height * scale);
  const deformer = useMemo(() => image ? createDeformer(rig, prepared, image) : null, [image, rig, prepared]);

  useEffect(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext("2d");
    if (!ctx || !deformer) return;
    let raf = 0, last = 0;
    const draw = () => {
      const pose = active ? poseAt(active, frame / frameCount) : {};
      const stats = deformer.render(ctx, pose, { width, height, showDistortion });
      setWorst((value) => Math.max(value, stats.maxStretch));
      setFolds((value) => Math.max(value, stats.flippedTriangles));
    };
    draw();
    if (!playing || !active) return;
    const tick = (now: number) => {
      if (now - last >= 1000 / fps) { last = now; setFrame((value) => (value + 1) % frameCount); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, deformer, frame, frameCount, fps, height, playing, showDistortion, width]);

  const generate = async () => {
    if (!request.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestAnimation({ image: prepared.dataUrl, rig, request: request.trim() });
      onAddClip(result.clip);
      setPlaying(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Animation request failed.");
    } finally {
      setBusy(false);
    }
  };
  const newClip = () => onAddClip({ id: crypto.randomUUID(), name: "Hand animation", request: "", loop: true, source: "edited", keyframes: [{ t: 0, joints: {} }] });
  const addKey = () => { if (active) onUpsert(active.id, frame / frameCount, poseAt(active, frame / frameCount)); };
  const currentKey = active ? keyAtFrame(active, frame, frameCount) : undefined;
  const stretched = worst > STRETCH_WARNING || folds > 0;

  return (
    <>
      <StageArea label="Animation preview">
        <p role="status" aria-live="polite" className="sr-only">
          {busy ? "Generating motion…" : ""}
        </p>
        <div className="flex min-h-[260px] flex-1 overflow-auto p-4 md:p-8">
          <div className="oa-checker relative m-auto max-w-full flex-none border border-line">
            {/* Tall characters must fit the stage: the stacked layout gives it as little as 420px. */}
            <canvas ref={canvasRef} width={width} height={height} className="block h-auto max-h-[max(220px,calc(100dvh-28rem))] max-w-full" aria-label={active ? `Preview of ${active.name}, frame ${frame + 1}` : "Preview of the rigged character"} role="img" />
            {busy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[color-mix(in_srgb,var(--oa-surface)_70%,transparent)]">
                <LoaderCircle aria-hidden className="size-8 animate-spin text-ink" />
                <span className="text-xs leading-[18px] text-ink-2">Generating motion…</span>
              </div>
            )}
          </div>
        </div>
        <Timeline
          clips={clips}
          clip={active}
          frameCount={frameCount}
          currentFrame={frame}
          playing={playing}
          fps={fps}
          onFps={onFps}
          onTogglePlay={() => setPlaying(!playing)}
          onKey={addKey}
          onSetActive={onSetActive}
          onNewClip={newClip}
          onScrub={(value) => { setFrame(value); setPlaying(false); }}
          onMove={(from, to) => { if (active) onMove(active.id, from, to); }}
          onRemove={(time) => { if (active) onRemove(active.id, time); }}
        />
      </StageArea>

      <Inspector
        title="Animate"
        footer={
          <Button variant="primary" block disabled={!active} onClick={onContinue}>
            Continue to export
          </Button>
        }
      >
        <PanelSection>
          <Field label="What should it do?" htmlFor={`${id}-request`}>
            <Textarea
              id={`${id}-request`}
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Wave hello with the right paw, then settle."
              className="min-h-[76px]"
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" size="sm" className="flex-1" disabled={busy || !request.trim()} onClick={() => void generate()}>
              {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />}
              {busy ? "Generating…" : "Generate motion"}
            </Button>
            <Button variant="secondary" size="sm" onClick={newClip}>
              <Plus aria-hidden />
              Animate by hand
            </Button>
          </div>
          <DemoModeNotice />
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
        </PanelSection>

        {active && (
          <PanelSection title="Clip" aside={
              <span className="flex items-center gap-1.5">
                {active.source === "model" && <PlaceholderLabel />}
                <Badge>{active.source === "model" ? "Generated" : "Edited"}</Badge>
              </span>
            }>
            <Prop label="Name" htmlFor={`${id}-name`}>
              {onRename ? (
                <Input id={`${id}-name`} size="sm" value={active.name} maxLength={80} onChange={(event) => onRename(active.id, event.target.value)} />
              ) : (
                <span className="block truncate text-ink">{active.name}</span>
              )}
            </Prop>
            <Prop label="Loop" htmlFor={`${id}-loop`}>
              <Switch id={`${id}-loop`} checked={active.loop} onCheckedChange={() => onToggleLoop(active.id)} />
            </Prop>
            <Button variant="danger" size="sm" className="self-start" onClick={() => onDelete(active.id)}>
              <Trash2 aria-hidden />
              Delete clip
            </Button>
          </PanelSection>
        )}

        <PanelSection title="Timing">
          <Field label="Frames" htmlFor={`${id}-frames`} aside={<span className="oa-value text-ink">{frameCount}</span>}>
            <Range
              id={`${id}-frames`}
              min={4}
              max={MAX_FRAMES}
              value={frameCount}
              aria-valuetext={`${frameCount} frames`}
              onChange={(event) => onFrameCount(Number(event.target.value))}
            />
          </Field>
          <Hint>Plays at {fps} frames per second. Change the rate in the timeline.</Hint>
        </PanelSection>

        {active && currentKey && (
          <PanelSection title="Selected key">
            <KeyEditor
              key={`${active.id}-${frame}`}
              frame={frame}
              frameCount={frameCount}
              onMove={(to) => { onMove(active.id, currentKey.t, to / frameCount); setFrame(to); }}
              onRemove={() => onRemove(active.id, currentKey.t)}
            />
          </PanelSection>
        )}

        <PanelSection title="Stretch" className="border-b-0">
          <Prop label="Show" htmlFor={`${id}-stretch`}>
            <Switch id={`${id}-stretch`} checked={showDistortion} onCheckedChange={setShowDistortion} />
          </Prop>
          <Prop label="Worst">
            <span className="oa-value text-ink">×{worst.toFixed(1)}</span>
          </Prop>
          {stretched && (
            <Notice tone="warning" role="status">
              This clip stretches or folds parts of the artwork.
            </Notice>
          )}
        </PanelSection>
      </Inspector>
    </>
  );
}
