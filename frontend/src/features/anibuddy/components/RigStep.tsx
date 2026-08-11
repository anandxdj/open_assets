"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Grid3x3, Loader2, Plus, RotateCcw, Sparkles, Trash2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type CutLine,
  type Joint,
  type JointRole,
  type PreparedAsset,
  type Rig,
  JOINT_ROLES,
  MIN_JOINTS,
  getBones,
  rigInvalidReason,
} from "@/features/anibuddy/types";
import { type Raster, loadRaster } from "@/features/anibuddy/lib/raster";
import { buildMesh, buildWeights } from "@/features/anibuddy/lib/mesh";
import { applyLocalSupport, buildRig, rebindWeights, roleColor } from "@/features/anibuddy/lib/skeleton";
import { requestRigAnalysis, AniBuddyApiError } from "@/features/anibuddy/api/anibuddyClient";
import type { RigTool } from "@/features/anibuddy/components/RigCanvas";

const RigCanvas = dynamic(
  () => import("@/features/anibuddy/components/RigCanvas").then((mod) => mod.RigCanvas),
  { ssr: false, loading: () => <div className="grid h-72 place-items-center font-mono text-[10px] uppercase tracking-wider text-zinc-500">Loading editor</div> },
);

interface RigStepProps {
  prepared: PreparedAsset;
  rig: Rig | null;
  onRig: (rig: Rig | null) => void;
  /** Kept optional while Order 9 replaces the project reducer actions. */
  onEditJoint?: (jointId: string, x: number, y: number) => void;
  onWeights?: (weights: Float32Array) => void;
  onContinue: () => void;
}

const MANUAL_JOINTS: Joint[] = [
  { id: "root", name: "Root", role: "root", x: 0.5, y: 0.68, parent: null },
  { id: "spine", name: "Spine", role: "spine", x: 0.5, y: 0.48, parent: "root" },
  { id: "head", name: "Head", role: "head", x: 0.5, y: 0.28, parent: "spine" },
];

