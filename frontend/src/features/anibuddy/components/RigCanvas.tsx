"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Line, Stage } from "react-konva";
import type Konva from "konva";
import { type Joint, type PreparedAsset, type Rig, getBones } from "@/features/anibuddy/types";
import { loadImageElement } from "@/features/anibuddy/lib/raster";
import { normalizeRows } from "@/features/anibuddy/lib/mesh";
import { roleColor } from "@/features/anibuddy/lib/skeleton";

const JOINT_RADIUS = 7;
const HIT_RADIUS = 16;
const MAX_STAGE_EDGE = 520;

export type RigTool = "joints" | "cuts" | "weights";

interface RigCanvasProps {
  prepared: PreparedAsset;
  rig: Rig;
  tool: RigTool;
  selectedBone: number;
  selectedJointId: string | null;
  selectedCutId: string | null;
  showMesh: boolean;
  brushRadius: number;
  brushStrength: number;
  onJointDrag: (jointId: string, x: number, y: number) => void;
  onJointSelect: (jointId: string | null) => void;
  onAddJoint: (x: number, y: number) => void;
  onWeights: (weights: Float32Array) => void;
  onAddCut: (points: [number, number][]) => void;
  onCutSelect: (cutId: string | null) => void;
}

export function RigCanvas({ prepared, rig, tool, selectedBone, selectedJointId, selectedCutId, showMesh, brushRadius, brushStrength, onJointDrag, onJointSelect, onAddJoint, onWeights, onAddCut, onCutSelect }: RigCanvasProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [draftCut, setDraftCut] = useState<[number, number][]>([]);
  const painting = useRef(false);
  const drawingCut = useRef<[number, number][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadImageElement(prepared.dataUrl).then((loaded) => { if (!cancelled) setImage(loaded); });
    return () => { cancelled = true; };
  }, [prepared.dataUrl]);

  const scale = Math.min(1, MAX_STAGE_EDGE / Math.max(prepared.width, prepared.height));
  const stageWidth = Math.round(prepared.width * scale);
  const stageHeight = Math.round(prepared.height * scale);
  const toStage = (joint: Joint) => ({ x: joint.x * stageWidth, y: joint.y * stageHeight });
  const bones = useMemo(() => getBones(rig.joints), [rig.joints]);

  const weightColour = useMemo(() => {
    if (!showMesh && tool !== "weights") return null;
    const boneCount = bones.length;
    if (boneCount === 0 || selectedBone >= boneCount) return null;
    return (vertex: number) => rig.weights[vertex * boneCount + selectedBone] ?? 0;
  }, [showMesh, tool, bones.length, selectedBone, rig.weights]);

  // R6: keep weight-brush math unchanged.
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
      const falloff = 1 - distance / brushRadius;
      const index = v * boneCount + selectedBone;
      next[index] = Math.min(1, next[index] + brushStrength * falloff * falloff);
      touched.push(v);
    }
    if (touched.length === 0) return;
    normalizeRows(next, boneCount, touched);
    onWeights(next);
  };

  const pointerPosition = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const position = event.target.getStage()?.getPointerPosition();
    if (!position) return null;
    return [Math.max(0, Math.min(1, position.x / stageWidth)), Math.max(0, Math.min(1, position.y / stageHeight))] as [number, number];
  };
  const paintPointer = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (tool !== "weights" || !painting.current) return;
    const position = event.target.getStage()?.getPointerPosition();
    if (position) paintAt(position.x, position.y);
  };
  const startCut = (event: Konva.KonvaEventObject<PointerEvent>) => {
    const point = pointerPosition(event);
    if (!point) return;
    drawingCut.current = [point];
    setDraftCut([point]);
    onCutSelect(null);
  };
  const extendCut = (event: Konva.KonvaEventObject<PointerEvent>) => {
    if (!drawingCut.current) return;
    const point = pointerPosition(event);
    if (!point) return;
    const last = drawingCut.current[drawingCut.current.length - 1];
    if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 0.002) return;
    drawingCut.current = [...drawingCut.current, point];
    setDraftCut(drawingCut.current);
  };
  const finishCut = () => {
    const points = drawingCut.current;
    drawingCut.current = null;
    setDraftCut([]);
    if (points && points.length >= 2) onAddCut(points);
  };

  return (
    <Stage width={stageWidth} height={stageHeight}
      onPointerDown={(event: Konva.KonvaEventObject<PointerEvent>) => {
        if (tool === "weights") { painting.current = true; paintPointer(event); }
        else if (tool === "cuts") startCut(event);
      }}
      onPointerMove={(event: Konva.KonvaEventObject<PointerEvent>) => { paintPointer(event); if (tool === "cuts") extendCut(event); }}
      onPointerUp={() => { painting.current = false; if (tool === "cuts") finishCut(); }}
      onPointerLeave={() => { painting.current = false; if (tool === "cuts") finishCut(); }}
      onClick={(event: Konva.KonvaEventObject<MouseEvent>) => {
        if (tool !== "joints" || event.target !== event.target.getStage()) return;
        const position = event.target.getStage()?.getPointerPosition();
        if (position) onAddJoint(position.x / stageWidth, position.y / stageHeight);
      }}
      style={{ cursor: tool === "joints" ? "default" : "crosshair" }}>
      <Layer listening={false}>{image && <KonvaImage image={image} width={stageWidth} height={stageHeight} alt="" />}</Layer>

      {(showMesh || tool === "weights") && <Layer listening={false} opacity={0.75}>
        {Array.from({ length: rig.mesh.tris.length / 3 }, (_, triangle) => {
          const indices = [rig.mesh.tris[triangle * 3], rig.mesh.tris[triangle * 3 + 1], rig.mesh.tris[triangle * 3 + 2]];
          const points = indices.flatMap((index) => [rig.mesh.verts[index * 2] * stageWidth, rig.mesh.verts[index * 2 + 1] * stageHeight]);
          const heat = weightColour ? indices.reduce((sum, index) => sum + weightColour(index), 0) / 3 : 0;
          return <Line key={triangle} points={points} closed stroke="rgba(24,24,27,0.35)" strokeWidth={0.5} fill={heat > 0.01 ? `rgba(192,38,211,${Math.min(0.6, heat * 0.6)})` : undefined} />;
        })}
      </Layer>}

      <Layer listening={false}>{bones.map((bone, index) => {
        const from = toStage(bone.parentJoint);
        const to = toStage(bone.childJoint);
        const active = tool === "weights" && index === selectedBone;
        return <Line key={bone.id} points={[from.x, from.y, to.x, to.y]} stroke={active ? "#c026d3" : roleColor(bone.childJoint.role)} strokeWidth={active ? 4 : 2.5} lineCap="round" />;
      })}</Layer>

      <Layer listening={tool === "cuts"}>
        {rig.cuts.map((cut) => <Line key={cut.id} points={cut.points.flatMap(([x, y]) => [x * stageWidth, y * stageHeight])} stroke={cut.id === selectedCutId ? "#c026d3" : "#ef4444"} strokeWidth={cut.id === selectedCutId ? 3 : 2} lineCap="round" hitStrokeWidth={14}
          onPointerDown={(event: Konva.KonvaEventObject<PointerEvent>) => { event.cancelBubble = true; }}
          onClick={(event: Konva.KonvaEventObject<MouseEvent>) => { event.cancelBubble = true; onCutSelect(cut.id); }} />)}
        {draftCut.length > 1 && <Line points={draftCut.flatMap(([x, y]) => [x * stageWidth, y * stageHeight])} stroke="#c026d3" strokeWidth={2} dash={[5, 4]} lineCap="round" />}
      </Layer>

      <Layer listening={tool === "joints"}>
        {rig.joints.map((joint) => {
          const position = toStage(joint);
          const selected = selectedJointId === joint.id;
          return <Circle key={joint.id} x={position.x} y={position.y} radius={JOINT_RADIUS} hitStrokeWidth={HIT_RADIUS} fill={roleColor(joint.role)} opacity={selectedJointId === null || selected ? 1 : 0.7} stroke={selected || hovered === joint.id ? "#c026d3" : "#fafafa"} strokeWidth={selected ? 3 : 2} draggable={tool === "joints"}
            onClick={(event: Konva.KonvaEventObject<MouseEvent>) => { event.cancelBubble = true; onJointSelect(joint.id); }}
            onMouseEnter={() => setHovered(joint.id)}
            onMouseLeave={() => setHovered((current) => current === joint.id ? null : current)}
            dragBoundFunc={(position) => ({ x: Math.max(0, Math.min(stageWidth, position.x)), y: Math.max(0, Math.min(stageHeight, position.y)) })}
            onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => onJointDrag(joint.id, event.target.x() / stageWidth, event.target.y() / stageHeight)} />;
        })}
      </Layer>
    </Stage>
  );
}
