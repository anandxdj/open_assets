"use client";
// Adapted from boona13/image-extender (MIT) - https://github.com/boona13/image-extender

import { useTileStudio } from "@/features/studio/hooks/useTileStudio";
import { TileStudio } from "@/features/studio/tiles/TileStudio";

export function TilesScreen() {
  const tiles = useTileStudio();
  return (
    <TileStudio
      tileSet={tiles.tileSet}
      prompt={tiles.tilePrompt}
      setPrompt={tiles.setTilePrompt}
      artStyle={tiles.artStyle}
      setArtStyle={tiles.setArtStyle}
      generating={tiles.generating}
      progressMessage={tiles.progressMsg}
      sceneBrief={tiles.sceneBrief}
      setSceneBrief={tiles.setSceneBrief}
      sceneBriefLoading={tiles.sceneBriefLoading}
      onGenerateAll={() => void tiles.handleGenerateTileSet()}
      onStop={tiles.handleStopTileSet}
      onRegenerate={(role) => void tiles.handleRegenerateTile(role)}
      onClearAll={tiles.handleClearTileSet}
      onDownloadSheet={() => void tiles.handleDownloadTileSheet()}
      onDownloadZip={() => void tiles.handleDownloadTileSetZip()}
    />
  );
}
