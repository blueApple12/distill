import test from 'node:test';
import assert from 'node:assert/strict';

import {
  solveTree, solvePrimary, solveAdvice, solveForcedAlternatives, validateTree,
} from '../src/solver.js';

const ONLY_CONTAINS = {
  cups: false,
  length: false,
  contains: true,
  position: false,
  dupe: false,
};

test('proves indistinguishable words impossible immediately', () => {
  const words = ['aa', 'aa'];
  const started = Date.now();
  const primary = solvePrimary({ words, maxNOs: 0, stopAt: 1 });
  const advice = solveAdvice({ words, maxExclude: 0, stopAt: 1 }, primary);
  assert.equal(primary.status, 'impossible');
  assert.equal(advice?.count, 1);
  assert.ok(Date.now() - started < 100);
});

test('uses more than six questions instead of falsely requiring exclusions', () => {
  const words = 'cat bat mat rat hat sat fat pat'.split(' ');
  const result = solveTree(words, {
    mode: '5050', maxNOs: 1, stopAt: 1,
    allowed: ONLY_CONTAINS, customQs: [],
  });

  assert.equal(result.status, 'solved');
  assert.equal(result.depth, 7);
  assert.equal(result.validation.valid, true);
  assert.equal(result.validation.maxNOsUsed, 1);
  assert.equal(result.validation.maxLeafSize, 1);
  assert.doesNotThrow(() => structuredClone(result.tree));
  assert.doesNotThrow(() => JSON.stringify(result.tree));
});

test('continues with a cup question when binary NO budget is exhausted', () => {
  const result = solveTree(['a', 'bb', 'ccc'], {
    mode: '5050', maxNOs: 1, initialNOs: 1, stopAt: 1,
    allowed: { cups: true, length: false, contains: false, position: false, dupe: false },
    customQs: [],
  });

  assert.equal(result.status, 'solved');
  assert.equal(result.depth, 1);
  assert.equal(result.tree.q.type, 'cup');
  assert.equal(result.validation.maxNOsUsed, 1);
});

test('treats zero MAX NOs as unlimited', () => {
  const result = solveTree('cat bat mat rat'.split(' '), {
    mode: '5050', maxNOs: 0, stopAt: 1,
    allowed: ONLY_CONTAINS, customQs: [],
  });
  assert.equal(result.status, 'solved');
  assert.equal(result.validation.valid, true);
});

test('returns impossible when every valid split exceeds NO budget', () => {
  const words = ['a', 'b', 'c', 'd'];
  const questions = [
    { id: 'q1:normal', baseId: 'q1', type: 'bin', text: 'Q1?', inverted: false, test: w => w === 'a' || w === 'b' },
    { id: 'q1:not', baseId: 'q1', type: 'bin', text: 'NOT Q1?', inverted: true, test: w => w === 'c' || w === 'd' },
    { id: 'q2:normal', baseId: 'q2', type: 'bin', text: 'Q2?', inverted: false, test: w => w === 'a' || w === 'c' },
    { id: 'q2:not', baseId: 'q2', type: 'bin', text: 'NOT Q2?', inverted: true, test: w => w === 'b' || w === 'd' },
  ];
  const result = solveTree(words, { mode: '5050', maxNOs: 1, stopAt: 1, questions });
  assert.equal(result.status, 'impossible');
});

test('matches independent brute-force minimum depth', () => {
  const words = ['a', 'b', 'c'];
  const questions = [
    { id: 'a:normal', baseId: 'a', type: 'bin', text: 'A?', inverted: false, test: w => w === 'a' },
    { id: 'a:not', baseId: 'a', type: 'bin', text: 'NOT A?', inverted: true, test: w => w !== 'a' },
    { id: 'b:normal', baseId: 'b', type: 'bin', text: 'B?', inverted: false, test: w => w === 'b' },
    { id: 'b:not', baseId: 'b', type: 'bin', text: 'NOT B?', inverted: true, test: w => w !== 'b' },
  ];
  function bruteDepth(candidates, memo = new Map()) {
    if (candidates.length <= 1) return 0;
    const key = [...candidates].sort().join('|');
    if (memo.has(key)) return memo.get(key);
    let best = Infinity;
    for (const q of questions) {
      const yes = candidates.filter(q.test);
      const no = candidates.filter(word => !q.test(word));
      if (!yes.length || !no.length) continue;
      best = Math.min(best, 1 + Math.max(bruteDepth(yes, memo), bruteDepth(no, memo)));
    }
    memo.set(key, best);
    return best;
  }

  const result = solveTree(words, { mode: '5050', maxNOs: 0, stopAt: 1, questions });
  assert.equal(result.status, 'solved');
  assert.equal(result.depth, bruteDepth(words));
  assert.equal(validateTree(result.tree, { maxNOs: 0, stopAt: 1 }).valid, true);
});

test('mode only changes ordering among equally short valid trees', () => {
  const words = ['a', 'b', 'c', 'd', 'e'];
  const customQs = [
    { id: 'cu_pair', type: 'bin', text: 'Pair?', tags: { a: true, b: true } },
    ...words.slice(0, -1).map(word => ({
      id: `cu_${word}`, type: 'bin', text: `${word}?`, tags: { [word]: true },
    })),
  ];
  const allowed = Object.fromEntries(customQs.map(q => [q.id, true]));
  Object.assign(allowed, { cups: false, length: false, contains: false, position: false, dupe: false });
  const base = { words, maxNOs: 0, stopAt: 1, allowed, customQs };
  const balanced = solveTree(words, { ...base, mode: '5050' });
  const precision = solveTree(words, { ...base, mode: 'sniper' });

  assert.equal(balanced.depth, precision.depth);
  assert.equal(balanced.depth, 3);
  assert.equal(balanced.validation.valid, true);
  assert.equal(precision.validation.valid, true);
});

