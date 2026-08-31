// WebGL2 renderer for the layered cutout preview.
//
// This replaces the retained-mode Canvas 2D path the v3 editor used, where every
// deformed triangle was a Konva <Line> node and the whole scene graph -- around
// 2,400 nodes on a single mesh part -- was rebuilt on every React render. Two
// things change:
//
//   1. Geometry is uploaded as ONE indexed draw call per part. A 64-part rig is
//      64 draw calls, not tens of thousands of retained nodes.
//   2. The per-triangle affine warp disappears. Clipping and warping each source
//      triangle by hand is what a rasterizer without interpolated texture
//      coordinates has to do; a GPU is given the rest position as a texcoord and
//      the posed position as a vertex, and the interpolation across the triangle
//      IS the affine map A = D * S^-1 that the kernel's warp matrices describe.
//
// A consequence worth stating so nobody re-adds it: SEAM_BLEED is not applied
// here. That outward push exists to close hairline antialiasing gaps between
// separately clipped Canvas 2D triangles. An indexed GPU mesh shares vertices
// between adjacent triangles, so there are no gaps to close, and pushing
// triangles apart would open real ones.
//
// A second thing not to re-add: there is no per-part matrix uniform. The part
// transform tree is composed by the kernel and already folded into `dstVerts`,
// so a matrix here would apply it twice -- and a matrix built browser-side could
// only ever describe a root part, because it has no parent chain to walk.
//
// The kernel is still the only thing that decides where a vertex goes. This file
// draws what it is handed and never derives geometry (R5).

import type { KernelFrame, PartGeometry } from "@/features/anibuddy/kernel/index.kernel";
import { EditorConstants } from "./editor.constants";
import type { ViewportTransform } from "./editor.types";

const POSITION_LOCATION = 0;
const UV_LOCATION = 1;

const VERTEX_SHADER = `#version 300 es
layout(location = ${POSITION_LOCATION}) in vec2 aPosed;
layout(location = ${UV_LOCATION}) in vec2 aRest;

// Source pixels -> clip space. Built on the CPU because it changes once per
// resize, not once per part.
uniform mat3 uProjection;
uniform vec2 uSheetSize;
// Sprite-swap remap: vUv = rest/sheet * uUvRemap.xy + uUvRemap.zw.
uniform vec4 uUvRemap;

out vec2 vUv;

void main() {
  // aPosed already carries the part tree's world transform; the kernel baked it
  // into dstVerts. This is a projection and nothing else.
  vec3 posed = uProjection * vec3(aPosed, 1.0);
  gl_Position = vec4(posed.xy, 0.0, 1.0);
  vUv = (aRest / uSheetSize) * uUvRemap.xy + uUvRemap.zw;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

uniform sampler2D uSheet;
uniform float uOpacity;
// rgb + mix strength. Strength 0 leaves the artwork untouched.
uniform vec4 uTint;
// 1 when drawing the wireframe overlay, which ignores the texture entirely.
uniform float uFlat;

in vec2 vUv;
out vec4 outColor;

void main() {
  if (uFlat > 0.5) {
    outColor = vec4(uTint.rgb, uTint.a);
    return;
  }
  vec4 texel = texture(uSheet, vUv);
  outColor = vec4(mix(texel.rgb, uTint.rgb, uTint.a), texel.a * uOpacity);
}`;

/**
 * Everything the renderer needs to know about one part, beyond its geometry.
 *
 * Compositing only. A part's `rot`/`tx`/`ty`/`scale` are not here because they
 * are already in the vertices the kernel handed over.
 */
export interface PartDrawState {
  opacity: number;
  /** Effective draw order for this frame, after any PartPose.zIndex step. */
  zIndex: number;
  /** Sheet-normalized [scaleX, scaleY, offsetX, offsetY] texture remap. */
  uvRemap: readonly [number, number, number, number];
  tint: readonly [number, number, number, number];
}

export interface DrawOptions {
  transform: ViewportTransform;
  /**
   * Draw state by part id. A part with no entry is skipped.
   *
   * There is no `visible` flag and no opacity cut to apply: a part that
   * resolves hidden or fully transparent has no entry here at all, because
   * `PartTrack.compositeOrder` already dropped it. Carrying "here is a layer,
   * do not draw it" would be a second place the cut could be applied
   * differently from the server's.
   */
  states: ReadonlyMap<string, PartDrawState>;
  /** Part ids back to front, from `PartTrack.compositeOrder`. */
  order: readonly string[];
  /** Draw the triangulation over the artwork. */
  wireframe: boolean;
}

interface PartBuffers {
  posed: WebGLBuffer;
  rest: WebGLBuffer;
  indices: WebGLBuffer;
  lines: WebGLBuffer;
  posedBytes: number;
  restBytes: number;
  indexBytes: number;
  lineBytes: number;
  lineCount: number;
}

