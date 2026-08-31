// Contract tests for the three gateway gaps: sheet upload validation, clip
// validation against the current document, and the stage routing table.
//
// Nothing here imports `anibuddy.service.ts` or `bullmq.ts` — constructing a
// Queue attaches an open Redis handle that keeps the node:test process alive.
// That constraint is why the clip rules live in their own module.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AniBuddyConstants,
  ANIBUDDY_CRITIQUE_ERROR_CODES,
  ANIBUDDY_QUEUED_STAGES,
  ANIBUDDY_SHEET_POLICIES,
  ANIBUDDY_STAGE_TRANSPORTS,
  ANIBUDDY_TRANSPORT_MODEL_KINDS,
  ANIBUDDY_TRANSPORT_SERVICES,
  ANIBUDDY_ANNOTATE_BODY_LIMIT,
  ANIBUDDY_ANNOTATE_BODY_MOUNT,
  ANIBUDDY_CLIP_BODY_MOUNT,
} from '../modules/anibuddy/anibuddy.constants';
import { AniBuddyAnimateService } from '../modules/anibuddy/anibuddy.animate.service';
import { AniBuddyBufferSidecar } from '../modules/anibuddy/anibuddy.buffer.sidecar';
import { AniBuddyClipValidator } from '../modules/anibuddy/anibuddy.clip.validator';
import { AniBuddyPyClient } from '../modules/anibuddy/anibuddy.py.client';
import { AniBuddySheetProbe } from '../modules/anibuddy/anibuddy.sheet.probe';
import { UsageConstants } from '../modules/usage/usage.constants';
import { writeAniBuddyClipSchema } from '../modules/anibuddy/dto/clip.schema';
import {
  enqueueAniBuddyCritiqueSchema,
  enqueueAniBuddyStageSchema,
} from '../modules/anibuddy/dto/project.schema';
import {
  ANIBUDDY_LIMITS,
  AniBuddyRigDocumentDto,
} from '../modules/anibuddy/dto/rig-document.generated';
import type { NumericBuffer, RigDocument } from '../modules/anibuddy/dto/rig-document.generated';
import type { WriteAniBuddyClipInput } from '../modules/anibuddy/dto/clip.schema';

// ───────────────────────────── fixtures ─────────────────────────────

