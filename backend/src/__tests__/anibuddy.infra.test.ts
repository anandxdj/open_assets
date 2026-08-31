import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AniBuddyConstants,
  ANIBUDDY_QUEUE_NAMES,
  ANIBUDDY_QUEUED_STAGES,
} from '../modules/anibuddy/anibuddy.constants';
import { AniBuddyPyClient } from '../modules/anibuddy/anibuddy.py.client';
import { AniBuddyRigDocumentDto } from '../modules/anibuddy/dto/index.dto';
import {
  createAniBuddyProjectSchema,
  enqueueAniBuddyStageSchema,
} from '../modules/anibuddy/dto/project.schema';
import { Config } from '../common/config/config';

test('anibuddy infra: every BullMQ queue name is registered in constants', () => {
  // Five queues, four queued stages. `critique` has a queue of its own but is not a
  // queued STAGE: one job is a bounded loop over render and vision passes with its
  // own billing and its own three stop conditions, driven by `AniBuddyCritiqueService`
  // rather than by `processStageJob`. Modelling it as a fifth stage would mean that
  // function growing a second control flow only one stage ever takes.
  assert.deepEqual([...ANIBUDDY_QUEUE_NAMES], [
    'anibuddy-decompose',
    'anibuddy-rig',
    'anibuddy-animate',
    'anibuddy-render',
    'anibuddy-critique',
  ]);
  assert.deepEqual([...ANIBUDDY_QUEUED_STAGES], ['decompose', 'rig', 'animate', 'render']);
  assert.equal(
    (ANIBUDDY_QUEUE_NAMES as readonly string[]).includes(AniBuddyConstants.critique.queueName),
    true,
  );
  assert.equal(
    (ANIBUDDY_QUEUED_STAGES as readonly string[]).includes(AniBuddyConstants.critique.stage),
    false,
  );
  for (const stage of ANIBUDDY_QUEUED_STAGES) {
    assert.equal(AniBuddyConstants.queueByStage[stage], `anibuddy-${stage}`);
    assert.equal(AniBuddyConstants.jobNames[stage], `anibuddy-${stage}`);
    assert.equal(AniBuddyConstants.usageOpByStage[stage], `anibuddy-${stage}`);
  }
});

test('anibuddy infra: frozen config exposes pipeline + py backend settings', () => {
  assert.equal(typeof Config.anibuddy.pipelineVersion, 'string');
  assert.equal(typeof Config.anibuddy.kernelVersion, 'string');
  assert.ok(Config.anibuddy.workerConcurrency >= 1);
  assert.ok(Config.pyBackend.baseUrl.length > 0);
  assert.equal(Config.anibuddy.generationEnabled, false);
});

test('anibuddy infra: create/enqueue DTOs accept the vertical-slice payload', () => {
  const created = createAniBuddyProjectSchema.parse({
    name: 'Hero sheet',
    asset: {
      name: 'hero.png',
      storageKey: 'open_assets/originals/hero',
      contentHash: 'a'.repeat(64),
      width: 512,
      height: 512,
      mimeType: 'image/png',
      rightsConfirmed: true,
      remoteVisionConsented: false,
    },
  });
  assert.equal(created.enqueueDecompose, true);
  assert.equal(created.archetype, 'humanoid');

  const enqueued = enqueueAniBuddyStageSchema.parse({ stage: 'decompose', units: 2 });
  assert.equal(enqueued.stage, 'decompose');
  assert.throws(() => enqueueAniBuddyStageSchema.parse({ stage: 'critique' }));
});

test('anibuddy infra: stub RigDocument shape validates against generated zod', () => {
  const now = '2026-08-13T12:00:00.000Z';
  const document = {
    schemaVersion: 5,
    id: 'rev_stub_1',
    projectId: 'proj_stub_1',
    createdAt: now,
    updatedAt: now,
    revision: { index: 1, parentRevisionId: null, reason: 'stub-decompose', accepted: false },
    archetype: 'humanoid',
    asset: {
      id: 'asset_1',
      name: 'hero.png',
      storageKey: 'open_assets/originals/hero',
      contentHash: 'b'.repeat(64),
      width: 512,
      height: 512,
      // Null is the honest value for a sheet that has been uploaded but not
      // decomposed: nothing has measured the figure yet, and a consumer falls
      // back to `height`.
      figureHeight: null,
      mimeType: 'image/png',
      rightsConfirmed: true,
      remoteVisionConsented: false,
    },
    parts: [{
      id: 'stub_torso',
      name: 'Stub torso',
      role: 'torso',
      mask: { kind: 'rect' },
      rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      pivot: { x: 0.5, y: 0.15 },
      zIndex: 0,
      parentPartId: null,
      attachSlot: null,
      slots: [],
      deformer: { kind: 'rigid' },
      boundJointId: null,
      visible: true,
      opacity: 1,
      confidence: 0.42,
      provenance: 'alpha-component',
    }],
    skeleton: { joints: [] },
    clips: [],
    generation: { mode: 'external-prompt-only', prompt: null, transcript: [], producedBy: null },
    provenance: {
      pipelineVersion: Config.anibuddy.pipelineVersion,
      kernelVersion: Config.anibuddy.kernelVersion,
      stages: [{
        stage: 'decompose',
        status: 'succeeded',
        startedAt: now,
        finishedAt: now,
        inputHash: 'c'.repeat(64),
        passIndex: 0,
        modelId: null,
        usageEventId: null,
        creditsSpent: 0,
        message: 'Stub decompose completed',
      }],
    },
    diagnostics: {
      foregroundPixels: 0,
      coveredForegroundPixels: 0,
      overlappingPartPairs: [],
      maxStretch: 1,
      flippedTriangles: 0,
      isolatedVertices: 0,
      warnings: ['infra-slice stub: decompose'],
      blockingReason: 'Stub decompose only — real cutouts and a skeleton are required before export.',
    },
  };

  const parsed = AniBuddyRigDocumentDto.rigDocument.parse(document);
  assert.equal(parsed.schemaVersion, 5);
  assert.equal(parsed.diagnostics.blockingReason?.startsWith('Stub'), true);
});

test('anibuddy infra: inputHash is stable sha256 hex for identical payloads', () => {
  const payload = { stage: 'decompose', projectId: 'p1', assetContentHash: 'd'.repeat(64) };
  const a = AniBuddyPyClient.hashStageInput(payload);
  const b = AniBuddyPyClient.hashStageInput(payload);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, AniBuddyPyClient.hashStageInput({ ...payload, projectId: 'p2' }));
});

test('anibuddy infra: queue name constants match the BullMQ registration contract', () => {
  // Do not import bullmq.ts here — constructing Queue attaches an open Redis
  // handle that keeps the node:test process alive. Registration is verified by
  // typecheck + these name contracts matching AniBuddyConstants.queueByStage.
  assert.equal(AniBuddyConstants.queueByStage.decompose, 'anibuddy-decompose');
  assert.equal(AniBuddyConstants.queueByStage.rig, 'anibuddy-rig');
  assert.equal(AniBuddyConstants.queueByStage.animate, 'anibuddy-animate');
  assert.equal(AniBuddyConstants.queueByStage.render, 'anibuddy-render');
  assert.equal(AniBuddyConstants.storageFolder, 'anibuddy');
});
