"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Crumbs, Topbar } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { DemoModeNotice } from "@/components/ui/demo-mode";
import { useAniBuddyProject, stepLockReason } from "@/features/anibuddy/hooks/useAniBuddyProject";
import { STEP_ORDER, type StepId } from "@/features/anibuddy/types";
import { StepRail } from "@/features/anibuddy/components/StepRail";
import { ConceptStep } from "@/features/anibuddy/components/ConceptStep";
import { SourceStep } from "@/features/anibuddy/components/SourceStep";
import { PrepareStep } from "@/features/anibuddy/components/PrepareStep";
import { RigStep } from "@/features/anibuddy/components/RigStep";
import { AnimateStep } from "@/features/anibuddy/components/AnimateStep";
import { ExportStep } from "@/features/anibuddy/components/ExportStep";
import { CreditsBadge, CreditsNotice } from "@/features/usage/CreditsBadge";

const AI_STEPS: StepId[] = ["concept", "rig", "animate"];

export function AniBuddyWorkspace() {
  const project = useAniBuddyProject();
  const { project: state, step: derivedStep } = project;
  const activeClip = state.clips.find((clip) => clip.id === state.activeClipId) ?? state.clips[0] ?? null;
  const [selected, setSelected] = useState<StepId | null>(null);
  const [lastDerived, setLastDerived] = useState(derivedStep);
  if (lastDerived !== derivedStep) {
    setLastDerived(derivedStep);
    // Finishing a step opens the next one by default, but its result (the
    // cut-out, the joints, the motion) still needs a look, and "Place joints
    // myself" only seeds a starter rig. Stay on the finished step until the
    // user continues. Bigger jumps (importing a project) go straight there.
    const advanced = STEP_ORDER[STEP_ORDER.indexOf(lastDerived) + 1] === derivedStep;
    setSelected((current) => (advanced ? (current ?? lastDerived) : null));
  }
  const activeStep = selected && stepLockReason(state, selected) === null ? selected : derivedStep;

  return (
    <>
      <Topbar>
        <Crumbs items={[{ label: "AniBuddy", href: "/anibuddy" }, { label: state.source?.name ? <span className="normal-case">{state.source.name}</span> : "New character" }]} />
        <span className="flex-1" />
        <CreditsBadge />
        <Button variant="ghost" size="sm" onClick={project.reset} title="Start a new project">
          <RotateCcw aria-hidden />
          <span className="max-sm:sr-only">Start a new project</span>
        </Button>
      </Topbar>
      <h1 className="sr-only">AniBuddy</h1>
      <CreditsNotice>
        <span className="text-xs leading-[18px] text-ink-2">AniBuddy cannot use your own key.</span>
      </CreditsNotice>

      {/* The steps with an AI action (concept, rig, animate) show this by their button; the others
          have none, so it sits here and a demo-mode project never looks silently broken. */}
      {!AI_STEPS.includes(activeStep) && <DemoModeNotice className="mx-3 mt-3 flex-none" />}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-sunken pb-14 md:pb-0 lg:grid lg:grid-cols-[minmax(0,1fr)_288px] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden xl:flex xl:flex-row">
        <StepRail project={state} activeStep={activeStep} onSelect={setSelected} />
        {activeStep === "concept" && (
          <ConceptStep
            idea={state.concept.idea}
            prompt={state.concept.prompt}
            transcript={state.concept.transcript}
            onIdea={project.setIdea}
            onPrompt={project.setPrompt}
            onTranscript={project.setTranscript}
            onSkip={() => setSelected("source")}
          />
        )}
        {activeStep === "source" && (
          <SourceStep
            source={state.source}
            rightsConfirmed={state.rightsConfirmed}
            pending={project.pendingRestore}
            onSource={project.setSource}
            onRights={project.confirmRights}
            onPending={project.setPendingRestore}
            onImportProject={project.importProject}
            onContinue={() => setSelected("prepare")}
          />
        )}
        {activeStep === "prepare" && state.source && (
          <PrepareStep
            source={state.source}
            prepared={state.prepared}
            onPrepared={project.setPrepared}
            onContinue={() => setSelected("rig")}
          />
        )}
        {activeStep === "rig" && state.prepared && (
          <RigStep
            prepared={state.prepared}
            rig={state.rig}
            onRig={project.setRig}
            onEditJoint={project.editJoint}
            onWeights={project.setWeights}
            onContinue={() => setSelected("animate")}
          />
        )}
        {activeStep === "animate" && state.prepared && state.rig && (
          <AnimateStep
            prepared={state.prepared}
            rig={state.rig}
            clips={state.clips}
            activeClipId={state.activeClipId}
            fps={state.fps}
            frameCount={state.frameCount}
            onFps={project.setFps}
            onFrameCount={project.setFrameCount}
            onAddClip={project.addClip}
            onSetActive={project.setActiveClip}
            onUpsert={project.upsertKeyframe}
            onMove={project.moveKeyframe}
            onRemove={project.removeKeyframe}
            onDelete={project.deleteClip}
            onToggleLoop={project.toggleClipLoop}
            onRename={project.renameClip}
            onContinue={() => setSelected("export")}
          />
        )}
        {activeStep === "export" && state.prepared && state.rig && activeClip && (
          <ExportStep
            project={state}
            prepared={state.prepared}
            rig={state.rig}
            clip={activeClip}
            onBackground={project.setBackground}
          />
        )}
      </div>
    </>
  );
}