function pngOf(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** SOI, an APP0 segment to be stepped over, then the SOF0 frame header. */
function jpegOf(width: number, height: number): Buffer {
  const app0 = Buffer.alloc(20);
  app0.writeUInt16BE(0xffd8, 0);
  app0.writeUInt16BE(0xffe0, 2);
  app0.writeUInt16BE(16, 4);
  app0.write('JFIF\0', 6, 'ascii');

  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(11, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([app0, sof]);
}

/** Lossless WebP: width-1 and height-1 packed 14 bits each. */
function webpLosslessOf(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(25);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8L', 12, 'ascii');
  buffer.writeUInt32LE(5, 16);
  buffer.writeUInt8(0x2f, 20);
  buffer.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  return buffer;
}

function documentWith(partIds: readonly string[], jointIds: readonly string[]): RigDocument {
  const now = '2026-08-14T00:00:00.000Z';
  return {
    schemaVersion: 5,
    id: 'rev_test_1',
    projectId: 'proj_test',
    createdAt: now,
    updatedAt: now,
    revision: { index: 1, parentRevisionId: null, reason: 'decompose', accepted: false },
    archetype: 'humanoid',
    asset: {
      id: 'asset_test',
      name: 'hero.png',
      storageKey: 'sheets/aaa',
      contentHash: 'a'.repeat(64),
      width: 512,
      height: 512,
      figureHeight: null,
      mimeType: 'image/png',
      rightsConfirmed: true,
      remoteVisionConsented: false,
    },
    parts: partIds.map((id, index) => ({
      id,
      name: id,
      role: 'torso' as const,
      mask: { kind: 'rect' as const },
      rect: { x: 0, y: 0, width: 1, height: 1 },
      pivot: { x: 0.5, y: 0.5 },
      zIndex: index,
      parentPartId: null,
      attachSlot: null,
      slots: [],
      deformer: { kind: 'rigid' as const },
      boundJointId: null,
      visible: true,
      opacity: 1,
      confidence: 0.9,
      provenance: 'alpha-component' as const,
    })),
    skeleton: {
      joints: jointIds.map((id, index) => ({
        id,
        name: id,
        role: index === 0 ? ('root' as const) : ('spine' as const),
        x: 0.5,
        y: 0.5,
        parent: index === 0 ? null : (jointIds[0] ?? null),
        partId: null,
        ikChainLength: null,
        confidence: 0.9,
      })),
    },
    clips: [],
    generation: { mode: 'external-prompt-only', prompt: null, transcript: [], producedBy: null },
    provenance: { pipelineVersion: '5.0.0-test', kernelVersion: '0.1.0-test', stages: [] },
    diagnostics: {
      foregroundPixels: 10,
      coveredForegroundPixels: 10,
      overlappingPartPairs: [],
      maxStretch: 1,
      flippedTriangles: 0,
      isolatedVertices: 0,
      warnings: [],
      blockingReason: 'Not rigged yet.',
    },
  };
}

function externalBuffer(sha256: string, dtype: 'f32' | 'u32', length: number): NumericBuffer {
  return {
    dtype,
    storage: 'external',
    length,
    sha256,
    values: null,
    // The key py_backend suggests, content-addressed on the hash itself.
    storageKey: `anibuddy/proj_test/buffers/${sha256}.bin`,
  };
}

/**
 * A rigged document whose geometry lives out of band, at three nesting depths.
 *
 * The sidecar walks for the *shape* of an external buffer rather than for named
 * paths, and this is the fixture that says why: `verts` sits on the deformer,
 * `points` sits on a cut line inside it, and `counts` sits on a different part's
 * mask. A path-listing implementation passes for the first and silently skips the
 * other two.
 */
function documentWithExternalBuffers(): RigDocument {
  const document = documentWith(['torso', 'cape'], ['root', 'spine']);
  const [torso, cape] = document.parts;
  if (!torso || !cape) throw new Error('fixture must have two parts');

  torso.deformer = {
    kind: 'mesh',
    verts: externalBuffer('1'.repeat(64), 'f32', 8192),
    tris: { dtype: 'u32', storage: 'inline', length: 3, sha256: 'a'.repeat(64), values: [0, 1, 2], storageKey: null },
    boneIds: ['root->spine'],
    weights: externalBuffer('2'.repeat(64), 'f32', 8192),
    cuts: [{ id: 'cut1', points: externalBuffer('3'.repeat(64), 'f32', 8192) }],
  };
  cape.mask = {
    kind: 'rle',
    origin: { x: 0, y: 0 },
    width: 64,
    height: 64,
    counts: externalBuffer('4'.repeat(64), 'u32', 8192),
  };

  // Parsed rather than asserted by eye: a fixture that is not a valid document
  // proves nothing about a walk over real ones.
  return AniBuddyRigDocumentDto.rigDocument.parse(document);
}

function clipWith(keyframes: WriteAniBuddyClipInput['keyframes']): WriteAniBuddyClipInput {
  return {
    id: 'walk',
    name: 'Walk',
    request: '',
    loop: true,
    fps: 24,
    frameCount: 24,
    keyframes,
  };
}

// ─────────────────────────── upload validation ───────────────────────────

test('anibuddy upload: a well-formed sheet of each accepted format is measured from its bytes', () => {
  for (const [label, buffer, mime] of [
    ['png', pngOf(512, 256), 'image/png'],
    ['jpeg', jpegOf(512, 256), 'image/jpeg'],
    ['webp', webpLosslessOf(512, 256), 'image/webp'],
  ] as const) {
    const probe = AniBuddySheetProbe.inspect(buffer);
    assert.equal(probe.ok, true, `${label} should be accepted`);
    if (!probe.ok) return;
    assert.equal(probe.mimeType, mime);
    assert.equal(probe.width, 512);
    assert.equal(probe.height, 256);
    assert.equal(probe.byteLength, buffer.length);
  }
});

test('anibuddy upload: the bytes decide the format, not the declared Content-Type', () => {
  // A PDF announced as image/png walks past multer's fileFilter, which only ever
  // saw the client's claim. This is the check that stops it.
  const probe = AniBuddySheetProbe.inspect(Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1'));
  assert.equal(probe.ok, false);
  if (probe.ok) return;
  assert.match(probe.reason, /not a PNG, WebP or JPEG/);
});

test('anibuddy upload: sheets outside the edge bounds are refused with the measured size', () => {
  const tooSmall = AniBuddySheetProbe.inspect(pngOf(32, 512));
  assert.equal(tooSmall.ok, false);
  if (!tooSmall.ok) {
    assert.match(tooSmall.reason, /32×512px/);
    assert.match(tooSmall.reason, new RegExp(`${AniBuddyConstants.asset.minEdge}px`));
  }

  const tooLarge = AniBuddySheetProbe.inspect(pngOf(AniBuddyConstants.asset.maxEdge + 1, 512));
  assert.equal(tooLarge.ok, false);
  if (!tooLarge.ok) assert.match(tooLarge.reason, new RegExp(`${AniBuddyConstants.asset.maxEdge}px`));

  // The edge ceiling is the schema's, never a second copy of it (R10).
  assert.equal(AniBuddyConstants.asset.maxEdge, ANIBUDDY_LIMITS.MAX_SOURCE_EDGE);
});

test('anibuddy upload: empty, truncated and zero-dimension inputs are refused by name', () => {
  const empty = AniBuddySheetProbe.inspect(Buffer.alloc(0));
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.reason, /empty/);

  const truncatedPng = AniBuddySheetProbe.inspect(pngOf(512, 512).subarray(0, 18));
  assert.equal(truncatedPng.ok, false);
  if (!truncatedPng.ok) assert.match(truncatedPng.reason, /truncated/);

  // A JPEG whose segment chain never reaches a frame header: an APP0 alone.
  const headerless = jpegOf(512, 512).subarray(0, 20);
  const noFrame = AniBuddySheetProbe.inspect(headerless);
  assert.equal(noFrame.ok, false);
  if (!noFrame.ok) assert.match(noFrame.reason, /no frame header/);

  const zeroSized = AniBuddySheetProbe.inspect(pngOf(0, 0));
  assert.equal(zeroSized.ok, false);
});

test('anibuddy upload: limits and storage layout come from one frozen table', () => {
  assert.equal(AniBuddyConstants.asset.formField, 'sheet');
  assert.equal(AniBuddyConstants.asset.maxBytes, 20 * 1024 * 1024);
  assert.deepEqual([...AniBuddyConstants.asset.mimeTypes], [
    'image/png',
    'image/webp',
    'image/jpeg',
  ]);
  assert.equal(Object.isFrozen(AniBuddyConstants.asset), true);
  assert.equal(AniBuddyConstants.routes.assets, '/anibuddy/assets');
});

// ──────────────────────────── clip validation ────────────────────────────

test('anibuddy clip: a clip naming only real ids is writable', () => {
  const document = documentWith(['torso', 'armL'], ['root', 'spine']);
  const clip = clipWith([
    { t: 0, ease: 'ease', joints: { spine: { rot: 5 } }, parts: { torso: { tx: 0.1 } } },
    { t: 1, ease: 'linear', joints: { spine: { rot: -5 } }, parts: { armL: { swapTo: 'torso' } } },
  ]);
  assert.deepEqual(AniBuddyClipValidator.unresolvedIds(document, clip), []);
  assert.doesNotThrow(() => AniBuddyClipValidator.assertWritable(document, clip));
});

test('anibuddy clip: unknown joint, part and swapTo ids are all rejected', () => {
  const document = documentWith(['torso'], ['root']);
  const stale = clipWith([
    {
      t: 0,
      ease: 'ease',
      joints: { ghostJoint: { rot: 10 } },
      parts: { ghostPart: { tx: 0.2 }, torso: { swapTo: 'ghostSwap' } },
    },
  ]);

  const unresolved = AniBuddyClipValidator.unresolvedIds(document, stale);
  assert.deepEqual(unresolved.sort(), ['joint:ghostJoint', 'part:ghostPart', 'part:ghostSwap']);

  assert.throws(
    () => AniBuddyClipValidator.assertWritable(document, stale),
    (error: unknown) => {
      assert.equal((error as { statusCode: number }).statusCode, 400);
      assert.match((error as Error).message, /joint:ghostJoint/);
      assert.match((error as Error).message, /part:ghostSwap/);
      return true;
    },
  );
});

test('anibuddy clip: keyframes must be strictly increasing in t', () => {
  const document = documentWith(['torso'], ['root']);
  const duplicated = clipWith([
    { t: 0.5, ease: 'ease', joints: {}, parts: {} },
    { t: 0.5, ease: 'ease', joints: {}, parts: {} },
  ]);
  assert.throws(() => AniBuddyClipValidator.assertKeyframeOrder(duplicated), /strictly increasing/);

  const reversed = clipWith([
    { t: 0.6, ease: 'ease', joints: {}, parts: {} },
    { t: 0.2, ease: 'ease', joints: {}, parts: {} },
  ]);
  assert.throws(() => AniBuddyClipValidator.assertKeyframeOrder(reversed), /strictly increasing/);

  // A hand-authored clip may legitimately start after t=0; only a MotionProposal
  // is held to "first key at t=0" (F9 §8.4).
  const lateStart = clipWith([
    { t: 0.25, ease: 'hold', joints: {}, parts: {} },
    { t: 0.75, ease: 'linear', joints: {}, parts: {} },
  ]);
  assert.doesNotThrow(() => AniBuddyClipValidator.assertKeyframeOrder(lateStart));
});

test('anibuddy clip: the server stamps provenance and the client cannot send it', () => {
  const stamped = AniBuddyClipValidator.stamp(clipWith([]));
  assert.equal(stamped.source, 'edited');
  assert.equal(AniBuddyConstants.clip.source, 'edited');

  // `source` is not merely optional on the request: sending it is an error, so a
  // client cannot claim a clip was authored by the model or by a critique pass.
  assert.throws(() =>
    writeAniBuddyClipSchema.parse({ ...clipWith([]), source: 'model' }),
  );
});

test('anibuddy clip: the write DTO enforces the schema bounds it inherits', () => {
  const base = clipWith([]);
  assert.doesNotThrow(() => writeAniBuddyClipSchema.parse(base));

  // fps and frameCount bounds, and the keyframe cap, come from the generated
  // schema rather than from this route.
  assert.throws(() => writeAniBuddyClipSchema.parse({ ...base, fps: 0 }));
  assert.throws(() => writeAniBuddyClipSchema.parse({ ...base, fps: ANIBUDDY_LIMITS.MAX_FPS + 1 }));
  assert.throws(() => writeAniBuddyClipSchema.parse({ ...base, frameCount: 1 }));
  assert.throws(() =>
    writeAniBuddyClipSchema.parse({ ...base, frameCount: ANIBUDDY_LIMITS.MAX_FRAMES + 1 }),
  );
  assert.throws(() =>
    writeAniBuddyClipSchema.parse({
      ...base,
      keyframes: Array.from({ length: ANIBUDDY_LIMITS.MAX_KEYFRAMES + 1 }, (_, index) => ({
        t: index / (ANIBUDDY_LIMITS.MAX_KEYFRAMES + 1),
        ease: 'ease',
        joints: {},
        parts: {},
      })),
    }),
  );

  // No field on this request reaches diagnostics, geometry or provenance — the
  // strict object is what enforces R5 and §7.8 structurally.
  for (const smuggled of ['diagnostics', 'parts', 'skeleton', 'provenance', 'asset']) {
    const result = writeAniBuddyClipSchema.safeParse({ ...base, [smuggled]: {} });
    assert.equal(result.success, false, `a clip write must not accept '${smuggled}'`);
  }

  assert.equal(AniBuddyConstants.clip.maxClips, ANIBUDDY_LIMITS.MAX_CLIPS);
  assert.equal(AniBuddyConstants.clip.maxKeyframes, ANIBUDDY_LIMITS.MAX_KEYFRAMES);
});

test('anibuddy clip: the revision ceiling is derived from the schema, not typed out', () => {
  assert.equal(AniBuddyClipValidator.maxRevisionIndex, 4096);
});

test('anibuddy clip: the wide body parser is mounted on the clip path only', () => {
  assert.equal(ANIBUDDY_CLIP_BODY_MOUNT, `/api${AniBuddyConstants.routes.clips}`);
  assert.equal(AniBuddyConstants.routes.clip, `${AniBuddyConstants.routes.clips}/:clipId`);
});

// ───────────────────────── stage routing table ─────────────────────────

test('anibuddy routing: every queued stage has one transport, one path and one service', () => {
  for (const stage of ANIBUDDY_QUEUED_STAGES) {
    const transport = AniBuddyConstants.transportByStage[stage];
    assert.ok(
      (ANIBUDDY_STAGE_TRANSPORTS as readonly string[]).includes(transport),
      `${stage} is routed to an undeclared transport '${transport}'`,
    );
    assert.equal(typeof AniBuddyConstants.pathByTransport[transport], 'string');
    assert.ok(
      (ANIBUDDY_TRANSPORT_SERVICES as readonly string[]).includes(
        AniBuddyConstants.serviceByTransport[transport],
      ),
      `${transport} declares an undeclared service`,
    );
    assert.ok(
      (ANIBUDDY_SHEET_POLICIES as readonly string[]).includes(
        AniBuddyConstants.sheetPolicyByTransport[transport],
      ),
      `${transport} declares an undeclared sheet policy`,
    );
    assert.ok(
      (ANIBUDDY_TRANSPORT_MODEL_KINDS as readonly string[]).includes(
        AniBuddyConstants.modelKindByTransport[transport],
      ),
      `${transport} declares an undeclared model kind`,
    );
  }
});

test('anibuddy routing: decompose, rig and render all run against real endpoints', () => {
  assert.equal(AniBuddyConstants.transportByStage.decompose, 'decompose-multipart');
  assert.equal(AniBuddyConstants.transportByStage.rig, 'rig-multipart');
  assert.equal(AniBuddyConstants.transportByStage.render, 'render-multipart');
  assert.equal(AniBuddyConstants.pathByTransport['decompose-multipart'], '/anibuddy/decompose');
  assert.equal(AniBuddyConstants.pathByTransport['rig-multipart'], '/anibuddy/rig');
  assert.equal(AniBuddyConstants.pathByTransport['render-multipart'], '/anibuddy/render');
  for (const transport of [
    'decompose-multipart',
    'rig-multipart',
    'render-multipart',
  ] as const) {
    assert.equal(AniBuddyConstants.serviceByTransport[transport], 'py-backend');
  }
});

test('anibuddy routing: animate is a vision transport, not a py_backend path', () => {
  // The stage's work is a MODEL call over the rig's real ids plus a sentence of user
  // intent (F9 §8.4). No pixel is resampled and no deformer is rebuilt, so there is
  // nothing for py_backend to do — routing it there would mean an endpoint whose only
  // job is to forward a request it cannot answer, and py_backend must not grow a
  // second copy of the provider chain to answer it with.
  assert.equal(AniBuddyConstants.transportByStage.animate, 'motion-vision');
  assert.equal(AniBuddyConstants.serviceByTransport['motion-vision'], 'next-vision');
  assert.equal(
    AniBuddyConstants.pathByTransport['motion-vision'],
    AniBuddyConstants.nextVisionPaths.motion,
  );
  // No stage rides the stub any more, and the stub's templated path stays so a stage
  // can be routed back to it while an endpoint is reworked.
  assert.equal(
    (Object.values(AniBuddyConstants.transportByStage) as readonly string[]).includes('stub'),
    false,
    'no stage should still be on the JSON stub',
  );
  assert.equal(
    AniBuddyConstants.pathByTransport.stub.replace(':stage', 'animate'),
    '/anibuddy/stages/animate',
  );
});

test('anibuddy routing: only a vision transport records a model id worth reconciling', () => {
  // R13: the event names what actually ran. Three transports run NumPy and OpenCV
  // geometry and one runs nothing, so borrowing a model id for any of them would
  // attribute local arithmetic to a provider that was never called.
  assert.equal(AniBuddyConstants.modelKindByTransport['motion-vision'], 'vision');
  assert.equal(AniBuddyConstants.modelKindByTransport['decompose-multipart'], 'local-geometry');
  assert.equal(AniBuddyConstants.modelKindByTransport['rig-multipart'], 'local-geometry');
  assert.equal(AniBuddyConstants.modelKindByTransport['render-multipart'], 'local-geometry');
  assert.equal(AniBuddyConstants.modelKindByTransport.stub, 'stub');
  assert.equal(Object.isFrozen(AniBuddyConstants.modelKindByTransport), true);
  assert.equal(Object.isFrozen(AniBuddyConstants.serviceByTransport), true);
});

test('anibuddy routing: animate bills under its own registered op', () => {
  assert.equal(AniBuddyConstants.usageOpByStage.animate, 'anibuddy-animate');
  // The most expensive op in the table, because it is the most expensive call: the
  // rate has to track work (F9 §13), and it must avoid the image rates 1/4/10 so the
  // R2 invariant test can still detect an AniBuddy op leaking into the image branch.
  assert.equal(UsageConstants.opCreditRates['anibuddy-animate'], 6);
  assert.equal(
    (UsageConstants.registeredOps as readonly string[]).includes('anibuddy-animate'),
    true,
  );
});

test('anibuddy animate: an enqueue with nothing to animate is refused before it costs', () => {
  // `anibuddy-animate` is 6 credits per clip. An enqueue with no motion described can
  // only ever end in a refund, so it fails at the DTO rather than in the worker.
  assert.throws(() => enqueueAniBuddyStageSchema.parse({ stage: 'animate' }));
  assert.doesNotThrow(() =>
    enqueueAniBuddyStageSchema.parse({
      stage: 'animate',
      animate: { request: 'a slow idle breathing loop', clipId: 'idle' },
    }),
  );

  // The request is bounded and a blank one is not a request.
  assert.throws(() =>
    enqueueAniBuddyStageSchema.parse({ stage: 'animate', animate: { request: '   ' } }),
  );
  assert.throws(() =>
    enqueueAniBuddyStageSchema.parse({
      stage: 'animate',
      animate: {
        request: 'x'.repeat(AniBuddyConstants.animate.maxRequestLength + 1),
      },
    }),
  );

  // There is no field here through which a keyframe could arrive: a client that wants
  // to author one uses the clip routes, which stamp `edited` rather than `model`.
  for (const smuggled of ['keyframes', 'fps', 'frameCount', 'document']) {
    assert.equal(
      enqueueAniBuddyStageSchema.safeParse({
        stage: 'animate',
        animate: { request: 'walk', [smuggled]: {} },
      }).success,
      false,
      `an animate enqueue must not accept '${smuggled}'`,
    );
  }
});

test('anibuddy animate: a proposal becomes a clip the server stamped', () => {
  const proposal = {
    name: 'Slow Idle Breathing',
    loop: true,
    fps: 12,
    frameCount: 24,
    keyframes: [
      { t: 0, ease: 'ease' as const, joints: { spine: { rot: 2 } }, parts: {} },
      { t: 1, ease: 'ease' as const, joints: { spine: { rot: -2 } }, parts: {} },
    ],
    warnings: [],
  };

  const clip = AniBuddyAnimateService._toClip(proposal, {
    request: 'a slow idle breathing loop',
  });
  // `model`, not `edited`: these keyframes came from a model, and `source` names work
  // that really happened rather than something a caller may claim.
  assert.equal(clip.source, 'model');
  assert.equal(clip.source, AniBuddyConstants.animate.clipSource);
  assert.equal(clip.request, 'a slow idle breathing loop');
  // No channel is reinterpreted on the way across: MotionProposal and Clip share the
  // generated Keyframe type, so the conversion carries them rather than mapping them.
  assert.deepEqual(clip.keyframes, proposal.keyframes);
  assert.equal(AniBuddyRigDocumentDto.clip.safeParse(clip).success, true);
});

test('anibuddy animate: the clip id is slugified to the schema pattern or falls back', () => {
  const base = { loop: true, fps: 12, frameCount: 24, keyframes: [], warnings: [] };

  // The user's id wins: they are naming a clip they intend to re-render.
  assert.equal(
    AniBuddyAnimateService._clipId({ request: 'x', clipId: 'idle' }, { ...base, name: 'Whatever' }),
    'idle',
  );
  // Otherwise the proposal names itself, slugified to `^[A-Za-z0-9_-]{1,32}$`.
  assert.equal(
    AniBuddyAnimateService._clipId(null, { ...base, name: 'Slow Idle — Breathing!' }),
    'slow-idle-breathing',
  );
  // A name with nothing usable in it would otherwise produce an empty id, which is a
  // schema failure at the very end of a paid vision call.
  const fallback = AniBuddyAnimateService._clipId(null, { ...base, name: '???' });
  assert.equal(fallback, AniBuddyConstants.animate.defaultClipId);
  assert.match(fallback, /^[A-Za-z0-9_-]{1,32}$/);
  // And a very long name is truncated rather than refused.
  assert.match(
    AniBuddyAnimateService._clipId(null, { ...base, name: 'a very long motion name '.repeat(8) }),
    /^[A-Za-z0-9_-]{1,32}$/,
  );
});

test('anibuddy routing: the sheet is fetched only where the stage can use it', () => {
  // Render resamples the user's own pixels every frame, so it cannot run without
  // them. Rig is conditional: only an `alpha-threshold` mask is resolved against
  // the sheet, so a re-rig of a corrected decomposition sends no image at all.
  assert.equal(AniBuddyConstants.sheetPolicyByTransport['render-multipart'], 'required');
  assert.equal(AniBuddyConstants.sheetPolicyByTransport['decompose-multipart'], 'required');
  assert.equal(AniBuddyConstants.sheetPolicyByTransport['rig-multipart'], 'alpha-masks-only');
  assert.equal(AniBuddyConstants.sheetPolicyByTransport.stub, 'none');
  // The motion call reasons about the artwork it is animating, so it needs the sheet
  // too — as a data URL, because an `image_url` part is the only shape a model can be
  // shown an image in, and only this gateway can turn a storage key into bytes.
  assert.equal(AniBuddyConstants.sheetPolicyByTransport['motion-vision'], 'required');

  // The conditional policy's whole content is this one mask kind, and it has to be
  // a kind the schema actually declares.
  assert.equal(AniBuddyConstants.maskKindNeedingSheet, 'alpha-threshold');
  assert.equal(
    AniBuddyRigDocumentDto.maskAlphaThreshold.shape.kind.value,
    AniBuddyConstants.maskKindNeedingSheet,
  );
});

test('anibuddy routing: no stage is routed to a transport the gateway cannot drive', () => {
  const implemented = AniBuddyConstants.implementedTransports as readonly string[];
  for (const stage of ANIBUDDY_QUEUED_STAGES) {
    assert.ok(
      implemented.includes(AniBuddyConstants.transportByStage[stage]),
      `${stage} is routed to an unimplemented transport — flipping the table needs its handler too`,
    );
  }
  // Every declared transport now has a handler, so the table is both a complete
  // map of the Python surface and a complete list of what this gateway drives.
  assert.deepEqual([...implemented].sort(), [...ANIBUDDY_STAGE_TRANSPORTS].sort());
});

test('anibuddy routing: the routing tables are frozen', () => {
  assert.equal(Object.isFrozen(AniBuddyConstants.transportByStage), true);
  assert.equal(Object.isFrozen(AniBuddyConstants.pathByTransport), true);
  assert.equal(Object.isFrozen(AniBuddyConstants.sheetPolicyByTransport), true);
  assert.equal(Object.isFrozen(AniBuddyConstants.routes), true);
  assert.equal(Object.isFrozen(AniBuddyConstants.render), true);
});

// ───────────────────────── critique loop enqueue ─────────────────────────

test('anibuddy critique: the enqueue takes no units, because the loop bills per pass', () => {
  // The one structural difference from a stage enqueue. The loop charges a render and
  // a vision call per pass and refunds by failure class, so a pre-authorization here
  // would be a charge for passes the ceiling or the budget may never let start — and
  // it would then have to be reconciled against whatever the loop really spent.
  assert.equal(enqueueAniBuddyCritiqueSchema.safeParse({ units: 3 }).success, false);
  assert.equal(enqueueAniBuddyCritiqueSchema.safeParse({ stage: 'critique' }).success, false);

  // An empty body is the normal case: review the document's first clip from pass 1.
  assert.doesNotThrow(() => enqueueAniBuddyCritiqueSchema.parse({}));
  // Explicit null is "the rig at rest", which is a legitimate thing to critique — a
  // bad pivot is visible in one still.
  assert.equal(enqueueAniBuddyCritiqueSchema.parse({ clipId: null }).clipId, null);
});

test('anibuddy critique: a resumed loop cannot claim a spend or a pass outside the caps', () => {
  assert.doesNotThrow(() =>
    enqueueAniBuddyCritiqueSchema.parse({ creditsAlreadySpent: 12, startPassIndex: 2 }),
  );
  // The ceiling and the pass cap come from the generated schema, so a resumed loop is
  // bounded by the same numbers a fresh one is (R10).
  assert.throws(() =>
    enqueueAniBuddyCritiqueSchema.parse({
      creditsAlreadySpent: ANIBUDDY_LIMITS.CRITIQUE_CREDIT_CEILING + 1,
    }),
  );
  assert.throws(() =>
    enqueueAniBuddyCritiqueSchema.parse({
      startPassIndex: ANIBUDDY_LIMITS.MAX_CRITIQUE_PASSES + 1,
    }),
  );
  // Pass 0 is the unreviewed rig, not something to run.
  assert.throws(() => enqueueAniBuddyCritiqueSchema.parse({ startPassIndex: 0 }));
});

test('anibuddy critique: the loop reports progress under a real stage name', () => {
  // `critique` is a StageName but not a queued stage, and the progress record has to be
  // able to say so — otherwise a running loop reports under whichever stage ran last.
  assert.equal(AniBuddyConstants.critique.stage, 'critique');
  assert.equal(
    (AniBuddyConstants.allStages as readonly string[]).includes(
      AniBuddyConstants.critique.stage,
    ),
    true,
  );
  assert.equal(
    (ANIBUDDY_QUEUED_STAGES as readonly string[]).includes(AniBuddyConstants.critique.stage),
    false,
  );
  assert.equal(AniBuddyConstants.routes.critique, '/anibuddy/projects/:id/critique');
  assert.equal(Object.isFrozen(AniBuddyConstants.critique), true);
});

// ───────────────── the Next↔gateway trust edge, as constants ─────────────────

test('anibuddy vision: the model call has one path and py_backend has its own three', () => {
  // The split that keeps both implementations single. py_backend owns the pixels; the
  // Next app owns the one provider-fallback chain. Neither table can name a route on
  // the other service, so a call cannot drift across the boundary by editing a string.
  assert.equal(AniBuddyConstants.nextVisionPaths.critique, '/api/enhance/anibuddy/critique');
  assert.equal(AniBuddyConstants.nextVisionPaths.motion, '/api/enhance/anibuddy/motion');
  assert.equal(AniBuddyConstants.pyVisionPaths.annotate, '/anibuddy/semantics/annotate');
  assert.equal(
    AniBuddyConstants.pyVisionPaths.contactSheet,
    '/anibuddy/critique/contact-sheet',
  );
  assert.equal(AniBuddyConstants.pyVisionPaths.applyCritique, '/anibuddy/critique/apply');
  assert.equal(Object.isFrozen(AniBuddyConstants.nextVisionPaths), true);
  assert.equal(Object.isFrozen(AniBuddyConstants.pyVisionPaths), true);
});

test('anibuddy vision: the annotate proxy exists so Next holds no py_backend secret', () => {
  // The one route the Next app calls INTO this gateway on. Its body carries a whole
  // sheet as base64, so it needs its own parser mount ahead of the global 100kb one.
  assert.equal(AniBuddyConstants.routes.internalAnnotate, '/anibuddy/internal/annotate');
  assert.equal(
    ANIBUDDY_ANNOTATE_BODY_MOUNT,
    `/api${AniBuddyConstants.routes.internalAnnotate}`,
  );
  // Derived from the sheet ceiling rather than picked, so it cannot fall below the
  // upload limit it has to exceed once base64 inflates it by 4/3.
  const limitMb = Number.parseInt(ANIBUDDY_ANNOTATE_BODY_LIMIT, 10);
  assert.ok(
    limitMb * 1024 * 1024 > (AniBuddyConstants.asset.maxBytes * 4) / 3,
    'the annotate body limit must exceed a base64-inflated sheet at the upload ceiling',
  );
});

test('anibuddy vision: every failure code the loop classifies on is declared once', () => {
  // A mirror of PROPOSAL_ERROR_CODES in the Next AI layer, and it has to stay one: the
  // refund table branches on the code the vision call reports, so a code only one side
  // knows would refund the wrong pass.
  assert.equal(ANIBUDDY_CRITIQUE_ERROR_CODES.PROVIDER_FAILED, 'ANIBUDDY_PROVIDER_FAILED');
  assert.equal(ANIBUDDY_CRITIQUE_ERROR_CODES.CRITIQUE_INVALID, 'ANIBUDDY_CRITIQUE_INVALID');
  assert.equal(ANIBUDDY_CRITIQUE_ERROR_CODES.PIPELINE_REFUSED, 'ANIBUDDY_PIPELINE_REFUSED');
  assert.equal(
    ANIBUDDY_CRITIQUE_ERROR_CODES.PIPELINE_UNAVAILABLE,
    'ANIBUDDY_PIPELINE_UNAVAILABLE',
  );
  assert.equal(Object.isFrozen(ANIBUDDY_CRITIQUE_ERROR_CODES), true);
  assert.equal(AniBuddyConstants.errorCodes, ANIBUDDY_CRITIQUE_ERROR_CODES);
});

// ─────────────── the multipart envelope, and the 1MB form-field cap ───────────────

test('anibuddy envelope: the JSON request rides as a file part, not a form field', () => {
  // Starlette caps a NON-FILE multipart part at 1 MB and refuses the request before any
  // handler runs. A part with a filename is spooled to a temporary file with no such
  // bound, and the filename is the only thing that makes the difference — so it is a
  // constant rather than a literal at four call sites.
  assert.equal(AniBuddyConstants.envelopeFormField, 'request');
  assert.ok(
    AniBuddyConstants.envelopeFilename.length > 0,
    'the envelope needs a filename or the parser treats it as a form field',
  );
  assert.equal(AniBuddyConstants.envelopeContentType, 'application/json');

  // And the reason a form field cannot carry it. The geometry sidecar bounds each
  // BUFFER, not the document, so sending oversized geometry out of band does not bound
  // the JSON: a mesh part carries three inline numeric buffers (verts, tris, weights),
  // each up to MAX_INLINE_BUFFER_ELEMENTS, and a JSON number costs at least two
  // characters. At MAX_PARTS that is past 1 MB before masks, pivots or clips are
  // counted — so the cap is reachable by a legal document, not only by an abusive one.
  const MESH_BUFFERS_PER_PART = 3;
  const MIN_JSON_CHARS_PER_VALUE = 2;
  assert.ok(
    ANIBUDDY_LIMITS.MAX_PARTS *
      MESH_BUFFERS_PER_PART *
      ANIBUDDY_LIMITS.MAX_INLINE_BUFFER_ELEMENTS *
      MIN_JSON_CHARS_PER_VALUE >
      1024 * 1024,
    'a legal max-size document must be able to exceed the 1MB cap, or the fix guards nothing',
  );
});

// ───────────────────── render request and artifact handoff ─────────────────────

test('anibuddy render: the enqueue DTO refuses a format or matte py_backend would', () => {
  const base = { stage: 'render' as const, units: 12 };
  assert.doesNotThrow(() =>
    enqueueAniBuddyStageSchema.parse({
      ...base,
      render: { clipId: 'walk', format: 'webm', fps: 24, frameCount: 48, background: 'dark' },
    }),
  );

  // Refused here rather than as a 422 after the credits were consumed.
  assert.throws(() =>
    enqueueAniBuddyStageSchema.parse({ ...base, render: { format: 'avif' } }),
  );
  assert.throws(() =>
    enqueueAniBuddyStageSchema.parse({ ...base, render: { background: 'chroma-green' } }),
  );
  assert.throws(() =>
    enqueueAniBuddyStageSchema.parse({ ...base, render: { clipId: 'a'.repeat(33) } }),
  );
  assert.throws(() =>
    enqueueAniBuddyStageSchema.parse({
      ...base,
      render: { frameCount: ANIBUDDY_LIMITS.MAX_FRAMES + 1 },
    }),
  );
  // Nothing about geometry or the export gate may ride an enqueue (R5, §7.8).
  for (const smuggled of ['diagnostics', 'parts', 'skeleton', 'document']) {
    assert.equal(
      enqueueAniBuddyStageSchema.safeParse({ ...base, [smuggled]: {} }).success,
      false,
      `an enqueue must not accept '${smuggled}'`,
    );
  }

  // The Node-side format list is the same one Python refuses on, and the default
  // is the encoder with no external dependency (F9 §8.5).
  assert.equal(AniBuddyConstants.render.defaultFormat, 'png-zip');
  assert.equal(AniBuddyConstants.render.formats[0], AniBuddyConstants.render.defaultFormat);
});

test('anibuddy render: a deformer override names a part and a real deformer kind', () => {
  assert.doesNotThrow(() =>
    enqueueAniBuddyStageSchema.parse({
      stage: 'rig',
      render: undefined,
      rig: { deformerOverrides: { torso: 'mesh', cape: 'lattice' } },
    }),
  );
  assert.throws(() =>
    enqueueAniBuddyStageSchema.parse({ stage: 'rig', rig: { deformerOverrides: { torso: 'jelly' } } }),
  );
});

test('anibuddy render: how an artifact reaches storage is read from the hint, not guessed', () => {
  const base = {
    kind: 'render',
    suggestedStorageKey: 'anibuddy/proj_test/render/abc.zip',
    contentHash: 'f'.repeat(64),
  };

  // Small enough to have ridden inside the JSON body.
  assert.equal(
    AniBuddyPyClient.artifactDelivery({ ...base, contentBase64: 'AAAA', cacheKey: 'c'.repeat(64) }),
    'inline',
  );
  // Above the inline threshold: no base64, a cache key to stream from instead.
  assert.equal(
    AniBuddyPyClient.artifactDelivery({
      ...base,
      contentBase64: null,
      cacheKey: 'c'.repeat(64),
      downloadPath: '/anibuddy/render/artifacts/' + 'c'.repeat(64),
    }),
    'stream',
  );
  // A stub artifact: the suggested key IS the artifact, and there is nothing to
  // upload. This is the branch that keeps local/CI runs completing.
  assert.equal(AniBuddyPyClient.artifactDelivery(base), 'key-only');
});

test('anibuddy render: the stream path is built from the table, not from the response', () => {
  const cacheKey = 'd'.repeat(64);
  assert.equal(
    AniBuddyPyClient.artifactPathFor(cacheKey),
    `/anibuddy/render/artifacts/${cacheKey}`,
  );
  assert.equal(
    AniBuddyPyClient.artifactPathFor(cacheKey),
    AniBuddyConstants.render.artifactPath.replace(':cacheKey', cacheKey),
  );
  // A cache key arriving with a path separator in it cannot escape the route.
  assert.equal(AniBuddyPyClient.artifactPathFor('../secrets').includes('..%2Fsecrets'), true);
});

// ───────────────────────── rig buffer sidecar ─────────────────────────

test('anibuddy buffers: every external NumericBuffer in the document is found', () => {
  const document = documentWithExternalBuffers();
  const references = AniBuddyBufferSidecar.references(document);

  // Four payloads across three nesting depths: the mesh's own verts and weights,
  // a cut line inside the mesh, and the RLE mask on a different part.
  assert.deepEqual(references.map((entry) => entry.sha256).sort(), [
    '1'.repeat(64),
    '2'.repeat(64),
    '3'.repeat(64),
    '4'.repeat(64),
  ]);
  assert.equal(
    references.every((entry) => entry.storageKey?.startsWith('anibuddy/proj_test/buffers/')),
    true,
  );

  // An inline buffer is not a reference — it has no key to rewrite.
  assert.equal(
    AniBuddyBufferSidecar.isExternalReference({
      dtype: 'u32',
      storage: 'inline',
      sha256: '5'.repeat(64),
    }),
    false,
  );
  // Nor is anything that merely uses the word.
  assert.equal(AniBuddyBufferSidecar.isExternalReference({ storage: 'external' }), false);
});

test('anibuddy buffers: rewriting re-points by content hash and leaves the rest alone', () => {
  const document = documentWithExternalBuffers();
  const rewritten = AniBuddyBufferSidecar.rewrite(
    document,
    new Map([
      ['1'.repeat(64), 'open_assets/anibuddy/proj_test_buffers_verts'],
      ['4'.repeat(64), 'open_assets/anibuddy/proj_test_buffers_runs'],
    ]),
  );

  const keyBySha = new Map(
    AniBuddyBufferSidecar.references(rewritten).map((entry) => [entry.sha256, entry.storageKey]),
  );
  assert.equal(keyBySha.get('1'.repeat(64)), 'open_assets/anibuddy/proj_test_buffers_verts');
  assert.equal(keyBySha.get('4'.repeat(64)), 'open_assets/anibuddy/proj_test_buffers_runs');
  // A hash the adapter did not report keeps the key py_backend suggested, rather
  // than being blanked into a document that points nowhere.
  assert.equal(
    keyBySha.get('2'.repeat(64)),
    `anibuddy/proj_test/buffers/${'2'.repeat(64)}.bin`,
  );

  // The rewrite is a copy: the document that was validated is not mutated.
  assert.equal(
    AniBuddyBufferSidecar.references(document)
      .map((entry) => entry.storageKey)
      .every((key) => key?.startsWith('anibuddy/')),
    true,
  );
  // And it is still a valid document afterwards.
  assert.equal(AniBuddyRigDocumentDto.rigDocument.safeParse(rewritten).success, true);
});

test('anibuddy buffers: a payload that does not hash to its own name is refused', () => {
  const bytes = Buffer.from([1, 2, 3, 4]);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  assert.deepEqual(
    AniBuddyBufferSidecar.decode({
      storageKey: 'anibuddy/proj_test/buffers/x.bin',
      sha256,
      dtype: 'u32',
      length: 1,
      contentBase64: bytes.toString('base64'),
    }),
    bytes,
  );

  // The hash is the buffer's identity everywhere downstream — it names the object
  // and keys the render cache — so bytes that disagree with it cannot be stored
  // under it (R7).
  assert.throws(
    () =>
      AniBuddyBufferSidecar.decode({
        storageKey: 'anibuddy/proj_test/buffers/x.bin',
        sha256: '9'.repeat(64),
        dtype: 'u32',
        length: 1,
        contentBase64: bytes.toString('base64'),
      }),
    /cannot be stored under that name/,
  );
});

test('anibuddy buffers: only the stages that evaluate geometry are sent it back', () => {
  // The inbound half of the handoff. py_backend holds no storage credentials, so a
  // stage that reads a weight matrix needs Node to bring the bytes; decompose
  // authors the first revision and reads none, and the stub reads nothing at all.
  assert.equal(AniBuddyConstants.transportReadsGeometry['render-multipart'], true);
  assert.equal(AniBuddyConstants.transportReadsGeometry['rig-multipart'], true);
  assert.equal(AniBuddyConstants.transportReadsGeometry['decompose-multipart'], false);
  assert.equal(AniBuddyConstants.transportReadsGeometry.stub, false);
  assert.equal(Object.isFrozen(AniBuddyConstants.transportReadsGeometry), true);

  // They ride as multipart file parts rather than inside the JSON request field,
  // which the parser on the other side caps at 1MB — less than one weight matrix.
  assert.equal(AniBuddyConstants.bufferFormField, 'buffers');
  assert.ok(AniBuddyConstants.bufferFetchConcurrency >= 1);

  // A document with no external geometry asks for no reads, which is every
  // document the decompose stage produces.
  assert.deepEqual(
    AniBuddyBufferSidecar.references(documentWith(['torso'], ['root'])),
    [],
  );
});

test('anibuddy buffers: one content-addressed key derives one adapter public id', () => {
  assert.equal(
    AniBuddyBufferSidecar.publicIdFor('anibuddy/proj_test/buffers/abc.bin', 'fallback'),
    'proj_test_buffers_abc.bin',
  );
  // The render artifact goes through the same derivation, so identical bytes never
  // land at two ids.
  assert.equal(
    AniBuddyBufferSidecar.publicIdFor('anibuddy/proj_test/render/abc.zip', 'fallback'),
    'proj_test_render_abc.zip',
  );
  assert.equal(AniBuddyBufferSidecar.publicIdFor('anibuddy/', 'fallback'), 'fallback');
});
