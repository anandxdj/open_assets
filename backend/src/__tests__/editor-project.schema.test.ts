import assert from 'node:assert/strict';
import test from 'node:test';
import { Types } from 'mongoose';
import { EditorProjectModel } from '../modules/editor-projects/editor-project.model';

function project() {
  return new EditorProjectModel({
    owner: new Types.ObjectId(),
    name: 'UI sprites',
    revision: 1,
    pages: [{
      id: 'page-1', jobId: 'job-1', name: 'Buttons',
      overviewFrame: { x: 0, y: 0, width: 420, height: 320 },
      viewport: { x: 80, y: 80, zoom: 0.7 },
      layers: [{
        id: 'source-job-1', kind: 'source', name: 'Buttons',
        x: 0, y: 0, width: 1024, height: 512, visible: true, locked: false,
      }],
    }],
  });
}

test('editor project schema keeps ordered page and nondestructive layer transforms', () => {
  const value = project();
  assert.equal(value.validateSync(), undefined);
  assert.equal(value.pages[0]?.layers[0]?.width, 1024);
  assert.equal(value.pages[0]?.layers[0]?.kind, 'source');
});

test('editor project schema refuses an unsupported layer kind', () => {
  const value = project();
  value.pages[0]!.layers[0]!.kind = 'text' as 'source';
  assert.match(value.validateSync()?.message ?? '', /kind/);
});