export interface CutoutRendererHandle {
  /**
   * Upload the source sheet. Every part samples this one texture; `Part.rect`
   * crops it through texture coordinates rather than through 64 sub-images.
   *
   * `width`/`height` are passed explicitly rather than read off the source. An
   * HTMLImageElement's `width` is its rendered width, which is not its pixel
   * width for an element that was never laid out, and the texcoord divisor has to
   * be the pixel width or every part samples the wrong region.
   */
  setSheet(source: TexImageSource, width: number, height: number): void;
  /** True once a sheet has been uploaded. */
  hasSheet(): boolean;
  /** Size the backing store. `dpr` is clamped by the caller's policy. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  draw(frame: KernelFrame, options: DrawOptions): void;
  clear(): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("The GPU refused to allocate a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown error";
    gl.deleteShader(shader);
    throw new Error(`AniBuddy preview shader failed to compile: ${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("The GPU refused to allocate a program.");
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown error";
    gl.deleteProgram(program);
    throw new Error(`AniBuddy preview program failed to link: ${log}`);
  }
  return program;
}

/**
 * Source pixels to clip space, column-major.
 *
 * The sheet is letterboxed into the canvas by the caller's ViewportTransform, so
 * this is a uniform scale plus a translate, with y flipped because source pixels
 * grow downward and clip space grows upward.
 */
function projectionOf(transform: ViewportTransform): Float32Array {
  const scaleX = (2 * transform.scale) / transform.width;
  const scaleY = (-2 * transform.scale) / transform.height;
  const offsetX = (2 * transform.offsetX) / transform.width - 1;
  const offsetY = 1 - (2 * transform.offsetY) / transform.height;
  return Float32Array.from([scaleX, 0, 0, 0, scaleY, 0, offsetX, offsetY, 1]);
}

/**
 * Widen a kernel array to what the WebGL bindings accept.
 *
 * lib.dom types `BufferSource` as `ArrayBufferView<ArrayBuffer>`, while a typed
 * array that was never explicitly parameterized -- which is what the kernel
 * returns -- is `ArrayBufferView<ArrayBufferLike>`, and `ArrayBufferLike` admits
 * `SharedArrayBuffer`. The kernel has no worker or SAB path of any kind, so the two
 * describe the same values here. This is the one place that gap is bridged, rather
 * than a cast at each of the four upload sites.
 */
function bufferView(data: Float32Array | Uint32Array): BufferSource {
  return data as unknown as BufferSource;
}

/** Triangle indices to line indices, three edges per triangle. */
function lineIndicesOf(tris: Uint32Array): Uint32Array {
  const out = new Uint32Array(tris.length * 2);
  for (let triangle = 0; triangle < tris.length; triangle += 3) {
    const a = tris[triangle];
    const b = tris[triangle + 1];
    const c = tris[triangle + 2];
    const base = triangle * 2;
    out[base] = a;
    out[base + 1] = b;
    out[base + 2] = b;
    out[base + 3] = c;
    out[base + 4] = c;
    out[base + 5] = a;
  }
  return out;
}

export const CutoutRenderer = {
  /**
   * Attach a renderer to a canvas, or return null when WebGL2 is unavailable.
   *
   * Returning null rather than throwing lets the viewport fall back to a message
   * the user can act on. A thrown error inside a React effect on a machine with a
   * blocked GPU is a blank panel and a console trace.
   */
  create(canvas: HTMLCanvasElement): CutoutRendererHandle | null {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    let program: WebGLProgram;
    try {
      program = link(gl);
    } catch {
      return null;
    }

    const uniforms = {
      projection: gl.getUniformLocation(program, "uProjection"),
      sheetSize: gl.getUniformLocation(program, "uSheetSize"),
      uvRemap: gl.getUniformLocation(program, "uUvRemap"),
      sheet: gl.getUniformLocation(program, "uSheet"),
      opacity: gl.getUniformLocation(program, "uOpacity"),
      tint: gl.getUniformLocation(program, "uTint"),
      flat: gl.getUniformLocation(program, "uFlat"),
    };

    const vao = gl.createVertexArray();
    const texture = gl.createTexture();
    const buffers = new Map<string, PartBuffers>();
    let sheetWidth = 1;
    let sheetHeight = 1;
    let sheetReady = false;
    let disposed = false;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    // CLAMP_TO_EDGE, not REPEAT: a texcoord that lands a hair outside the sheet
    // on a part at the rim must sample the rim, not wrap to the far side.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Internal method — grow-only buffer allocation. Vertices change every frame
    // but their COUNT only changes when the rig does, so a resize is rare and a
    // re-upload is not.
    const upload = (
      target: number,
      buffer: WebGLBuffer,
      data: Float32Array | Uint32Array,
      capacity: number,
    ): number => {
      gl.bindBuffer(target, buffer);
      if (data.byteLength > capacity) {
        gl.bufferData(target, bufferView(data), gl.DYNAMIC_DRAW);
        return data.byteLength;
      }
      gl.bufferSubData(target, 0, bufferView(data));
      return capacity;
    };

    // Internal method
    const buffersFor = (partId: string): PartBuffers | null => {
      const existing = buffers.get(partId);
      if (existing) return existing;
      const posed = gl.createBuffer();
      const rest = gl.createBuffer();
      const indices = gl.createBuffer();
      const lines = gl.createBuffer();
      if (!posed || !rest || !indices || !lines) return null;
      const record: PartBuffers = {
        posed,
        rest,
        indices,
        lines,
        posedBytes: 0,
        restBytes: 0,
        indexBytes: 0,
        lineBytes: 0,
        lineCount: 0,
      };
      buffers.set(partId, record);
      return record;
    };

    // Internal method
    const drawPart = (part: PartGeometry, state: PartDrawState, wireframe: boolean): void => {
      const record = buffersFor(part.partId);
      if (!record) return;

      record.posedBytes = upload(gl.ARRAY_BUFFER, record.posed, part.dstVerts, record.posedBytes);
      gl.vertexAttribPointer(POSITION_LOCATION, 2, gl.FLOAT, false, 0, 0);
      record.restBytes = upload(gl.ARRAY_BUFFER, record.rest, part.srcVerts, record.restBytes);
      gl.vertexAttribPointer(UV_LOCATION, 2, gl.FLOAT, false, 0, 0);
      record.indexBytes = upload(
        gl.ELEMENT_ARRAY_BUFFER,
        record.indices,
        part.tris,
        record.indexBytes,
      );

      gl.uniform4f(
        uniforms.uvRemap,
        state.uvRemap[0],
        state.uvRemap[1],
        state.uvRemap[2],
        state.uvRemap[3],
      );
      gl.uniform1f(uniforms.opacity, state.opacity);
      gl.uniform4f(uniforms.tint, state.tint[0], state.tint[1], state.tint[2], state.tint[3]);
      gl.uniform1f(uniforms.flat, 0);
      gl.drawElements(gl.TRIANGLES, part.tris.length, gl.UNSIGNED_INT, 0);

      if (!wireframe) return;
      const lines = lineIndicesOf(part.tris);
      record.lineBytes = upload(gl.ELEMENT_ARRAY_BUFFER, record.lines, lines, record.lineBytes);
      record.lineCount = lines.length;
      const stroke = EditorConstants.WIREFRAME_COLOR;
      gl.uniform4f(uniforms.tint, stroke[0], stroke[1], stroke[2], stroke[3]);
      gl.uniform1f(uniforms.flat, 1);
      gl.drawElements(gl.LINES, record.lineCount, gl.UNSIGNED_INT, 0);
    };

    return {
      setSheet(source: TexImageSource, width: number, height: number): void {
        if (disposed) return;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        // v = 0 must be the sheet's TOP row: srcVerts are source pixels with y
        // growing downward, so the shader's uv.y = 0 is the top of the artwork.
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        sheetWidth = width > 0 ? width : 1;
        sheetHeight = height > 0 ? height : 1;
        sheetReady = true;
      },

      hasSheet(): boolean {
        return sheetReady;
      },

      resize(cssWidth: number, cssHeight: number, dpr: number): void {
        if (disposed) return;
        const width = Math.max(1, Math.round(cssWidth * dpr));
        const height = Math.max(1, Math.round(cssHeight * dpr));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, width, height);
      },

      draw(frame: KernelFrame, options: DrawOptions): void {
        if (disposed) return;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!sheetReady) return;

        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.enableVertexAttribArray(POSITION_LOCATION);
        gl.enableVertexAttribArray(UV_LOCATION);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uniforms.sheet, 0);
        gl.uniform2f(uniforms.sheetSize, sheetWidth, sheetHeight);
        gl.uniformMatrix3fv(uniforms.projection, false, projectionOf(options.transform));

        // Draw order is OBEYED here, never decided here. The kernel evaluates
        // parts in rig order on purpose -- reshuffling its output arrays would
        // break every golden fixture for no gain -- and `PartTrack.compositeOrder`
        // is what turns that into a per-frame z-order, the same function the
        // server's rasterizer consumes the output of. This loop sorting for
        // itself would be a second answer to a question that already has one.
        const geometryById = new Map(frame.parts.map((part) => [part.partId, part]));
        for (const partId of options.order) {
          const geometry = geometryById.get(partId);
          const state = options.states.get(partId);
          if (!geometry || !state) continue;
          drawPart(geometry, state, options.wireframe);
        }

        gl.bindVertexArray(null);
      },

      clear(): void {
        if (disposed) return;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      },

      dispose(): void {
        if (disposed) return;
        disposed = true;
        for (const record of buffers.values()) {
          gl.deleteBuffer(record.posed);
          gl.deleteBuffer(record.rest);
          gl.deleteBuffer(record.indices);
          gl.deleteBuffer(record.lines);
        }
        buffers.clear();
        gl.deleteTexture(texture);
        gl.deleteVertexArray(vao);
        gl.deleteProgram(program);
      },
    };
  },
} as const;
