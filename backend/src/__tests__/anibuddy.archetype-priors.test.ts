import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArchetypePriorsConstants } from '../modules/anibuddy/archetype-priors.constants';
import { ArchetypePriors } from '../modules/anibuddy/archetype-priors.loader';

test('archetype priors: all six archetypes load from canonical JSON', () => {
  const ids = ArchetypePriors.listIds();
  assert.deepEqual([...ids], [
    'humanoid',
    'creature',
    'mechanical',
    'prop',
    'environment',
    'ui',
  ]);
  assert.match(ArchetypePriors.resolvePath(), /archetype-priors\.v1\.json$/);
  assert.equal(ArchetypePriors.getDocument().version, ArchetypePriorsConstants.VERSION);
});

test('archetype priors: default deformers match locked role tables', () => {
  assert.equal(ArchetypePriors.defaultDeformer('humanoid', 'torso'), 'mesh');
  assert.equal(ArchetypePriors.defaultDeformer('humanoid', 'hair'), 'lattice');
  assert.equal(ArchetypePriors.defaultDeformer('humanoid', 'hand'), 'rigid');
  assert.equal(ArchetypePriors.defaultDeformer('creature', 'tail'), 'spline');
  assert.equal(ArchetypePriors.defaultDeformer('creature', 'tentacle'), 'spline');
  assert.equal(ArchetypePriors.defaultDeformer('mechanical', 'wheel'), 'rigid');
  assert.equal(ArchetypePriors.defaultDeformer('mechanical', 'track'), 'lattice');
  assert.equal(ArchetypePriors.defaultDeformer('mechanical', 'antenna'), 'spline');
  assert.equal(ArchetypePriors.defaultDeformer('prop', 'smoke'), 'spline');
  assert.equal(ArchetypePriors.defaultDeformer('environment', 'foliage'), 'lattice');
  assert.equal(ArchetypePriors.defaultDeformer('ui', 'glyph'), 'rigid');
});

test('archetype priors: humanoid limb tips get ikChainLength 2', () => {
  assert.equal(ArchetypePriors.ikChainLength('humanoid', 'limbTip'), 2);
});

test('archetype priors: prop may have an empty skeleton', () => {
  assert.equal(ArchetypePriors.get('prop').topology.allowEmptySkeleton, true);
});

test('archetype priors: attach slot names are centralized', () => {
  const slots = ArchetypePriors.attachSlots('humanoid');
  assert.ok(slots.some((s) => s.slotName === ArchetypePriorsConstants.SLOT.GRIP));
});
