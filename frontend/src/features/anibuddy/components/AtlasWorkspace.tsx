"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Check, FileImage, LoaderCircle, RotateCcw, Sparkles, Upload } from "lucide-react";

import { compileMotion } from "@/features/anibuddy/atlas/compiler";
import { extractAtlasRevision } from "@/features/anibuddy/atlas/extract";
import { blobAsDataUrl, readAtlasBlob, readProjectSnapshot, saveAtlasBlob, saveProjectSnapshot } from "@/features/anibuddy/atlas/storage";
import { activeRevision, createAtlasProject, type AssetClassification, type AtlasProject, type SourceAtlas, validateAtlasProject } from "@/features/anibuddy/atlas/types";

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

export function AtlasWorkspace() {
  const [project, setProject] = useState<AtlasProject>(() => createAtlasProject());
  const [pixels, setPixels] = useState<AtlasPixels>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [motion, setMotion] = useState<"idle" | "loop" | "play">("loop");
  const [approvedConstraint, setApprovedConstraint] = useState(false);
  const revision = activeRevision(project);
  const atlas = project.sourceAtlases[0] ?? null;
  const sourcePixels = atlas ? pixels[atlas.id] : undefined;
  const scene = project.scenes[0] ?? null;
  const diagnostics = useMemo(() => validateAtlasProject(project), [project]);

  useEffect(() => {
    const restored = readProjectSnapshot();
    if (!restored) return;
    setProject(restored);
    void Promise.all(restored.sourceAtlases.map(async (source) => {
      const blob = await readAtlasBlob(source.blobKey);
      return blob ? [source.id, await blobAsDataUrl(blob)] as const : null;
    })).then((entries) => setPixels(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null))));
  }, []);

  useEffect(() => { if (project.sourceAtlases.length) saveProjectSnapshot(project); }, [project]);

  const addAtlas = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setMessage(null);
    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, WebP, or JPEG image.");
      const dataUrl = await blobAsDataUrl(file);
      const dimensions = await dimensionsOf(dataUrl);
      const id = crypto.randomUUID();
      const source: SourceAtlas = { id, name: file.name, ...dimensions, checksum: await checksum(file), blobKey: `anibuddy-atlas:${id}`, createdAt: new Date().toISOString(), rightsConfirmed: false, remoteVisionConsented: false };
      await saveAtlasBlob(source.blobKey, file);
      setPixels({ [source.id]: dataUrl });
      setProject({ ...createAtlasProject(), sourceAtlases: [source], updatedAt: new Date().toISOString() });
      setSelectedRegionId(null);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The atlas could not be saved locally."); }
    finally { setBusy(false); event.target.value = ""; }
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

  const selected = revision?.regions.find((region) => region.id === selectedRegionId) ?? null;

  return <main className="mx-auto w-full max-w-7xl px-5 py-8 text-zinc-900 dark:text-zinc-100 sm:px-8">
    <header className="max-w-3xl"><p className="text-sm font-medium text-violet-700 dark:text-violet-300">AniBuddy</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Turn a sprite atlas into a scene.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">AniBuddy preserves every supplied region, classifies it into a reusable kit, and compiles motion from those pixels. It does not invent missing views, limbs, or props.</p></header>
    <section className="mt-8 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-medium">Quick Animate</h2><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Upload one mixed animation-kit sheet and review the component map.</p></div>{atlas && <button type="button" onClick={() => { setProject(createAtlasProject()); setPixels({}); setSelectedRegionId(null); }} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"><RotateCcw className="h-4 w-4" /> New atlas</button>}</div>
      {!atlas ? <label className="mt-6 flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-5 text-center transition hover:border-violet-500 hover:bg-violet-50 dark:border-zinc-700 dark:bg-zinc-900/40 dark:hover:bg-violet-950/20"><Upload className="h-6 w-6 text-violet-600" /><span className="mt-3 font-medium">Choose an animation-kit sheet</span><span className="mt-1 text-sm text-zinc-500">PNG, WebP, or JPEG. The original stays in this browser.</span><input className="sr-only" type="file" accept="image/png,image/webp,image/jpeg" onChange={(event) => void addAtlas(event)} /></label> : <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]"><div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900"><img src={sourcePixels} alt={`Source atlas ${atlas.name}`} className="max-h-[30rem] w-full object-contain" /></div><div className="space-y-4"><div><p className="flex items-center gap-2 text-sm font-medium"><FileImage className="h-4 w-4 text-violet-600" />{atlas.name}</p><p className="mt-1 text-xs text-zinc-500">{atlas.width} × {atlas.height}px · local source · checksum {atlas.checksum.slice(0, 10)}…</p></div><label className="flex gap-3 text-sm leading-5"><input type="checkbox" checked={atlas.rightsConfirmed} onChange={(event) => editAtlas({ rightsConfirmed: event.target.checked })} className="mt-0.5 h-4 w-4 accent-violet-600" /><span>I own this artwork or have permission to animate it.</span></label><label className="flex gap-3 text-sm leading-5"><input type="checkbox" checked={atlas.remoteVisionConsented} onChange={(event) => editAtlas({ remoteVisionConsented: event.target.checked })} className="mt-0.5 h-4 w-4 accent-violet-600" /><span>Allow remote vision analysis later. <span className="text-zinc-500">This local extraction sends nothing.</span></span></label><button type="button" onClick={() => void extract()} disabled={!atlas.rightsConfirmed || busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-violet-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-45">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{revision ? "Reanalyse as a candidate revision" : "Extract local candidates"}</button>{!atlas.rightsConfirmed && <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">Confirm rights before extraction.</p>}</div></div>}
    </section>
    {revision && <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"><div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-medium">Component map</h2><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Every candidate is retained. Confirm a role only when it is clear; unknown regions remain safe and excluded.</p></div><button type="button" onClick={accept} className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"><Check className="h-4 w-4" /> Accept map</button></div><p aria-live="polite" className="mt-4 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{revision.diagnostics.notes.join(" ")} {revision.diagnostics.overlappingPairs.length ? `${revision.diagnostics.overlappingPairs.length} overlapping candidates need review.` : "No overlapping candidates."}</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{revision.regions.map((region) => <button key={region.id} type="button" onClick={() => setSelectedRegionId(region.id)} className={`rounded-lg border p-3 text-left transition ${selectedRegionId === region.id ? "border-violet-600 ring-2 ring-violet-100 dark:ring-violet-950" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800"}`}><p className="font-medium">Region {region.id.split(":").pop()}</p><p className="mt-1 text-xs text-zinc-500">{region.rect.width} × {region.rect.height}px · {classLabel(region.classification.kind)}</p><p className="mt-2 text-xs text-zinc-500">{region.provenance.replaceAll("-", " ")}</p></button>)}</div></div><aside className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">{selected ? <><h2 className="text-lg font-medium">Classify region</h2><p className="mt-1 text-sm text-zinc-500">A correction creates a new candidate revision; accepted work is never overwritten.</p><label className="mt-5 block text-sm font-medium">Asset type<select value={selected.classification.kind} onChange={(event) => setClassification(selected.id, { kind: event.target.value as AssetClassification["kind"] })} className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700">{(["unclassified", "character", "pose", "body-part", "prop", "effect", "background"] as const).map((kind) => <option key={kind} value={kind}>{classLabel(kind)}</option>)}</select></label><label className="mt-4 block text-sm font-medium">Character group<input value={selected.classification.characterGroup ?? ""} onChange={(event) => setClassification(selected.id, { characterGroup: event.target.value || null })} placeholder="hero" className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label><label className="mt-4 block text-sm font-medium">Frame order<input type="number" min="0" value={selected.classification.frame ?? ""} onChange={(event) => setClassification(selected.id, { frame: event.target.value === "" ? null : Number(event.target.value), role: "frame" })} placeholder="0" className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700" /></label></> : <p className="text-sm text-zinc-500">Select a candidate to classify it.</p>}</aside></section>}
    {scene && revision && <section className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950"><h2 className="text-lg font-medium">Motion compiler</h2><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">Motion requests are compiled against the accepted capability graph. The atlas pixels are not sent to a model for animation.</p><div className="mt-5 flex flex-wrap items-center gap-3"><label className="text-sm font-medium">Motion<select value={motion} onChange={(event) => { setMotion(event.target.value as typeof motion); setApprovedConstraint(false); }} className="ml-2 rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"><option value="idle">Idle</option><option value="loop">Loop supplied frames</option><option value="play">Play supplied frames once</option></select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={approvedConstraint} onChange={(event) => setApprovedConstraint(event.target.checked)} className="h-4 w-4 accent-violet-600" />Approve a constrained static preview if required</label><button type="button" onClick={compile} className="rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800">Compile preview</button></div>{scene.activeProgramId && <p className="mt-4 text-sm text-emerald-700 dark:text-emerald-300">A deterministic program is ready locally. Repeating preview or export reuses this compiled program.</p>}</section>}
    {(message || diagnostics.length > 0) && <p aria-live="polite" className="mt-5 rounded-md border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">{message}{diagnostics.length > 0 ? ` ${diagnostics.join(" ")}` : ""}</p>}
  </main>;
}
