"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { useSpriteStudio } from "@/features/studio/hooks/useSpriteStudio";
import { SpriteStudio } from "@/features/studio/sprites/SpriteStudio";

export function SpritesScreen() {
  const sprites = useSpriteStudio();
  return (
    <SpriteStudio
      sheet={sprites.sheet}
      anchor={sprites.anchor}
      bodyPlan={sprites.bodyPlan}
      setBodyPlan={sprites.selectBodyPlan}
      selectedAnim={sprites.anim}
      setSelectedAnim={sprites.selectAnim}
      generatedAnims={sprites.generatedAnims}
      prompt={sprites.prompt}
      setPrompt={sprites.setPrompt}
      fps={sprites.fps}
      setFps={sprites.setFps}
      artStyle={sprites.artStyle}
      setArtStyle={sprites.setArtStyle}
      generating={sprites.generating}
      progressMessage={sprites.progressMsg}
      onGenerate={() => void sprites.handleGenerateSpriteSheet()}
      onRerollCharacter={sprites.handleRerollCharacter}
      onUploadCharacter={(file) => void sprites.handleUploadCharacter(file)}
      onRemoveUploadedCharacter={sprites.handleRemoveUploadedCharacter}
      onStop={sprites.handleStop}
      onClear={sprites.handleClear}
      onDownloadSheet={() => void sprites.handleDownloadSheet()}
      onDownloadZip={() => void sprites.handleDownloadZip()}
      onToggleFrame={sprites.handleToggleFrame}
    />
  );
}
