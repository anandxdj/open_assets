import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AniBuddyRigDocumentDto, ANIBUDDY_LIMITS } from '../modules/anibuddy/dto/index.dto';
import { AniBuddyRigDocumentSchemas } from '../modules/anibuddy/anibuddy.rig-document.generated.model';

// Guards for the generated RigDocument v5 bindings. These do not re-test zod;
// they pin the handful of contract properties the rest of the pipeline builds
// on, so a bad regeneration fails here rather than three services downstream.

function minimalDocument() {
  return {
    schemaVersion: 5,
    id: 'doc-1',
    projectId: 'proj-1',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    revision: { index: 0, parentRevisionId: null, reason: 'decompose', accepted: false },
    archetype: 'humanoid',
    asset: {
      id: 'asset-1',
      name: 'hero.png',
      storageKey: 'anibuddy/proj-1/hero.png',
      contentHash: '0'.repeat(64),
      width: 512,
      height: 512,
      figureHeight: 440,
      mimeType: 'image/png',
      rightsConfirmed: true,
      remoteVisionConsented: true,
    },
    parts: [{
      id: 'torso',
      name: 'Torso',
      role: 'torso',
      mask: { kind: 'rect' },
      rect: { x: 0, y: 0, width: 1, height: 1 },
      pivot: { x: 0.5, y: 0.1 },
      zIndex: 0,
      parentPartId: null,
      attachSlot: null,
      slots: [],
      deformer: { kind: 'rigid' },
      boundJointId: null,
      visible: true,
      opacity: 1,
      confidence: 0.9,
      provenance: 'alpha-component',
    }],
    skeleton: { joints: [] },
    clips: [],
    generation: { mode: 'external-prompt-only', prompt: null, transcript: [], producedBy: null },
    provenance: { pipelineVersion: '5.0.0', kernelVersion: '0.1.0', stages: [] },
    diagnostics: {
      foregroundPixels: 0,
      coveredForegroundPixels: 0,
      overlappingPartPairs: [],
      maxStretch: 1,
      flippedTriangles: 0,
      isolatedVertices: 0,
      warnings: [],
      blockingReason: null,
    },
  };
}

test('rig document: a minimal humanoid document parses', () => {
  const parsed = AniBuddyRigDocumentDto.rigDocument.parse(minimalDocument());
  assert.equal(parsed.schemaVersion, 5);
  assert.equal(parsed.parts[0]?.deformer.kind, 'rigid');
});

test('rig document: unknown fields are rejected, not silently dropped', () => {
  const document = { ...minimalDocument(), somethingInvented: true };
  assert.throws(() => AniBuddyRigDocumentDto.rigDocument.parse(document));
});

test('rig document: schemaVersion is pinned to 5', () => {
  const document = { ...minimalDocument(), schemaVersion: 4 };
  assert.throws(() => AniBuddyRigDocumentDto.rigDocument.parse(document));
});

// R3 — the vision model proposes semantics only. There is deliberately no
// field on a proposal through which vertices, triangles or weights can arrive,
// so a model that tries to send geometry is rejected at the boundary.
test('semantics proposal: carries no geometry channel', () => {
  const proposal = {
    archetype: 'humanoid',
    parts: [{
      partId: 'torso',
      role: 'torso',
      parentPartId: null,
      attachSlot: null,
      pivotHint: { x: 0.5, y: 0.1 },
      zIndex: 0,
      deformerHint: 'mesh',
      confidence: 0.8,
    }],
    joints: [],
    warnings: [],
  };
  assert.doesNotThrow(() => AniBuddyRigDocumentDto.semanticsProposal.parse(proposal));

  const withGeometry = {
    ...proposal,
    parts: [{ ...proposal.parts[0], verts: [0, 0, 1, 1], tris: [0, 1, 2] }],
  };
  assert.throws(() => AniBuddyRigDocumentDto.semanticsProposal.parse(withGeometry));
});

test('critique report: corrections are capped per pass', () => {
  const correction = {
    kind: 'pivot-nudge',
    targetId: 'torso',
    reason: 'The torso rotates about its centre instead of the hips.',
    vec2: { x: 0, y: 0.04 },
    scalar: null,
    intValue: null,
    deformerKind: null,
    stringValue: null,
  };
  const overCap = {
    verdict: 'revise',
    passIndex: 0,
    observations: [],
    corrections: Array.from({ length: ANIBUDDY_LIMITS.MAX_CORRECTIONS_PER_PASS + 1 }, () => correction),
  };
  assert.throws(() => AniBuddyRigDocumentDto.critiqueReport.parse(overCap));
});

test('limits: the caps other services read are present and ordered sanely', () => {
  assert.equal(ANIBUDDY_LIMITS.SCHEMA_VERSION, 5);
  assert.ok(ANIBUDDY_LIMITS.MAX_PARTS > 0);
  assert.ok(ANIBUDDY_LIMITS.MAX_JOINTS >= ANIBUDDY_LIMITS.MAX_PARTS);
  assert.ok(ANIBUDDY_LIMITS.MAX_CRITIQUE_PASSES >= 1);
  assert.ok(ANIBUDDY_LIMITS.CRITIQUE_CREDIT_CEILING > ANIBUDDY_LIMITS.MAX_CRITIQUE_PASSES);
});

test('mongoose projection: every generated sub-schema constructs', () => {
  const names = Object.keys(AniBuddyRigDocumentSchemas);
  assert.ok(names.includes('rigDocument'));
  for (const name of names) {
    const schema = AniBuddyRigDocumentSchemas[name as keyof typeof AniBuddyRigDocumentSchemas];
    assert.ok(schema.paths, `${name} did not build any paths`);
  }
});
