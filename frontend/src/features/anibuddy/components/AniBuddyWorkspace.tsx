"use client";

import { useState } from "react";

import { useAniBuddyProject, stepLockReason } from "@/features/anibuddy/hooks/useAniBuddyProject";
import { type StepId } from "@/features/anibuddy/types";
import { StepRail } from "@/features/anibuddy/components/StepRail";
import { ConceptStep } from "@/features/anibuddy/components/ConceptStep";
import { SourceStep } from "@/features/anibuddy/components/SourceStep";
import { PrepareStep } from "@/features/anibuddy/components/PrepareStep";
import { RigStep } from "@/features/anibuddy/components/RigStep";
import { AnimateStep } from "@/features/anibuddy/components/AnimateStep";
import { ExportStep } from "@/features/anibuddy/components/ExportStep";

export function AniBuddyWorkspace() {
  const project = useAniBuddyProject();
  const { project: state, step: derivedStep } = project;

  // The rail lets you walk back into finished steps, so the panel on screen is
  // its own piece of UI state. `derivedStep` remains the source of truth for
  // what is *reachable* — this only tracks what is *shown*.
  const [selected, setSelected] = useState<StepId | null>(null);
  const [lastDerived, setLastDerived] = useState(derivedStep);

  // Adjusting state during render rather than in an effect: the pipeline moving
  // forward (a prepared asset appearing, say) drops the manual selection so the
  // new step shows immediately, with no frame of the stale panel in between.
  if (lastDerived !== derivedStep) {
    setLastDerived(derivedStep);
    setSelected(null);
  }

  // A selection that has since become locked — the artwork was replaced, say —
  // falls back rather than stranding the user on a dead panel.
  const activeStep =
    selected && stepLockReason(state, selected) === null ? selected : derivedStep;

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8 sm:py-11">
      <header className="border-b-2 border-zinc-950 pb-5 dark:border-zinc-100">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-fuchsia-700 dark:text-fuchsia-300">
          AniBuddy / local character motion
        </p>
        <h1 className="mt-2 text-2xl font-black uppercase tracking-tight">
          Animate the art you already own
        </h1>
      </header>

      <div className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="space-y-7" aria-label="AniBuddy project setup">
          {activeStep === "concept" && (
            <ConceptStep
              idea={state.concept.idea}
              prompt={state.concept.prompt}
              onIdea={project.setIdea}
              onPrompt={project.setPrompt}
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
              motion={state.motion}
              fps={state.fps}
              frameCount={state.frameCount}
              onMotion={project.setMotion}
              onFps={project.setFps}
              onFrameCount={project.setFrameCount}
              onContinue={() => setSelected("export")}
            />
          )}

          {activeStep === "export" && state.prepared && state.rig && state.motion && (
            <ExportStep
              project={state}
              prepared={state.prepared}
              rig={state.rig}
              motion={state.motion}
              onBackground={project.setBackground}
            />
          )}
        </section>

        <aside className="space-y-4">
          <StepRail project={state} activeStep={activeStep} onSelect={setSelected} />

          <div className="pt-2">
            <button
              type="button"
              onClick={project.reset}
              className="w-full text-center font-mono text-[10px] font-bold uppercase tracking-wider text-zinc-500 underline underline-offset-4 hover:text-zinc-950 dark:hover:text-zinc-100"
            >
              Start a new project
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
