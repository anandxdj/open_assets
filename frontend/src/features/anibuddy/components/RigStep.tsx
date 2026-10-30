"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { CircleAlert, Droplet, Grid3x3, LoaderCircle, Plus, RotateCcw, Scissors, Sparkles, Spline, Trash2 } from "lucide-react";

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
import { buildRig, rebindWeights } from "@/features/anibuddy/lib/skeleton";
import { requestRigAnalysis, AniBuddyApiError } from "@/features/anibuddy/api/anibuddyClient";
import type { RigTool } from "@/features/anibuddy/components/RigCanvas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
import { Hint, Inspector, PanelSection, Prop, StageArea } from "@/features/anibuddy/components/WorkspacePanels";

const RigCanvas = dynamic(
  () => import("@/features/anibuddy/components/RigCanvas").then((mod) => mod.RigCanvas),
  { ssr: false, loading: () => <div className="oa-label grid h-72 w-72 place-items-center">Loading editor</div> },
);

const TOOLS: { id: RigTool; label: string; icon: typeof Spline }[] = [
  { id: "joints", label: "Joints", icon: Spline },
  { id: "cuts", label: "Cuts", icon: Scissors },
  { id: "weights", label: "Weights", icon: Droplet },
];

const TOOL_HELP: Record<RigTool, string> = {
  joints: "Click empty artwork to add a joint under the selected one. Drag a joint to move it, or click it to select it.",
  cuts: "Draw a line between parts. Select a cut to delete it with Delete or the trash button.",
  weights: "Paint influence for the selected bone.",
};

interface RigStepProps {
  prepared: PreparedAsset;
  rig: Rig | null;
  onRig: (rig: Rig | null) => void;
  /** Kept optional while Order 9 replaces the project reducer actions. */
  onEditJoint?: (jointId: string, x: number, y: number) => void;
  onWeights?: (weights: Float32Array) => void;
  onContinue: () => void;
}

function manualJoints(prepared: PreparedAsset): Joint[] {
  const top = Math.max(0, (prepared.bounds.baseline - prepared.bounds.height) / prepared.height);
  const bottom = Math.min(1, prepared.bounds.baseline / prepared.height);
  const centerX = Math.max(0, Math.min(1, prepared.bounds.centerX / prepared.width));
  const at = (progress: number) => top + (bottom - top) * progress;
  return [
    { id: "root", name: "Root", role: "root", x: centerX, y: at(0.72), parent: null },
    { id: "spine", name: "Spine", role: "spine", x: centerX, y: at(0.43), parent: "root" },
    { id: "head", name: "Head", role: "head", x: centerX, y: at(0.18), parent: "spine" },
  ];
}