test('forces a replacement question at a node while preserving its ancestors', () => {
  const words = ['a', 'b', 'c', 'd'];
  const questions = [
    { id: 'root', baseId: 'root', type: 'bin', text: 'Root?', test: w => w === 'a' || w === 'b' },
    { id: 'left-a', baseId: 'left-a', type: 'bin', text: 'Left A?', test: w => w === 'a' },
    { id: 'left-b', baseId: 'left-b', type: 'bin', text: 'Left B?', test: w => w === 'b' },
    { id: 'right-c', baseId: 'right-c', type: 'bin', text: 'Right C?', test: w => w === 'c' },
  ].map(q => ({ ...q, inverted: false }));

  const result = solveTree(words, {
    questions, maxNOs: 0, stopAt: 1,
    forcedQuestions: [
      { path: [], questionId: 'root' },
      { path: ['YES'], questionId: 'left-b' },
    ],
  });

  assert.equal(result.status, 'solved');
  assert.equal(result.tree.q.id, 'root');
  assert.equal(result.tree.ch.YES.q.id, 'left-b');
  assert.equal(result.validation.valid, true);
});

test('returns only same-quality validated global alternatives for a node', () => {
  const words = ['a', 'b', 'c', 'd'];
  const questions = [
    { id: 'ab', baseId: 'ab', type: 'bin', text: 'AB?', test: w => w === 'a' || w === 'b' },
    { id: 'ac', baseId: 'ac', type: 'bin', text: 'AC?', test: w => w === 'a' || w === 'c' },
    { id: 'a', baseId: 'a', type: 'bin', text: 'A?', test: w => w === 'a' },
    { id: 'b', baseId: 'b', type: 'bin', text: 'B?', test: w => w === 'b' },
    { id: 'c', baseId: 'c', type: 'bin', text: 'C?', test: w => w === 'c' },
  ].map(q => ({ ...q, inverted: false }));
  const primary = solvePrimary({ words, questions, maxNOs: 0, stopAt: 1, maxExclude: 0 });
  const baseline = primary.variants[0];

  const alternatives = solveForcedAlternatives(
    { words, questions, maxNOs: 0, stopAt: 1, maxExclude: 0 },
    { path: [], baseline },
  );

  assert.ok(alternatives.length >= 2);
  assert.ok(alternatives.some(item => item.question.id !== baseline.tree.q.id));
  for (const item of alternatives) {
    assert.equal(item.variant.tree.q.id, item.question.id);
    assert.equal(item.variant.depth, baseline.depth);
    assert.equal(item.variant.validation.valid, true);
    assert.equal(item.variant.toExclude.length, baseline.toExclude.length);
  }
});

test('prefers a longer tree with no negative questions over a shorter negative tree', () => {
  const words = ['a', 'b', 'c', 'd'];
  const questions = [
    { id: 'negative-pair', baseId: 'negative-pair', type: 'bin', text: 'Negative pair?', inverted: true, test: w => w === 'a' || w === 'b' },
    { id: 'a', baseId: 'a', type: 'bin', text: 'A?', inverted: false, test: w => w === 'a' },
    { id: 'b', baseId: 'b', type: 'bin', text: 'B?', inverted: false, test: w => w === 'b' },
    { id: 'c', baseId: 'c', type: 'bin', text: 'C?', inverted: false, test: w => w === 'c' },
  ];

  const result = solveTree(words, { questions, maxNOs: 0, stopAt: 1 });

  const hasNegative = node => !!node?.q && (node.q.inverted
    || Object.values(node.ch || {}).some(hasNegative));
  assert.equal(result.status, 'solved');
  assert.equal(result.depth, 3);
  assert.equal(hasNegative(result.tree), false);
});

test('a node alternative may replace the exclusion set without becoming worse', () => {
  const words = ['a', 'b', 'c', 'd', 'e'];
  const questions = [
    { id: 'balance', baseId: 'balance', type: 'bin', text: 'BC?', inverted: false, test: w => w === 'b' || w === 'c' },
    { id: 'pair', baseId: 'pair', type: 'bin', text: 'AB?', inverted: false, test: w => w === 'a' || w === 'b' },
    ...words.map(word => ({
      id: word, baseId: word, type: 'bin', text: `${word}?`, inverted: false, test: value => value === word,
    })),
  ];
  const options = { words, questions, maxNOs: 0, stopAt: 1, maxExclude: 1, maxVariants: 8 };
  const baseline = solvePrimary(options).variants[0];

  const pair = solveForcedAlternatives(options, { path: [], baseline })
    .find(item => item.question.id === 'pair');

  assert.ok(pair);
  assert.deepEqual(baseline.toExclude, ['a']);
  assert.deepEqual(pair.variant.toExclude, ['c']);
  assert.equal(pair.variant.depth, baseline.depth);
  assert.equal(pair.variant.validation.valid, true);
});
