"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Line, Stage } from "react-konva";
import type Konva from "konva";

import {
  type Joint,
  type PreparedAsset,
  type Rig,
  getBones,
} from "@/features/anibuddy/types";
import { loadImageElement } from "@/features/anibuddy/lib/raster";
import { normalizeRows } from "@/features/anibuddy/lib/mesh";

/**
 * Konva earns its place here on one thing: drag hit-testing on sixteen small
 * circles over a bitmap, with per-node bounds clamping. Everything else on this
 * screen is plain canvas.
 *
 * This component is loaded with `ssr: false` — Konva touches `window` at import
 * time.
 */

const JOINT_RADIUS = 7;
/** Invisible padding so small joints stay grabbable on a touch screen. */
const HIT_RADIUS = 16;
const MAX_STAGE_EDGE = 520;

export type RigTool = "joints" | "weights";

interface RigCanvasProps {
  prepared: PreparedAsset;
  rig: Rig;
  tool: RigTool;
  selectedBone: number;
  showMesh: boolean;
  brushRadius: number;
  brushStrength: number;
  onJointDrag: (jointId: string, x: number, y: number) => void;
  onWeights: (weights: Float32Array) => void;
}

export function RigCanvas({
  prepared,
  rig,
  tool,
  selectedBone,
  showMesh,
  brushRadius,
  brushStrength,
  onJointDrag,
  onWeights,
}: RigCanvasProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const painting = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void loadImageElement(prepared.dataUrl).then((loaded) => {
      if (!cancelled) setImage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [prepared.dataUrl]);

  // Fit the stage to the panel while keeping normalized coords the source of
  // truth — scale is display-only and never written back into the rig.
  const scale = Math.min(
    1,
    MAX_STAGE_EDGE / Math.max(prepared.width, prepared.height),
  );
  const stageWidth = Math.round(prepared.width * scale);
  const stageHeight = Math.round(prepared.height * scale);

  const toStage = (joint: Joint) => ({
    x: joint.x * stageWidth,
    y: joint.y * stageHeight,
  });

  const bones = useMemo(() => getBones(rig.joints), [rig.joints]);

  const weightColour = useMemo(() => {
    if (!showMesh && tool !== "weights") return null;
    const boneCount = bones.length;
    if (boneCount === 0 || selectedBone >= boneCount) return null;
    return (vertex: number) => rig.weights[vertex * boneCount + selectedBone] ?? 0;
  }, [showMesh, tool, bones.length, selectedBone, rig.weights]);

  const paintAt = (stageX: number, stageY: number) => {
    const boneCount = bones.length;
    if (boneCount === 0 || selectedBone >= boneCount) return;

    const x = stageX / stageWidth;
    const y = stageY / stageHeight;
    const next = Float32Array.from(rig.weights);
    const touched: number[] = [];

    for (let v = 0; v < rig.mesh.verts.length / 2; v++) {
      const dx = rig.mesh.verts[v * 2] - x;
      const dy = rig.mesh.verts[v * 2 + 1] - y;
      const distance = Math.hypot(dx, dy);
      if (distance > brushRadius) continue;

      // Smooth falloff, so a brush stroke does not leave a hard disc edge that
      // shows up as a crease when the bone moves.
      const falloff = 1 - distance / brushRadius;
      const index = v * boneCount + selectedBone;
      next[index] = Math.min(1, next[index] + brushStrength * falloff * falloff);
      touched.push(v);
    }

    if (touched.length === 0) return;
    normalizeRows(next, boneCount, touched);
    onWeights(next);
  };

  const handlePointer = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (tool !== "weights" || !painting.current) return;
    const position = event.target.getStage()?.getPointerPosition();
    if (position) paintAt(position.x, position.y);
  };

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      onPointerDown={(event: Konva.KonvaEventObject<PointerEvent>) => {
        if (tool !== "weights") return;
        painting.current = true;
        handlePointer(event);
      }}
      onPointerMove={handlePointer}
      onPointerUp={() => {
        painting.current = false;
      }}
      onPointerLeave={() => {
        painting.current = false;
      }}
      style={{ cursor: tool === "weights" ? "crosshair" : "default" }}
    >
      <Layer listening={false}>
        {image && <KonvaImage image={image} width={stageWidth} height={stageHeight} alt="" />}
      </Layer>

      {(showMesh || tool === "weights") && (
        <Layer listening={false} opacity={0.75}>
          {Array.from({ length: rig.mesh.tris.length / 3 }, (_, triangle) => {
            const indices = [
              rig.mesh.tris[triangle * 3],
              rig.mesh.tris[triangle * 3 + 1],
              rig.mesh.tris[triangle * 3 + 2],
            ];
            const points = indices.flatMap((index) => [
              rig.mesh.verts[index * 2] * stageWidth,
              rig.mesh.verts[index * 2 + 1] * stageHeight,
            ]);

            // Heat by the selected bone's average influence over the triangle,
            // so painted weights are visible rather than inferred.
            const heat = weightColour
              ? indices.reduce((sum, index) => sum + weightColour(index), 0) / 3
              : 0;

            return (
              <Line
                key={triangle}
                points={points}
                closed
                stroke="rgba(24,24,27,0.35)"
                strokeWidth={0.5}
                fill={heat > 0.01 ? `rgba(192,38,211,${Math.min(0.6, heat * 0.6)})` : undefined}
              />
            );
          })}
        </Layer>
      )}

      <Layer listening={false}>
        {bones.map((bone, index) => {
          const from = toStage(bone.parentJoint);
          const to = toStage(bone.childJoint);
          const active = tool === "weights" && index === selectedBone;
          return (
            <Line
              key={bone.id}
              points={[from.x, from.y, to.x, to.y]}
              stroke={active ? "#c026d3" : "rgba(9,9,11,0.75)"}
              strokeWidth={active ? 4 : 2.5}
              lineCap="round"
            />
          );
        })}
      </Layer>

      <Layer listening={tool === "joints"}>
        {rig.joints.map((joint) => {
          const position = toStage(joint);
          return (
            <Circle
              key={joint.id}
              x={position.x}
              y={position.y}
              radius={JOINT_RADIUS}
              hitStrokeWidth={HIT_RADIUS}
              fill={hovered === joint.id ? "#c026d3" : "#fafafa"}
              stroke="#09090b"
              strokeWidth={2}
              draggable={tool === "joints"}
              onMouseEnter={() => setHovered(joint.id)}
              onMouseLeave={() => setHovered((current) => (current === joint.id ? null : current))}
              // Clamp inside the artwork: a joint outside [0,1] fails
              // `rigInvalidReason` and would lock the export step.
              dragBoundFunc={(position) => ({
                x: Math.max(0, Math.min(stageWidth, position.x)),
                y: Math.max(0, Math.min(stageHeight, position.y)),
              })}
              onDragMove={(event: Konva.KonvaEventObject<DragEvent>) =>
                onJointDrag(
                  joint.id,
                  event.target.x() / stageWidth,
                  event.target.y() / stageHeight,
                )
              }
            />
          );
        })}
      </Layer>
    </Stage>
  );
}
