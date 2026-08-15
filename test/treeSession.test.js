import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { advanceTree, traceWord } from '../src/treeSession.js';

const tree = {
  words: ['cat', 'bat', 'dog'],
  q: { id: 'cl', baseId: 'cl', type: 'cup', text: 'How many letters?', inverted: false },
  ch: {
    '3': {
      words: ['cat', 'bat', 'dog'],
      q: { id: 'hc:not', baseId: 'hc', type: 'bin', text: 'Does not contain "C"?', inverted: true },
      ch: {
        YES: {
          words: ['bat', 'dog'],
          q: { id: 'hd:normal', baseId: 'hd', type: 'bin', text: 'Contains "D"?', inverted: false },
          ch: {
            YES: { words: ['dog'], q: null, ch: {} },
            NO: { words: ['bat'], q: null, ch: {} },
          },
        },
        NO: { words: ['cat'], q: null, ch: {} },
      },
    },
  },
};

test('advances binary and cup answers using displayed semantics', () => {
  const cup = advanceTree(tree, '3');
  assert.equal(cup.status, 'question');
  const binary = advanceTree(cup.node, false);
  assert.equal(binary.status, 'leaf');
  assert.deepEqual(binary.node.words, ['cat']);
  assert.equal(binary.noDelta, 1);
});

test('traces Guess mode through same tree nodes', () => {
  const trace = traceWord(tree, 'dog');
  assert.equal(trace.status, 'leaf');
  assert.deepEqual(trace.node.words, ['dog']);
  assert.deepEqual(trace.trail.map(step => step.q), [
    'How many letters?', 'Does not contain "C"?', 'Contains "D"?',
  ]);
  assert.equal(trace.noUsed, 0);
});

test('returns no-match instead of inventing a question', () => {
  assert.equal(advanceTree(tree, '9').status, 'no-match');
  assert.equal(traceWord(tree, 'missing').status, 'no-match');
});

test('App and TreeView do not invoke independent greedy solving', async () => {
  const [app, treeView] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/TreeView.jsx', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(app, /\bpickQ\b|\bfindExclusionVariants\b|\bisConverged\b/);
  assert.doesNotMatch(treeView, /\bbuildAllTreeVariants\b/);
});

test('node question dropdown requests and applies globally solved variants', async () => {
  const [app, treeView, worker] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/TreeView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/alternativeWorker.js', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /loadTreeAlternatives/);
  assert.match(app, /applyTreeAlternative/);
  assert.match(treeView, /onLoadAlternatives/);
  assert.match(treeView, /onApplyAlternative/);
  assert.match(worker, /solveForcedAlternatives/);
});