export function RigStep({ prepared, rig, onRig, onContinue }: RigStepProps) {
  const [loaded, setLoaded] = useState<{ url: string; raster: Raster } | null>(null);
  const raster = loaded?.url === prepared.dataUrl ? loaded.raster : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<RigTool>("joints");
  const [selectedBone, setSelectedBone] = useState(0);
  const [selectedJointId, setSelectedJointId] = useState<string | null>(null);
  const [selectedCutId, setSelectedCutId] = useState<string | null>(null);
  const [showMesh, setShowMesh] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url = prepared.dataUrl;
    void loadRaster(url).then((decoded) => { if (!cancelled) setLoaded({ url, raster: decoded }); }).catch(() => {
      if (!cancelled) setError("The prepared image could not be read back.");
    });
    return () => { cancelled = true; };
  }, [prepared.dataUrl]);

  const bones = useMemo(() => rig ? getBones(rig.joints) : [], [rig]);
  const selectedJoint = rig?.joints.find((joint) => joint.id === selectedJointId) ?? null;
  const activeSelectedJointId = selectedJoint?.id ?? null;
  const activeSelectedCutId = rig?.cuts.some((cut) => cut.id === selectedCutId) ? selectedCutId : null;

  const analyze = useCallback(async () => {
    if (!raster || busy) return;
    setBusy(true);
    setError(null);
    try {
      const analysis = await requestRigAnalysis({ image: prepared.dataUrl });
      onRig(buildRig(analysis, prepared, raster.data));
    } catch (cause) {
      setError(cause instanceof AniBuddyApiError ? cause.message : "Rig analysis failed. You can still place the joints yourself.");
    } finally {
      setBusy(false);
    }
  }, [raster, busy, prepared, onRig]);

  const startManual = useCallback(() => {
    if (!raster) return;
    setError(null);
    const seeded = buildRig({ joints: MANUAL_JOINTS, warnings: [], bodyPlan: "biped", supported: [] }, prepared, raster.data);
    onRig({ ...seeded, source: "edited" });
    setSelectedJointId("root");
  }, [raster, prepared, onRig]);

  const updateJoints = useCallback((joints: Joint[], rebind = true) => {
    if (!rig) return;
    const next = { ...rig, joints, source: "edited" as const };
    onRig(rebind ? rebindWeights(next) : next);
  }, [rig, onRig]);

  const moveJoint = useCallback((id: string, x: number, y: number) => {
    if (!rig) return;
    updateJoints(rig.joints.map((joint) => joint.id === id ? { ...joint, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : joint), false);
  }, [rig, updateJoints]);

  const rebind = useCallback(() => { if (rig) onRig(rebindWeights(rig)); }, [rig, onRig]);

  const addJoint = useCallback((x: number, y: number) => {
    if (!rig || rig.joints.length >= 48) return;
    let n = 1;
    while (rig.joints.some((joint) => joint.id === `j${n}`)) n++;
    const joint = { id: `j${n}`, name: `Joint ${n}`, role: "other" as JointRole, x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), parent: rig.joints.some((candidate) => candidate.id === selectedJointId) ? selectedJointId : null };
    updateJoints([...rig.joints, joint]);
    setSelectedJointId(joint.id);
  }, [rig, selectedJointId, updateJoints]);

  const reparent = useCallback((id: string, parent: string | null) => {
    if (!rig) return;
    const target = rig.joints.find((joint) => joint.id === id);
    if (!target || target.parent === parent || parent === id) return;
    const descendants = new Set<string>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const joint of rig.joints) {
        if (joint.parent && descendants.has(joint.parent) && !descendants.has(joint.id)) {
          descendants.add(joint.id);
          changed = true;
        }
      }
    }
    if (parent && descendants.has(parent)) { setError("A joint cannot be parented to one of its descendants."); return; }
    if (parent === null && rig.joints.some((joint) => joint.id !== id && joint.parent === null)) {
      setError("A rig needs exactly one root joint.");
      return;
    }
    updateJoints(rig.joints.map((joint) => joint.id === id ? { ...joint, parent } : joint));
  }, [rig, updateJoints]);

  const deleteJoint = useCallback((id: string) => {
    if (!rig || rig.joints.length <= MIN_JOINTS) return;
    const deleted = rig.joints.find((joint) => joint.id === id);
    if (!deleted) return;
    const children = rig.joints.filter((joint) => joint.parent === id);
    let replacement: string | null = deleted.parent;
    if (deleted.parent === null && children.length > 0) replacement = children[0].id;
    const joints = rig.joints.filter((joint) => joint.id !== id).map((joint) => {
      if (joint.parent !== id) return joint;
      return { ...joint, parent: joint.id === replacement ? null : replacement };
    });
    updateJoints(joints);
    setSelectedJointId(replacement);
  }, [rig, updateJoints]);

  const renameJoint = useCallback((id: string, name: string) => {
    if (rig) updateJoints(rig.joints.map((joint) => joint.id === id ? { ...joint, name } : joint), false);
  }, [rig, updateJoints]);

  const setRole = useCallback((id: string, role: JointRole) => {
    if (rig) updateJoints(rig.joints.map((joint) => joint.id === id ? { ...joint, role } : joint), false);
  }, [rig, updateJoints]);

  const rebuildCuts = useCallback((cuts: CutLine[]) => {
    if (!rig || !raster) return;
    const mesh = buildMesh(raster.data, prepared.width, prepared.height, cuts);
    onRig({ ...rig, cuts, mesh, weights: buildWeights(mesh, rig.joints, cuts), source: "edited" });
  }, [rig, raster, prepared, onRig]);

  const addCut = useCallback((points: [number, number][]) => {
    if (!rig) return;
    let n = 1;
    while (rig.cuts.some((cut) => cut.id === `cut-${n}`)) n++;
    const cut = { id: `cut-${n}`, points };
    rebuildCuts([...rig.cuts, cut]);
    setSelectedCutId(cut.id);
  }, [rig, rebuildCuts]);

  const deleteCut = useCallback((id: string) => {
    if (!rig) return;
    rebuildCuts(rig.cuts.filter((cut) => cut.id !== id));
    setSelectedCutId(null);
  }, [rig, rebuildCuts]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (tool !== "cuts" || !activeSelectedCutId || (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteCut(activeSelectedCutId); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [tool, activeSelectedCutId, deleteCut]);

  const refreshSupport = useCallback(() => !rig || !raster ? null : applyLocalSupport(rig, raster.data, prepared.width, prepared.height), [rig, raster, prepared]);
  const invalidReason = rigInvalidReason(rig);

  return (
    <section className="border-2 border-zinc-950 bg-card p-5 text-card-foreground dark:border-zinc-100 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">03 / rig</p><h2 className="mt-1 text-xl font-black uppercase tracking-tight">Edit the rig</h2></div>{rig && <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{rig.source === "model" ? "Model draft" : "Edited by you"}</span>}</div>

      {!rig ? <div className="space-y-4"><p className="max-w-2xl text-xs uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Detect joint locations with vision analysis or start with a three-joint spine.</p><div className="flex flex-wrap gap-3"><button type="button" onClick={() => void analyze()} disabled={!raster || busy} className="flex items-center gap-2 bg-fuchsia-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white disabled:opacity-40">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Analyse rig</button><button type="button" onClick={startManual} disabled={!raster} className="border-2 border-zinc-950 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 dark:border-zinc-100">Place joints myself</button></div></div> : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="justify-self-center border border-zinc-300 dark:border-zinc-700" onPointerUp={tool === "joints" ? rebind : undefined}>
            <RigCanvas prepared={prepared} rig={rig} tool={tool} selectedBone={selectedBone} selectedJointId={activeSelectedJointId} selectedCutId={activeSelectedCutId} showMesh={showMesh} brushRadius={0.08} brushStrength={0.35} onJointDrag={moveJoint} onJointSelect={setSelectedJointId} onAddJoint={addJoint} onWeights={(weights) => onRig({ ...rig, weights, source: "edited" })} onAddCut={addCut} onCutSelect={setSelectedCutId} />
          </div>
          <div className="space-y-4">
            <div><p className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Tool</p><div className="flex flex-wrap gap-2">{(["joints", "cuts", "weights"] as const).map((option) => <button key={option} type="button" onClick={() => setTool(option)} aria-pressed={tool === option} className={cn("border px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-wider", tool === option ? "border-fuchsia-700 bg-fuchsia-700 text-white" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300")}>{option}</button>)}</div><p className="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">{tool === "joints" ? "Click empty artwork to add under the selected joint; drag or select a joint." : tool === "cuts" ? "Draw a line between parts. Select a red line, then delete it with Delete or the trash button." : "Paint influence for the selected bone."}</p></div>

            {tool === "joints" && <><button type="button" onClick={() => addJoint(0.5, 0.5)} className="flex w-full items-center gap-2 border border-zinc-300 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider dark:border-zinc-700"><Plus className="h-3.5 w-3.5" />Add joint</button>{selectedJoint && <div className="space-y-2 border border-zinc-300 p-3 dark:border-zinc-700"><div className="flex items-center justify-between"><span className="font-mono text-[10px] font-bold uppercase tracking-wider">Selected joint</span><span className="h-3 w-3" style={{ background: roleColor(selectedJoint.role) }} /></div><input aria-label="Joint name" value={selectedJoint.name} onChange={(event) => renameJoint(selectedJoint.id, event.target.value)} className="w-full border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700" /><select aria-label="Joint role" value={selectedJoint.role} onChange={(event) => setRole(selectedJoint.id, event.target.value as JointRole)} className="w-full border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700">{JOINT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select><select aria-label="Joint parent" value={selectedJoint.parent ?? ""} onChange={(event) => reparent(selectedJoint.id, event.target.value || null)} className="w-full border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"><option value="">No parent (root)</option>{rig.joints.filter((joint) => joint.id !== selectedJoint.id).map((joint) => <option key={joint.id} value={joint.id}>{joint.name}</option>)}</select><button type="button" onClick={() => deleteJoint(selectedJoint.id)} disabled={rig.joints.length <= MIN_JOINTS} className="flex items-center gap-2 text-xs text-red-600 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />Delete joint</button></div>}</>}

            {tool === "cuts" && <div className="space-y-2">{rig.cuts.map((cut) => <button key={cut.id} type="button" onClick={() => setSelectedCutId(cut.id)} className={cn("flex w-full items-center justify-between border px-2 py-1.5 text-left font-mono text-xs", cut.id === selectedCutId ? "border-fuchsia-700 text-fuchsia-700" : "border-zinc-300 dark:border-zinc-700")}><span>{cut.id}</span><Trash2 className="h-3.5 w-3.5" onClick={(event) => { event.stopPropagation(); deleteCut(cut.id); }} /></button>)}</div>}

            {tool === "weights" && <div><label htmlFor="anibuddy-bone" className="mb-2 block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">Bone</label><select id="anibuddy-bone" value={selectedBone} onChange={(event) => setSelectedBone(Number(event.target.value))} className="w-full border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700">{bones.map((bone, index) => <option key={bone.id} value={index}>{bone.parentJoint.name} to {bone.childJoint.name}</option>)}</select></div>}

            <button type="button" onClick={() => setShowMesh((current) => !current)} aria-pressed={showMesh} className={cn("flex w-full items-center gap-2 border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider", showMesh ? "border-fuchsia-700 text-fuchsia-700 dark:text-fuchsia-300" : "border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300")}><Grid3x3 className="h-3.5 w-3.5" />{showMesh ? "Hide mesh" : "Show mesh"}</button>
            <button type="button" onClick={() => onRig(null)} className="flex w-full items-center gap-2 border border-zinc-300 px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"><RotateCcw className="h-3.5 w-3.5" />Start rig over</button>
            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{rig.mesh.tris.length / 3} triangles / {bones.length} bones</p>
          </div>
        </div>
      )}

      {error && <p className="mt-4 border border-red-500 bg-red-50 px-3 py-2 text-sm leading-6 dark:bg-red-950/30">{error}</p>}
      {rig && rig.warnings.length > 0 && <ul className="mt-5 space-y-2 border-l-2 border-amber-500 pl-4">{rig.warnings.map((warning) => <li key={warning} className="flex gap-2 text-sm leading-6 text-zinc-700 dark:text-zinc-200"><TriangleAlert className="mt-1 h-3.5 w-3.5 shrink-0 text-amber-600" />{warning}</li>)}</ul>}
      {rig && <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-5 dark:border-zinc-700"><button type="button" onClick={() => { const refreshed = refreshSupport(); if (refreshed) onRig(rebindWeights(refreshed)); onContinue(); }} disabled={invalidReason !== null} className="bg-fuchsia-700 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-white disabled:cursor-not-allowed disabled:opacity-40">Continue to animation</button>{invalidReason && <span className="font-mono text-[10px] uppercase tracking-wider text-red-600 dark:text-red-400">{invalidReason}</span>}</div>}
    </section>
  );
}
