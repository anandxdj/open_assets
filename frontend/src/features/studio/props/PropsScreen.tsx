"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { PROP_BATCH } from "@/features/studio/lib/props";
import { usePropStudio } from "@/features/studio/hooks/usePropStudio";
import { PropStudio } from "@/features/studio/props/PropStudio";

export function PropsScreen() {
  const props = usePropStudio();
  return (
    <PropStudio
      items={props.propItems}
      batchSize={PROP_BATCH}
      prompt={props.propPrompt}
      setPrompt={props.setPropPrompt}
      artStyle={props.artStyle}
      setArtStyle={props.setArtStyle}
      generating={props.generating}
      progressMessage={props.progressMsg}
      sceneBrief={props.sceneBrief}
      setSceneBrief={props.setSceneBrief}
      sceneBriefLoading={props.sceneBriefLoading}
      onAddMore={() => void props.handleAddPropBatch()}
      onStop={props.handleStopPropSet}
      onRegenerate={(id) => void props.handleRegenerateProp(id)}
      onDelete={props.handleDeleteProp}
      onClearAll={props.handleClearPropSet}
      onDownloadSheet={() => void props.handleDownloadPropSheet()}
      onDownloadZip={() => void props.handleDownloadPropZip()}
    />
  );
}