export function RigStep({ prepared, rig, onRig, onContinue }: RigStepProps) {
  const id = useId();
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

  const startManual = useCallback((message?: string) => {
    if (!raster) return;
    setError(message ?? null);
    const seeded = buildRig({ joints: manualJoints(prepared), warnings: [] }, prepared, raster.data);
    onRig({ ...seeded, source: "edited" });
    setSelectedJointId("root");
  }, [raster, prepared, onRig]);

  const analyze = useCallback(async () => {
    if (!raster || busy) return;
    setBusy(true);
    setError(null);
    try {
      const analysis = await requestRigAnalysis({ image: prepared.dataUrl });
      try {
        onRig(buildRig(analysis, prepared, raster.data));
      } catch (cause) {
        console.warn("[anibuddy][rig] could not build the returned rig", cause);
        setError("Joint analysis succeeded, but its mesh could not be built. Place the starter joints yourself instead.");
      }
    } catch (cause) {
      if (cause instanceof AniBuddyApiError && cause.code === "RIG_ANALYSIS_INVALID") {
        startManual("Automatic analysis could not produce a safe joint graph. A starter rig is open for you to place and edit.");
      } else {
        setError(cause instanceof AniBuddyApiError ? cause.message : "Rig analysis failed. You can still place the joints yourself.");
      }
    } finally {
      setBusy(false);
    }
  }, [raster, busy, prepared, onRig, startManual]);

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

  const invalidReason = rigInvalidReason(rig);

  return (
    <>
      <StageArea label="Rig editor">
        <p role="status" aria-live="polite" className="sr-only">
          {busy ? "Analysing the rig…" : ""}
        </p>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 pb-20 md:p-8 md:pb-20">
          {rig ? (
            <div className="oa-checker flex-none border border-line" onPointerUp={tool === "joints" ? rebind : undefined}>
              <RigCanvas prepared={prepared} rig={rig} tool={tool} selectedBone={selectedBone} selectedJointId={activeSelectedJointId} selectedCutId={activeSelectedCutId} showMesh={showMesh} brushRadius={0.08} brushStrength={0.35} onJointDrag={moveJoint} onJointSelect={setSelectedJointId} onAddJoint={addJoint} onWeights={(weights) => onRig({ ...rig, weights, source: "edited" })} onAddCut={addCut} onCutSelect={setSelectedCutId} />
            </div>
          ) : (
            <div className="oa-checker relative h-full min-h-[300px] w-full max-w-[520px] border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={prepared.dataUrl} alt="Prepared artwork, not rigged yet" className="absolute inset-0 size-full object-contain p-6" />
              {busy && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[color-mix(in_srgb,var(--oa-surface)_70%,transparent)]">
                  <LoaderCircle aria-hidden className="size-8 animate-spin text-brand" />
                  <span className="text-xs leading-[18px] text-ink-2">Finding joints…</span>
                </div>
              )}
            </div>
          )}
        </div>

        {rig && (
          <div role="toolbar" aria-label="Rig tools" className="oa-float absolute bottom-4 left-1/2 -translate-x-1/2">
            {TOOLS.map(({ id: option, label, icon: Icon }) => (
              <button
                key={option}
                type="button"
                className="oa-tool"
                aria-label={label}
                title={label}
                aria-pressed={tool === option}
                onClick={() => setTool(option)}
              >
                <Icon aria-hidden />
              </button>
            ))}
            <span aria-hidden className="oa-vsep" />
            <button
              type="button"
              className="oa-tool"
              aria-label="Show mesh"
              title="Show mesh"
              aria-pressed={showMesh}
              onClick={() => setShowMesh((current) => !current)}
            >
              <Grid3x3 aria-hidden />
            </button>
          </div>
        )}
      </StageArea>

      <Inspector
        title="Rig"
        footer={
          rig && (
            <>
              <Button
                variant="primary"
                block
                disabled={invalidReason !== null}
                aria-describedby={invalidReason ? `${id}-invalid` : undefined}
                onClick={() => { onRig(rebindWeights(rig)); onContinue(); }}
              >
                Continue to animation
              </Button>
              {invalidReason && (
                <span id={`${id}-invalid`} className="oa-field-error">
                  <CircleAlert aria-hidden className="size-3.5 flex-none" />
                  {invalidReason}
                </span>
              )}
            </>
          )
        }
      >
        {!rig ? (
          <PanelSection>
            <div className="flex flex-wrap gap-1.5">
              <Button variant="primary" size="sm" className="flex-1" disabled={!raster || busy} onClick={() => void analyze()}>
                {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : <Sparkles aria-hidden />}
                Analyse rig
              </Button>
              <Button variant="secondary" size="sm" disabled={!raster} onClick={() => startManual()}>
                Place joints myself
              </Button>
            </div>
            <Hint>Find joints with vision analysis, or start from a three-joint spine and place the rest yourself.</Hint>
          </PanelSection>
        ) : (
          <>
            <PanelSection
              title={TOOLS.find((option) => option.id === tool)?.label}
              aside={<Badge>{rig.source === "model" ? "Model draft" : "Edited by you"}</Badge>}
            >
              <Hint>{TOOL_HELP[tool]}</Hint>
              <span className="oa-value text-ink-3">
                {rig.joints.length} joints · {bones.length} bones · {rig.mesh.tris.length / 3} triangles
              </span>
            </PanelSection>

            {tool === "joints" && (
              <PanelSection title="Selected joint">
                {selectedJoint ? (
                  <>
                    <Prop label="Name" htmlFor={`${id}-name`}>
                      <Input id={`${id}-name`} size="sm" value={selectedJoint.name} onChange={(event) => renameJoint(selectedJoint.id, event.target.value)} />
                    </Prop>
                    <Prop label="Role" htmlFor={`${id}-role`}>
                      <Select id={`${id}-role`} size="sm" value={selectedJoint.role} onChange={(event) => setRole(selectedJoint.id, event.target.value as JointRole)}>
                        {JOINT_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                      </Select>
                    </Prop>
                    <Prop label="Parent" htmlFor={`${id}-parent`}>
                      <Select id={`${id}-parent`} size="sm" value={selectedJoint.parent ?? ""} onChange={(event) => reparent(selectedJoint.id, event.target.value || null)}>
                        <option value="">No parent (root)</option>
                        {rig.joints.filter((joint) => joint.id !== selectedJoint.id).map((joint) => <option key={joint.id} value={joint.id}>{joint.name}</option>)}
                      </Select>
                    </Prop>
                    <Prop label="Position">
                      <div className="grid grid-cols-2 gap-1.5">
                        {(["x", "y"] as const).map((axis) => (
                          <label key={axis} className="oa-unit-input">
                            <span>{axis.toUpperCase()}</span>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              aria-label={axis === "x" ? "X position, percent of width" : "Y position, percent of height"}
                              value={Math.round(selectedJoint[axis] * 100)}
                              onChange={(event) => {
                                const value = Number(event.target.value);
                                if (!Number.isFinite(value)) return;
                                moveJoint(
                                  selectedJoint.id,
                                  axis === "x" ? value / 100 : selectedJoint.x,
                                  axis === "y" ? value / 100 : selectedJoint.y,
                                );
                              }}
                              onBlur={rebind}
                            />
                            <span>%</span>
                          </label>
                        ))}
                      </div>
                    </Prop>
                    <div className="flex flex-wrap gap-1.5">
                      <Button variant="secondary" size="sm" disabled={rig.joints.length >= 48} onClick={() => addJoint(0.5, 0.5)}>
                        <Plus aria-hidden />
                        Add joint
                      </Button>
                      <Button variant="danger" size="sm" disabled={rig.joints.length <= MIN_JOINTS} onClick={() => deleteJoint(selectedJoint.id)}>
                        <Trash2 aria-hidden />
                        Delete
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Hint>Select a joint on the artwork to edit it.</Hint>
                    <Button variant="secondary" size="sm" className="self-start" disabled={rig.joints.length >= 48} onClick={() => addJoint(0.5, 0.5)}>
                      <Plus aria-hidden />
                      Add joint
                    </Button>
                  </>
                )}
              </PanelSection>
            )}

            {tool === "cuts" && (
              <PanelSection title="Cuts">
                {rig.cuts.length === 0 ? (
                  <Hint>No cuts yet. Draw one on the artwork.</Hint>
                ) : (
                  <ul className="flex flex-col gap-px">
                    {rig.cuts.map((cut) => (
                      <li key={cut.id} className="oa-layer pr-1" data-selected={cut.id === activeSelectedCutId}>
                        <button
                          type="button"
                          aria-pressed={cut.id === activeSelectedCutId}
                          onClick={() => setSelectedCutId(cut.id)}
                          className="oa-value h-full flex-1 truncate text-left"
                        >
                          {cut.id}
                        </button>
                        <Button variant="ghost" size="sm" icon aria-label={`Delete ${cut.id}`} onClick={() => deleteCut(cut.id)}>
                          <Trash2 aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelSection>
            )}

            {tool === "weights" && (
              <PanelSection title="Weights">
                <Field label="Bone" htmlFor={`${id}-bone`}>
                  <Select id={`${id}-bone`} size="sm" value={selectedBone} onChange={(event) => setSelectedBone(Number(event.target.value))}>
                    {bones.map((bone, index) => <option key={bone.id} value={index}>{bone.parentJoint.name} to {bone.childJoint.name}</option>)}
                  </Select>
                </Field>
              </PanelSection>
            )}

            {rig.warnings.length > 0 && (
              <PanelSection title="Warnings">
                <Notice tone="warning">
                  <ul className="flex flex-col gap-1">
                    {rig.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                </Notice>
              </PanelSection>
            )}

            <PanelSection className="border-b-0">
              <Button variant="ghost" size="sm" className="self-start px-1 text-danger" onClick={() => onRig(null)}>
                <RotateCcw aria-hidden />
                Start rig over
              </Button>
            </PanelSection>
          </>
        )}

        {error && (
          <PanelSection className="border-b-0">
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          </PanelSection>
        )}
      </Inspector>
    </>
  );
}
