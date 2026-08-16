import test from 'node:test';
import assert from 'node:assert/strict';

import {
  solveTree, solvePrimary, solveAdvice, solveForcedAlternatives, validateTree, getTreeQuality,
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

test('composes two independent node overrides instead of reverting one when picking the other', () => {
  const words = ['a', 'b', 'c', 'd'];
  const questions = [
    { id: 'root', baseId: 'root', type: 'bin', text: 'Root?', inverted: false, test: w => w === 'a' || w === 'b' },
    { id: 'left-1', baseId: 'left-1', type: 'bin', text: 'Left 1?', inverted: false, test: w => w === 'a' },
    { id: 'left-2', baseId: 'left-2', type: 'bin', text: 'Left 2?', inverted: false, test: w => w === 'a' },
    { id: 'right-1', baseId: 'right-1', type: 'bin', text: 'Right 1?', inverted: false, test: w => w === 'c' },
    { id: 'right-2', baseId: 'right-2', type: 'bin', text: 'Right 2?', inverted: false, test: w => w === 'c' },
  ];
  const options = { words, questions, maxNOs: 0, stopAt: 1, maxExclude: 0 };
  const baseline = solvePrimary(options).variants[0];
  const baselineYesId = baseline.tree.ch.YES.q.id;
  const baselineNoId = baseline.tree.ch.NO.q.id;

  const yesAlt = solveForcedAlternatives(options, { path: ['YES'], baseline })
    .find(item => item.question.id !== baselineYesId);
  assert.ok(yesAlt);
  const afterYes = yesAlt.variant;
  assert.notEqual(afterYes.tree.ch.YES.q.id, baselineYesId);
  assert.equal(afterYes.tree.ch.NO.q.id, baselineNoId);

  // Re-solving a second, unrelated node must not silently revert the first
  // override — the two picks should compose.
  const noAlt = solveForcedAlternatives(options, { path: ['NO'], baseline: afterYes })
    .find(item => item.question.id !== baselineNoId);
  assert.ok(noAlt);
  const afterBoth = noAlt.variant;
  assert.notEqual(afterBoth.tree.ch.NO.q.id, baselineNoId);
  assert.equal(afterBoth.tree.ch.YES.q.id, afterYes.tree.ch.YES.q.id);
});

test('preloads node-level alternatives into solvePrimary without a dropdown interaction', () => {
  const words = ['a', 'b', 'c', 'd'];
  const questions = [
    { id: 'root', baseId: 'root', type: 'bin', text: 'Root?', inverted: false, test: w => w === 'a' || w === 'b' },
    { id: 'left-1', baseId: 'left-1', type: 'bin', text: 'Left 1?', inverted: false, test: w => w === 'a' },
    { id: 'left-2', baseId: 'left-2', type: 'bin', text: 'Left 2?', inverted: false, test: w => w === 'a' },
    { id: 'right-1', baseId: 'right-1', type: 'bin', text: 'Right 1?', inverted: false, test: w => w === 'c' },
  ];
  const started = Date.now();
  const primary = solvePrimary({ words, questions, maxNOs: 0, stopAt: 1, maxExclude: 0 });
  const elapsed = Date.now() - started;

  assert.equal(primary.status, 'solved');
  assert.ok(elapsed < 1000, `expected preload to stay within budget, took ${elapsed}ms`);
  assert.ok(primary.variants.length >= 2, 'expected the YES-branch tie to already be preloaded');
  const yesIds = new Set(primary.variants.map(v => v.tree.ch.YES.q.id));
  assert.ok(yesIds.has('left-1') && yesIds.has('left-2'));
  for (const variant of primary.variants) {
    assert.equal(variant.tree.q.id, 'root');
    assert.equal(variant.tree.ch.NO.q.id, 'right-1');
    assert.equal(variant.depth, primary.depth);
  }
});

test('hybrid mode resolves the first question like balanced', () => {
  const words = ['a', 'b', 'c', 'd', 'e'];
  const questions = [
    // 3/2 split — the more even option, best under 5050 scoring.
    { id: 'root-balanced', baseId: 'root-balanced', type: 'bin', text: 'Balanced?', inverted: false, test: w => w === 'a' || w === 'b' || w === 'c' },
    // 4/1 split — the smaller-NO-branch option, best under sniper scoring.
    { id: 'root-yesheavy', baseId: 'root-yesheavy', type: 'bin', text: 'Yes heavy?', inverted: false, test: w => w === 'a' || w === 'b' || w === 'c' || w === 'd' },
    // Distinguish a/b/c from each other so they aren't a hard collision —
    // both dominated by the two options above under every mode.
    { id: 'q-a', baseId: 'q-a', type: 'bin', text: 'A?', inverted: false, test: w => w === 'a' },
    { id: 'q-b', baseId: 'q-b', type: 'bin', text: 'B?', inverted: false, test: w => w === 'b' },
  ];
  const base = { words, questions, maxNOs: 0, stopAt: 4 };
  const balanced = solveTree(words, { ...base, mode: '5050' });
  const sniper = solveTree(words, { ...base, mode: 'sniper' });
  const hybrid = solveTree(words, { ...base, mode: 'hybrid' });

  assert.equal(balanced.tree.q.id, 'root-balanced');
  assert.equal(sniper.tree.q.id, 'root-yesheavy');
  assert.equal(hybrid.tree.q.id, balanced.tree.q.id, 'hybrid should pick the balanced root, like 5050');
});

test('hybrid mode resolves the second question onward like precision', () => {
  const words = ['a', 'b', 'c', 'd', 'e', 'f'];
  const questions = [
    { id: 'root', baseId: 'root', type: 'bin', text: 'Root?', inverted: false, test: w => w === 'a' },
    // Under the 5-word NO branch: 3/2 split, best under 5050 scoring.
    { id: 'sub-balanced', baseId: 'sub-balanced', type: 'bin', text: 'Sub balanced?', inverted: false, test: w => w === 'b' || w === 'c' || w === 'd' },
    // Under the 5-word NO branch: 4/1 split, best under sniper scoring.
    { id: 'sub-yesheavy', baseId: 'sub-yesheavy', type: 'bin', text: 'Sub yes heavy?', inverted: false, test: w => w === 'b' || w === 'c' || w === 'd' || w === 'e' },
    { id: 'q-b', baseId: 'q-b', type: 'bin', text: 'B?', inverted: false, test: w => w === 'b' },
    { id: 'q-c', baseId: 'q-c', type: 'bin', text: 'C?', inverted: false, test: w => w === 'c' },
  ];
  const base = { words, questions, maxNOs: 0, stopAt: 4, forcedQuestions: [{ path: [], questionId: 'root' }] };
  const balanced = solveTree(words, { ...base, mode: '5050' });
  const sniper = solveTree(words, { ...base, mode: 'sniper' });
  const hybrid = solveTree(words, { ...base, mode: 'hybrid' });

  assert.equal(balanced.tree.ch.NO.q.id, 'sub-balanced');
  assert.equal(sniper.tree.ch.NO.q.id, 'sub-yesheavy');
  assert.equal(hybrid.tree.ch.NO.q.id, sniper.tree.ch.NO.q.id, 'hybrid should pick the yes-heavy split, like sniper, past the first question');
});

test('ranks fewer total question nodes ahead of mode tie-breaks', () => {
  const leaf = words => ({ words, q: null, ch: {} });
  const question = id => ({ id, baseId: id, type: 'bin', inverted: false });
  const cupQuestion = id => ({ id, baseId: id, type: 'cup', inverted: false });
  const compact = {
    words: ['a', 'b', 'c', 'd'], q: cupQuestion('compact'), ch: {
      A: leaf(['a']), B: leaf(['b']), REST: { words: ['c', 'd'], q: question('compact-child'), ch: { YES: leaf(['c']), NO: leaf(['d']) } },
    },
  };
  const larger = {
    words: ['a', 'b', 'c', 'd'], q: question('larger'), ch: {
      YES: { words: ['a', 'b'], q: question('larger-child'), ch: { YES: leaf(['a']), NO: leaf(['b']) } },
      NO: { words: ['c', 'd'], q: question('larger-child-2'), ch: { YES: leaf(['c']), NO: leaf(['d']) } },
    },
  };

  const compactQuality = getTreeQuality(compact, { mode: '5050' });
  const largerQuality = getTreeQuality(larger, { mode: '5050' });
  assert.equal(compactQuality.depth, largerQuality.depth);
  assert.ok(compactQuality.questionNodes < largerQuality.questionNodes);
  assert.deepEqual(
    [compactQuality.negativeTier, compactQuality.negativeCount, compactQuality.depth, compactQuality.questionNodes],
    [0, 0, 2, 2],
  );
  assert.deepEqual(
    [largerQuality.negativeTier, largerQuality.negativeCount, largerQuality.depth, largerQuality.questionNodes],
    [0, 0, 2, 3],
  );
});
