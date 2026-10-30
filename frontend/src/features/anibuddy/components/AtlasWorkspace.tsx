"use client";

import { ChangeEvent, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { Check, ImageUp, LoaderCircle, RotateCcw, Sparkles } from "lucide-react";

import { compileMotion } from "@/features/anibuddy/atlas/compiler";
import { extractAtlasRevision } from "@/features/anibuddy/atlas/extract";
import { blobAsDataUrl, readAtlasBlob, readProjectSnapshot, saveAtlasBlob, saveProjectSnapshot } from "@/features/anibuddy/atlas/storage";
import { activeRevision, createAtlasProject, type AssetClassification, type AtlasProject, type SourceAtlas, validateAtlasProject } from "@/features/anibuddy/atlas/types";
import { Crumbs, Topbar } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Hint, Inspector, PanelSection, Prop, StageArea } from "@/features/anibuddy/components/WorkspacePanels";

type AtlasPixels = Record<string, string>;

async function dimensionsOf(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("That image could not be decoded."));
    image.src = dataUrl;
  });
}

async function checksum(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function updateRevision(project: AtlasProject, update: (revision: NonNullable<ReturnType<typeof activeRevision>>) => NonNullable<ReturnType<typeof activeRevision>>): AtlasProject {
  const current = activeRevision(project);
  if (!current) return project;
  const changed = update(current);
  const next = { ...changed, id: crypto.randomUUID(), parentRevisionId: current.id, createdAt: new Date().toISOString(), accepted: false };
  return { ...project, revisions: [...project.revisions, next], activeRevisionId: next.id, updatedAt: new Date().toISOString() };
}

function classLabel(value: AssetClassification["kind"]): string {
  return value === "body-part" ? "Body part" : value[0].toUpperCase() + value.slice(1);
}

function regionLabel(id: string): string {
  return `Region ${id.split(":").pop()}`;
}

const KINDS = ["unclassified", "character", "pose", "body-part", "prop", "effect", "background"] as const;

export function AtlasWorkspace() {
  const id = useId();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [project, setProject] = useState<AtlasProject>(() => createAtlasProject());
  const [pixels, setPixels] = useState<AtlasPixels>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [motion, setMotion] = useState<"idle" | "loop" | "play">("loop");
  const [approvedConstraint, setApprovedConstraint] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const revision = activeRevision(project);
  const atlas = project.sourceAtlases[0] ?? null;
  const sourcePixels = atlas ? pixels[atlas.id] : undefined;
  const scene = project.scenes[0] ?? null;
  const diagnostics = useMemo(() => validateAtlasProject(project), [project]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const restored = readProjectSnapshot();
      if (!restored) return;
      const entries = await Promise.all(restored.sourceAtlases.map(async (source) => {
        const blob = await readAtlasBlob(source.blobKey);
        return blob ? [source.id, await blobAsDataUrl(blob)] as const : null;
      }));
      if (cancelled) return;
      // Don't clobber an atlas the user added while the snapshot was loading.
      setProject((current) => current.sourceAtlases.length ? current : restored);
      setPixels((current) => Object.keys(current).length ? current : Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => { if (project.sourceAtlases.length) saveProjectSnapshot(project); }, [project]);

  const addAtlasFile = async (file: File) => {
    setBusy(true); setMessage(null);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, WebP, or JPEG image.");
      const dataUrl = await blobAsDataUrl(file);
      const dimensions = await dimensionsOf(dataUrl);
      const atlasId = crypto.randomUUID();
      const source: SourceAtlas = { id: atlasId, name: file.name, ...dimensions, checksum: await checksum(file), blobKey: `anibuddy-atlas:${atlasId}`, createdAt: new Date().toISOString(), rightsConfirmed: false, remoteVisionConsented: false };
      await saveAtlasBlob(source.blobKey, file);
      setPixels({ [source.id]: dataUrl });
      setProject({ ...createAtlasProject(), sourceAtlases: [source], updatedAt: new Date().toISOString() });
      setSelectedRegionId(null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The atlas could not be saved locally."); }
    finally { setBusy(false); }
  };

  const addAtlas = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await addAtlasFile(file); } finally { event.target.value = ""; }
  };

  const editAtlas = (change: Partial<Pick<SourceAtlas, "rightsConfirmed" | "remoteVisionConsented">>) => {
    if (!atlas) return;
    setProject((value) => ({ ...value, sourceAtlases: value.sourceAtlases.map((item) => item.id === atlas.id ? { ...item, ...change } : item), updatedAt: new Date().toISOString() }));
  };

  const extract = async () => {
    if (!atlas || !sourcePixels || !atlas.rightsConfirmed) return;
    setBusy(true); setMessage(null);
    try {
      const candidate = await extractAtlasRevision(atlas, sourcePixels);
      setProject((value) => ({ ...value, revisions: [...value.revisions, candidate], activeRevisionId: candidate.id, updatedAt: new Date().toISOString() }));
      setSelectedRegionId(candidate.regions[0]?.id ?? null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Extraction failed."); }
    finally { setBusy(false); }
  };

  const setClassification = (regionId: string, change: Partial<AssetClassification>) => setProject((value) => updateRevision(value, (current) => ({ ...current, regions: current.regions.map((region) => region.id === regionId ? { ...region, classification: { ...region.classification, ...change } } : region) })));
  const accept = () => {
    if (!revision) return;
    const primary = revision.regions.find((region) => region.classification.characterGroup)?.classification.characterGroup ?? null;
    const nextScene = scene ?? { id: crypto.randomUUID(), name: "Scene 1", primaryCharacterGroup: primary, regionIds: revision.regions.filter((region) => region.classification.kind !== "unclassified").map((region) => region.id), activeProgramId: null, camera: { x: 0, y: 0, zoom: 1 } };
    setProject((value) => ({ ...value, revisions: value.revisions.map((item) => item.id === revision.id ? { ...item, accepted: true } : item), scenes: scene ? value.scenes : [nextScene], updatedAt: new Date().toISOString() }));
  };

  const compile = () => {
    if (!revision || !scene) return;
    const outcome = compileMotion(revision, scene, { action: motion, direction: "none", intensity: "normal", loop: motion !== "play", beats: 1, participatingRegions: scene.regionIds, requestedAttachments: [] });
    if (outcome.status === "unsupported") { setMessage(outcome.message); return; }
    if (outcome.status === "supported_with_constraints" && !approvedConstraint) { setMessage(`${outcome.message} Check the approval box to use it.`); return; }
    setProject((value) => ({ ...value, programs: [...value.programs, outcome.program], scenes: value.scenes.map((item) => item.id === scene.id ? { ...item, activeProgramId: outcome.program.id } : item), updatedAt: new Date().toISOString() }));
    setMessage(outcome.message);
  };

  const startOver = () => { setProject(createAtlasProject()); setPixels({}); setSelectedRegionId(null); };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!dragOver) setDragOver(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file && !busy) void addAtlasFile(file);
  };

  const selected = revision?.regions.find((region) => region.id === selectedRegionId) ?? null;
  const feedback = [message, ...diagnostics].filter(Boolean).join(" ");

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "AniBuddy", href: "/anibuddy" }, { label: atlas ? atlas.name : "Quick animate" }]} />
        <span className="flex-1" />
        {atlas && (
          <Button variant="ghost" size="sm" onClick={startOver}>
            <RotateCcw aria-hidden />
            New atlas
          </Button>
        )}
      </Topbar>
      <h1 className="sr-only">AniBuddy quick animate</h1>
      <input ref={fileInput} className="sr-only" tabIndex={-1} aria-hidden type="file" accept="image/png,image/webp,image/jpeg" onChange={(event) => void addAtlas(event)} />

      {!atlas ? (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 pb-20 md:p-6">
          <div className="oa-drop flex-1" data-over={dragOver} onDragEnter={onDragOver} onDragOver={onDragOver} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
            <span className="oa-icon-box size-12">
              {busy ? <LoaderCircle aria-hidden className="size-6 animate-spin" /> : <ImageUp aria-hidden className="size-6" />}
            </span>
            <div className="flex max-w-md flex-col gap-1">
              <h2 className="oa-section">Turn a sprite atlas into a scene</h2>
              <p className="text-xs leading-[18px] text-ink-2">
                Drop one animation-kit sheet here. AniBuddy keeps every region you supplied, sorts them into a kit and
                builds motion from those pixels. It never invents missing views, limbs or props.
              </p>
            </div>
            <Button variant="primary" size="lg" disabled={busy} onClick={() => fileInput.current?.click()}>
              <ImageUp aria-hidden />
              Choose a sheet
            </Button>
            <Hint>PNG, WebP or JPEG. The original stays in this browser.</Hint>
            {message && <Notice tone="danger" role="alert" className="text-left">{message}</Notice>}
          </div>
        </main>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-sunken pb-14 md:flex-row md:overflow-hidden md:pb-0">
          <nav aria-label="Regions" className="flex flex-none flex-col border-b-[1.5px] border-line bg-surface md:w-[240px] md:border-b-0 md:border-r-[1.5px]">
            <div className="oa-panel-head">
              Regions
              {revision && <span className="oa-count ml-auto mr-1.5 text-ink-2">{revision.regions.length}</span>}
            </div>
            <div className="max-h-[240px] overflow-y-auto p-1.5 md:max-h-none md:min-h-0 md:flex-1">
              {revision ? (
                <ul className="flex flex-col gap-px">
                  {revision.regions.map((region) => (
                    <li key={region.id}>
                      <button
                        type="button"
                        className="oa-layer h-auto min-h-[34px] w-full flex-col items-start justify-center gap-0 py-1.5 text-left"
                        data-selected={selectedRegionId === region.id}
                        aria-pressed={selectedRegionId === region.id}
                        onClick={() => setSelectedRegionId(region.id)}
                      >
                        <span className="text-xs font-bold">{regionLabel(region.id)}</span>
                        <span className="oa-value text-[11px] text-ink-3">
                          {region.rect.width} × {region.rect.height} · {classLabel(region.classification.kind)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Hint className="p-2">Extract candidates to list the regions here.</Hint>
              )}
            </div>
          </nav>

          <StageArea label="Atlas">
            <div className="flex flex-1 items-center justify-center overflow-auto p-4 md:p-8">
              {sourcePixels ? (
                <div className="oa-checker relative inline-block max-w-full border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={sourcePixels} alt={`Source atlas ${atlas.name}`} className="block max-h-[70vh] max-w-full" />
                  {revision?.regions.map((region) => {
                    const isSelected = region.id === selectedRegionId;
                    return (
                      <button
                        key={region.id}
                        type="button"
                        tabIndex={-1}
                        aria-hidden
                        onClick={() => setSelectedRegionId(region.id)}
                        className={cn("absolute", isSelected ? "z-10 border-2 border-brand" : "border-[1.5px] border-ink/70 hover:border-ink")}
                        style={{
                          left: `${(region.rect.x / atlas.width) * 100}%`,
                          top: `${(region.rect.y / atlas.height) * 100}%`,
                          width: `${(region.rect.width / atlas.width) * 100}%`,
                          height: `${(region.rect.height / atlas.height) * 100}%`,
                        }}
                      >
                        {isSelected && (
                          <span className="absolute -left-0.5 -top-[19px] h-[18px] whitespace-nowrap bg-brand px-1.5 text-[10px] font-bold leading-[18px] text-brand-fg">
                            {regionLabel(region.id)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Notice tone="warning">The atlas pixels could not be read from this browser. Choose the sheet again with New atlas.</Notice>
              )}
            </div>
          </StageArea>

          <Inspector title="Atlas">
            <PanelSection title="Source">
              <Prop label="File">
                <span className="oa-value block truncate text-ink" title={atlas.name}>{atlas.name}</span>
              </Prop>
              <Prop label="Size">
                <span className="oa-value text-ink">{atlas.width} × {atlas.height}</span>
              </Prop>
              <Prop label="Checksum">
                <span className="oa-value block truncate text-ink-2" title={atlas.checksum}>{atlas.checksum.slice(0, 10)}…</span>
              </Prop>
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-[18px]">
                <Checkbox checked={atlas.rightsConfirmed} onChange={(event) => editAtlas({ rightsConfirmed: event.target.checked })} className="mt-px" />
                <span>I own this artwork or have permission to animate it.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-[18px]">
                <Checkbox checked={atlas.remoteVisionConsented} onChange={(event) => editAtlas({ remoteVisionConsented: event.target.checked })} className="mt-px" />
                <span className="flex flex-col gap-0.5">
                  <span>Allow remote vision analysis later.</span>
                  <span className="text-[11px] leading-4 text-ink-3">This local extraction sends nothing.</span>
                </span>
              </label>
              <Button variant={revision ? "secondary" : "primary"} block disabled={!atlas.rightsConfirmed || busy} onClick={() => void extract()}>
                {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />}
                {revision ? "Reanalyse as a new revision" : "Extract regions"}
              </Button>
              {!atlas.rightsConfirmed && <Hint>Confirm your rights to the artwork before extracting.</Hint>}
            </PanelSection>

            {revision && (
              <PanelSection title="Component map" aside={revision.accepted ? <Badge tone="success"><Check aria-hidden />Accepted</Badge> : undefined}>
                <p aria-live="polite" className="text-xs leading-[18px] text-ink-2">
                  {revision.diagnostics.notes.join(" ")} {revision.diagnostics.overlappingPairs.length ? `${revision.diagnostics.overlappingPairs.length} overlapping candidates need review.` : "No overlapping candidates."}
                </p>
                <Hint>Every candidate is kept. Set a role only when it&apos;s clear; unknown regions stay safe and excluded.</Hint>
                <Button variant={scene ? "secondary" : "primary"} size="sm" className="self-start" onClick={accept}>
                  <Check aria-hidden />
                  Accept map
                </Button>
              </PanelSection>
            )}

            {revision && (
              <PanelSection title="Classify region">
                {selected ? (
                  <>
                    <Hint>A correction creates a new revision. Accepted work is never overwritten.</Hint>
                    <Field label="Asset type" htmlFor={`${id}-kind`}>
                      <Select id={`${id}-kind`} size="sm" value={selected.classification.kind} onChange={(event) => setClassification(selected.id, { kind: event.target.value as AssetClassification["kind"] })}>
                        {KINDS.map((kind) => <option key={kind} value={kind}>{classLabel(kind)}</option>)}
                      </Select>
                    </Field>
                    <Field label="Character group" htmlFor={`${id}-group`}>
                      <Input id={`${id}-group`} size="sm" value={selected.classification.characterGroup ?? ""} onChange={(event) => setClassification(selected.id, { characterGroup: event.target.value || null })} placeholder="hero" />
                    </Field>
                    <Field label="Frame order" htmlFor={`${id}-frame`}>
                      <Input id={`${id}-frame`} size="sm" type="number" min="0" value={selected.classification.frame ?? ""} onChange={(event) => setClassification(selected.id, { frame: event.target.value === "" ? null : Number(event.target.value), role: "frame" })} placeholder="0" />
                    </Field>
                  </>
                ) : (
                  <Hint>Select a region to classify it.</Hint>
                )}
              </PanelSection>
            )}

            {scene && revision && (
              <PanelSection title="Motion">
                <Hint>Motion is compiled from the accepted map. The atlas pixels aren&apos;t sent to a model to animate.</Hint>
                <Field label="Motion" htmlFor={`${id}-motion`}>
                  <Select id={`${id}-motion`} size="sm" value={motion} onChange={(event) => { setMotion(event.target.value as typeof motion); setApprovedConstraint(false); }}>
                    <option value="idle">Idle</option>
                    <option value="loop">Loop supplied frames</option>
                    <option value="play">Play supplied frames once</option>
                  </Select>
                </Field>
                <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-[18px]">
                  <Checkbox checked={approvedConstraint} onChange={(event) => setApprovedConstraint(event.target.checked)} className="mt-px" />
                  <span>Approve a constrained static preview if needed</span>
                </label>
                <Button variant="primary" block onClick={compile}>Compile preview</Button>
                {scene.activeProgramId && (
                  <Notice tone="success">A deterministic program is ready in this browser. Previewing or exporting again reuses it.</Notice>
                )}
              </PanelSection>
            )}

            {feedback && (
              <PanelSection className="border-b-0">
                <Notice tone="info" role="status">{feedback}</Notice>
              </PanelSection>
            )}
          </Inspector>
        </div>
      )}
    </>
  );
}
