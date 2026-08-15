import { buildQuestionChoices } from './algo.js';

const bit = index => 1n << BigInt(index);

function countBits(mask) {
  let value = mask;
  let count = 0;
  while (value) {
    value &= value - 1n;
    count++;
  }
  return count;
}

function wordsForMask(words, mask) {
  const result = [];
  for (let i = 0; i < words.length; i++) {
    if (mask & bit(i)) result.push(words[i]);
  }
  return result;
}

function maxNegativeOnPath(node) {
  if (!node?.q) return 0;
  const childMax = Math.max(0, ...Object.values(node.ch || {}).map(maxNegativeOnPath));
  return childMax + (node.q.inverted ? 1 : 0);
}

function questionNodeCount(node) {
  if (!node?.q) return 0;
  return 1 + Object.values(node.ch || {}).reduce((total, child) => total + questionNodeCount(child), 0);
}

function modeTreeScore(tree, mode) {
  const sizes = Object.values(tree?.ch || {}).map(child => child.words?.length || 0);
  const total = Math.max(1, tree?.words?.length || 0);
  const largest = Math.max(0, ...sizes);
  const squares = sizes.reduce((sum, size) => sum + size * size, 0);
  if (mode === 'sniper') {
    const noSize = tree?.q?.type === 'bin' ? (tree.ch?.NO?.words?.length || 0) : 0;
    return [noSize / total, largest / total, squares];
  }
  return [largest / total, squares, tree?.q?.type === 'cup' ? 0 : 1];
}

function compareTrees(a, b, mode) {
  const aQuality = getTreeQuality(a, { mode });
  const bQuality = getTreeQuality(b, { mode });
  const aObjective = [aQuality.negativeTier, aQuality.negativeTier > 1 ? aQuality.negativeCount : 0, aQuality.depth, aQuality.questionNodes];
  const bObjective = [bQuality.negativeTier, bQuality.negativeTier > 1 ? bQuality.negativeCount : 0, bQuality.depth, bQuality.questionNodes];
  for (let i = 0; i < aObjective.length; i++) {
    if (aObjective[i] !== bObjective[i]) return aObjective[i] - bObjective[i];
  }
  const aScore = modeTreeScore(a, mode);
  const bScore = modeTreeScore(b, mode);
  for (let i = 0; i < aScore.length; i++) {
    if (aScore[i] !== bScore[i]) return aScore[i] - bScore[i];
  }
  return (a?.q?.id || '').localeCompare(b?.q?.id || '');
}

export function getTreeQuality(tree, { mode = '5050' } = {}) {
  const negativeCount = maxNegativeOnPath(tree);
  const validation = validateTree(tree, { maxNOs: 0, stopAt: Number.MAX_SAFE_INTEGER });
  return {
    negativeTier: negativeCount === 0 ? 0 : negativeCount === 1 ? 1 : 2,
    negativeCount,
    depth: validation.maxDepth,
    questionNodes: questionNodeCount(tree),
    modeScore: modeTreeScore(tree, mode),
  };
}

const pathKey = path => path.join('\u001f');

function nodeAtPath(tree, path) {
  return path.reduce((node, key) => node?.ch?.[key], tree);
}

function pathStartsWith(path, prefix) {
  return prefix.length <= path.length && prefix.every((key, index) => path[index] === key);
}

function hasLeafCapacity(wordCount, stopAt, maxArity, depthLeft) {
  let capacity = stopAt;
  for (let depth = 0; depth < depthLeft && capacity < wordCount; depth++) {
    capacity *= maxArity;
  }
  return capacity >= wordCount;
}

function publicQuestion(q, groups) {
  const meta = q.type === 'bin'
    ? {
        yes: countBits(groups.find(group => group.key === 'YES').mask),
        no: countBits(groups.find(group => group.key === 'NO').mask),
      }
    : {
        cups: groups.map(group => group.key),
        dist: groups.map(group => countBits(group.mask)),
      };
  return {
    id: q.id,
    baseId: q.baseId,
    type: q.type,
    text: q.text,
    inverted: !!q.inverted,
    meta,
  };
}

function prepareQuestions(words, choices) {
  const fullMask = words.reduce((mask, _word, index) => mask | bit(index), 0n);
  return choices.map(q => {
    if (q.type === 'bin') {
      let yesMask = 0n;
      words.forEach((word, index) => {
        if (q.test(word)) yesMask |= bit(index);
      });
      return {
        q,
        groups: [
          { key: 'YES', mask: yesMask, noDelta: 0 },
          { key: 'NO', mask: fullMask ^ yesMask, noDelta: 1 },
        ],
      };
    }
    const groups = new Map();
    words.forEach((word, index) => {
      const key = String(q.grp(word));
      groups.set(key, (groups.get(key) || 0n) | bit(index));
    });
    return {
      q,
      groups: [...groups.entries()].map(([key, mask]) => ({ key, mask, noDelta: 0 })),
    };
  });
}

// Words with the same complete answer signature can never be separated by any
// tree built from these questions. This is a hard impossibility proof.
function indistinguishableGroups(words, prepared) {
  const groups = new Map();
  words.forEach((word, index) => {
    const signature = prepared.map(({ groups: buckets }) => {
      const bitMask = bit(index);
      return buckets.find(bucket => bucket.mask & bitMask)?.key || '';
    }).join('|');
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(word);
  });
  return [...groups.values()].filter(group => group.length > 1);
}

function collisionLowerBound(words, choices) {
  return indistinguishableGroups(words, prepareQuestions(words, choices))
    .reduce((total, group) => total + group.length - 1, 0);
}

export function getCollisionAdvice(words, { allowed, customQs } = {}) {
  const choices = buildQuestionChoices(words, allowed, customQs, false);
  const groups = indistinguishableGroups(words, prepareQuestions(words, choices));
  return { groups, required: groups.reduce((n, group) => n + group.length - 1, 0) };
}

function candidateScore(candidate, mode) {
  const sizes = candidate.groups.map(group => countBits(group.mask));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const largest = Math.max(...sizes);
  const squares = sizes.reduce((sum, size) => sum + size * size, 0);
  if (mode === 'sniper') {
    const noSize = candidate.q.type === 'bin'
      ? countBits(candidate.groups.find(group => group.key === 'NO').mask)
      : 0;
    return [noSize / total, largest / total, squares];
  }
  return [largest / total, squares, candidate.q.type === 'cup' ? 0 : 1];
}

function compareCandidates(a, b, mode) {
  if (!!a.q.inverted !== !!b.q.inverted) return a.q.inverted ? 1 : -1;
  const aScore = candidateScore(a, mode);
  const bScore = candidateScore(b, mode);
  for (let i = 0; i < aScore.length; i++) {
    if (aScore[i] !== bScore[i]) return aScore[i] - bScore[i];
  }
  return a.q.id.localeCompare(b.q.id);
}

function solveAtDepth(words, prepared, options, depthLimit) {
  const { maxNOs, stopAt, mode, initialNOs } = options;
  const deadline = options.deadlineAt || (options.deadlineMs ? Date.now() + options.deadlineMs : 0);
  const fullMask = words.reduce((mask, _word, index) => mask | bit(index), 0n);
  const failed = new Set();
  const maxArity = Math.max(1, ...prepared.map(question => question.groups.length));
  const forcedQuestions = options.forcedQuestions || [];
  const forcedByPath = new Map(forcedQuestions.map(force => [pathKey(force.path), force.questionId]));
  const negativeLimit = options.negativeLimit ?? Infinity;

  function search(mask, noUsed, depthLeft, path = [], negativeUsed = 0) {
    if (deadline && Date.now() > deadline) throw new Error('Optimization timed out. Try fewer words or enable exclusions.');
    const wordCount = countBits(mask);
    if (wordCount <= stopAt) {
      if (forcedQuestions.some(force => pathStartsWith(force.path, path))) return null;
      return { words: wordsForMask(words, mask), q: null, ch: {} };
    }
    if (depthLeft === 0 || !hasLeafCapacity(wordCount, stopAt, maxArity, depthLeft)) return null;
    const memoKey = `${mask}:${noUsed}:${depthLeft}:${negativeUsed}:${pathKey(path)}`;
    if (failed.has(memoKey)) return null;

    const seenPartitions = new Set();
    const candidates = [];
    const rootVariants = [];
    const rootVariantLimit = options.maxRootCandidates || 64;
    const requiredQuestionId = forcedByPath.get(pathKey(path));
    for (const preparedQuestion of prepared) {
      if (requiredQuestionId && preparedQuestion.q.id !== requiredQuestionId) continue;
      if (preparedQuestion.q.type === 'bin' && maxNOs > 0 && noUsed >= maxNOs) continue;
      const groups = preparedQuestion.groups
        .map(group => ({ ...group, mask: group.mask & mask }))
        .filter(group => group.mask !== 0n);
      if (groups.length < 2) continue;
      const signature = preparedQuestion.q.type === 'bin'
        ? groups.map(group => `${group.key}:${group.mask}`).join('|')
        : `cup:${groups.map(group => String(group.mask)).sort().join('|')}`;
      candidates.push({ q: preparedQuestion.q, groups, signature });
    }
    candidates.sort((a, b) => compareCandidates(a, b, mode));
    const uniqueCandidates = candidates.filter(candidate => {
      if (seenPartitions.has(candidate.signature)) return false;
      seenPartitions.add(candidate.signature);
      return true;
    });

    candidateLoop:
    for (const candidate of uniqueCandidates) {
      const nextNegativeUsed = negativeUsed + (candidate.q.inverted ? 1 : 0);
      if (nextNegativeUsed > negativeLimit) continue;
      const ch = {};
      for (const group of candidate.groups) {
        const nextNOs = noUsed + group.noDelta;
        if (maxNOs > 0 && nextNOs > maxNOs) continue candidateLoop;
        const child = search(group.mask, nextNOs, depthLeft - 1, [...path, group.key], nextNegativeUsed);
        if (!child) continue candidateLoop;
        ch[group.key] = child;
      }
      const displayed = publicQuestion(candidate.q, candidate.groups);
      const result = {
        words: wordsForMask(words, mask),
        q: displayed,
        ch,
      };
      if (mask === fullMask && depthLeft === depthLimit) {
        rootVariants.push(result);
        if (rootVariants.length < rootVariantLimit) continue;
      }
      result.rootVariants = rootVariants;
      return result;
    }

    if (rootVariants.length) {
      rootVariants[0].rootVariants = rootVariants;
      return rootVariants[0];
    }
    failed.add(memoKey);
    return null;
  }

  return search(fullMask, initialNOs, depthLimit, [], 0);
}

export function validateTree(tree, { maxNOs, stopAt, initialNOs = 0 }) {
  const errors = [];
  let maxDepth = 0;
  let maxNOsUsed = initialNOs;
  let maxLeafSize = 0;

  function walk(node, depth, noUsed) {
    maxDepth = Math.max(maxDepth, depth);
    maxNOsUsed = Math.max(maxNOsUsed, noUsed);
    const children = Object.entries(node?.ch || {});
    if (!node?.q || children.length === 0) {
      maxLeafSize = Math.max(maxLeafSize, node?.words?.length || 0);
      if ((node?.words?.length || 0) > stopAt) errors.push(`leaf:${node.words.length}>${stopAt}`);
      return;
    }
    for (const [key, child] of children) {
      const nextNOs = noUsed + (node.q.type === 'bin' && key === 'NO' ? 1 : 0);
      if (maxNOs > 0 && nextNOs > maxNOs) errors.push(`nos:${nextNOs}>${maxNOs}`);
      walk(child, depth + 1, nextNOs);
    }
  }

  walk(tree, 0, initialNOs);
  return { valid: errors.length === 0, maxDepth, maxNOsUsed, maxLeafSize, errors };
}

export function solveTree(words, rawOptions = {}) {
  const options = {
    mode: '5050',
    maxNOs: 0,
    stopAt: 1,
    allowed: undefined,
    customQs: [],
    questions: null,
    initialNOs: 0,
    maxVariants: 8,
    maxRootCandidates: 64,
    forcedQuestions: [],
    ...rawOptions,
  };
  if (!words.length) {
    const tree = { words: [], q: null, ch: {} };
    const validation = validateTree(tree, options);
    return { status: 'solved', tree, trees: [tree], depth: 0, validation };
  }
  const choices = options.questions || buildQuestionChoices(words, options.allowed, options.customQs, options.allowNegative ?? true);
  const rawPrepared = prepareQuestions(words, choices);
  const seenPrepared = new Set();
  const prepared = rawPrepared.filter(question => {
    const signature = `${question.q.type}:${question.groups.map(group => `${group.key}:${group.mask}`).join('|')}`;
    if (seenPrepared.has(signature)) return false;
    seenPrepared.add(signature);
    return true;
  });
  if (indistinguishableGroups(words, prepared).length) {
    return { status: 'impossible', tree: null, trees: [], depth: null, validation: null };
  }
  const maximumDepth = Math.max(0, new Set(choices.map(q => q.baseId || q.id)).size);
  const invertedById = new Map(choices.map(q => [q.id, !!q.inverted]));
  const forcedMinimum = options.forcedQuestions.reduce((count, force) =>
    count + (invertedById.get(force.questionId) ? 1 : 0), 0);
  const maximumNegatives = Math.max(forcedMinimum, new Set(choices.filter(q => q.inverted).map(q => q.baseId || q.id)).size);
  const requiredQuality = options.requiredQuality;
  const negativeLimits = requiredQuality
    ? [requiredQuality.negativeCount]
    : Array.from({ length: maximumNegatives - forcedMinimum + 1 }, (_value, index) => forcedMinimum + index);
  const depths = requiredQuality
    ? [requiredQuality.depth]
    : Array.from({ length: maximumDepth + 1 }, (_value, index) => index);
  for (const negativeLimit of negativeLimits) {
    if (negativeLimit < forcedMinimum || negativeLimit > maximumNegatives) continue;
    for (const depth of depths) {
      const tree = solveAtDepth(words, prepared, { ...options, negativeLimit }, depth);
      if (!tree) continue;
      const validation = validateTree(tree, options);
      if (!validation.valid) throw new Error(`solver produced invalid tree: ${validation.errors.join(', ')}`);
      const candidates = (tree.rootVariants || [tree]).map(candidate => {
        if (!Object.hasOwn(candidate, 'rootVariants')) return candidate;
        const { rootVariants: _variants, ...serializableTree } = candidate;
        return serializableTree;
      });
      const negativeTrees = candidates.filter(candidate => maxNegativeOnPath(candidate) === negativeLimit);
      if (!negativeTrees.length) continue;
      const fewestNodes = Math.min(...negativeTrees.map(questionNodeCount));
      const trees = negativeTrees.filter(candidate => questionNodeCount(candidate) === fewestNodes)
        .sort((a, b) => compareTrees(a, b, options.mode))
        .slice(0, options.maxVariants || 8);
      const qualityTrees = requiredQuality
        ? trees.filter(candidate => questionNodeCount(candidate) === requiredQuality.questionNodes)
        : trees;
      const forcedValid = qualityTrees.filter(candidate => options.forcedQuestions.every(force =>
        nodeAtPath(candidate, force.path)?.q?.id === force.questionId));
      if (!forcedValid.length) continue;
      const actualDepth = validateTree(forcedValid[0], options).maxDepth;
      if (requiredQuality && actualDepth !== requiredQuality.depth) continue;
      return { status: 'solved', tree: forcedValid[0], trees: forcedValid, depth: actualDepth, validation };
    }
  }
  return { status: 'impossible', tree: null, trees: [], depth: null, validation: null };
}

function* combinations(items, size, start = 0, current = []) {
  if (current.length === size) {
    yield [...current];
    return;
  }
  for (let index = start; index <= items.length - (size - current.length); index++) {
    current.push(items[index]);
    yield* combinations(items, size, index + 1, current);
    current.pop();
  }
}

function solveExactExclusions(options, count) {
  const clamped = Math.max(0, Math.min(count, Math.max(0, options.words.length - 1)));
  const questions = options.questions
    || buildQuestionChoices(options.words, options.allowed, options.customQs, options.allowNegative ?? true);
  if (clamped < collisionLowerBound(options.words, questions)) return [];
  const winners = [];
  let bestDepth = Infinity;
  let bestQuestionNodes = Infinity;
  for (const excluded of combinations(options.words, clamped)) {
    const excludedSet = new Set(excluded);
    const remaining = options.words.filter(word => !excludedSet.has(word));
    const result = solveTree(remaining, { ...options, questions });
    if (result.status !== 'solved') continue;
    if (result.depth < bestDepth) {
      bestDepth = result.depth;
      bestQuestionNodes = Infinity;
      winners.length = 0;
    }
    if (result.depth !== bestDepth) continue;
    const questionNodes = Math.min(...(result.trees || [result.tree]).map(questionNodeCount));
    if (questionNodes < bestQuestionNodes) {
      bestQuestionNodes = questionNodes;
      winners.length = 0;
    }
    if (questionNodes === bestQuestionNodes) winners.push({ excluded, result });
  }
  winners.sort((a, b) => a.excluded.join('\u0000').localeCompare(b.excluded.join('\u0000')));
  return winners.flatMap(({ excluded, result }) => (result.trees || [result.tree]).map(tree => ({
    toExclude: excluded, tree, depth: result.depth, questionNodes: questionNodeCount(tree), validation: result.validation,
  }))).slice(0, options.maxVariants);
}

export function solvePrimary(rawOptions) {
  const options = {
    words: [],
    mode: '5050',
    maxNOs: 0,
    stopAt: 1,
    maxExclude: 0,
    customQs: [],
    maxVariants: 8,
    suggestionDepth: 5,
    maxSuggestionExclude: 10,
    ...rawOptions,
  };
  const variants = solveExactExclusions(options, options.maxExclude);
  if (!variants.length) {
    return {
      status: 'impossible', variants: [], tree: null, depth: null,
      excluded: [], validation: null,
    };
  }
  const first = variants[0];
  return {
    status: 'solved',
    variants,
    tree: first.tree,
    depth: first.depth,
    excluded: first.toExclude,
    validation: first.validation,
  };
}

function qualityOfVariant(variant) {
  const negativeCount = maxNegativeOnPath(variant.tree);
  return {
    depth: variant.depth,
    questionNodes: variant.questionNodes ?? questionNodeCount(variant.tree),
    negativeTier: negativeCount === 0 ? 0 : negativeCount === 1 ? 1 : 2,
    negativeCount,
  };
}

function sameQuality(a, b) {
  const aq = qualityOfVariant(a);
  const bq = qualityOfVariant(b);
  return aq.depth === bq.depth
    && aq.questionNodes === bq.questionNodes
    && aq.negativeTier === bq.negativeTier
    && (aq.negativeTier < 2 || aq.negativeCount === bq.negativeCount);
}

function questionSplitsWords(question, words) {
  if (question.type === 'bin') {
    const yes = words.filter(question.test).length;
    return yes > 0 && yes < words.length;
  }
  return new Set(words.map(question.grp)).size > 1;
}

// Re-solves the complete tree for every viable replacement at one displayed
// node. Ancestor questions are pinned so the selected node keeps its meaning;
// exclusions and all descendants are free to change.
export function solveForcedAlternatives(rawOptions, { path = [], baseline } = {}) {
  if (!baseline?.tree) return [];
  const target = nodeAtPath(baseline.tree, path);
  if (!target?.q || !target.words?.length) return [];
  const options = {
    words: [], maxExclude: baseline.toExclude?.length || 0, maxVariants: 8,
    ...rawOptions,
  };
  const questions = options.questions
    || buildQuestionChoices(options.words, options.allowed, options.customQs, options.allowNegative ?? true);
  const ancestors = [];
  let potentialTargetWords = [...options.words];
  for (let depth = 0; depth < path.length; depth++) {
    const ancestorPath = path.slice(0, depth);
    const ancestor = nodeAtPath(baseline.tree, ancestorPath);
    if (!ancestor?.q) return [];
    ancestors.push({ path: ancestorPath, questionId: ancestor.q.id });
    const question = questions.find(item => item.id === ancestor.q.id);
    if (!question) return [];
    potentialTargetWords = potentialTargetWords.filter(word => question.type === 'bin'
      ? (question.test(word) ? 'YES' : 'NO') === path[depth]
      : String(question.grp(word)) === path[depth]);
  }
  const results = [];
  const questionGroups = new Map();
  for (const question of questions) {
    if (!questionSplitsWords(question, potentialTargetWords)) continue;
    const answers = potentialTargetWords.map(word => question.type === 'bin'
      ? (question.test(word) ? 'YES' : 'NO')
      : String(question.grp(word)));
    const signature = `${question.type}:${question.inverted ? 1 : 0}:${answers.join('\u001f')}`;
    if (!questionGroups.has(signature)) questionGroups.set(signature, []);
    if (!questionGroups.get(signature).some(item => item.id === question.id)) questionGroups.get(signature).push(question);
  }
  const baselineQuality = qualityOfVariant(baseline);
  for (const equivalentQuestions of questionGroups.values()) {
    const representative = equivalentQuestions[0];
    const forcedQuestions = [...ancestors, { path, questionId: representative.id }];
    const solution = solvePrimary({
      ...options, questions, forcedQuestions,
      requiredQuality: baselineQuality,
    });
    if (solution.status !== 'solved') continue;
    const variant = solution.variants.find(candidate =>
      nodeAtPath(candidate.tree, path)?.q?.id === representative.id && sameQuality(candidate, baseline));
    if (!variant) continue;
    for (const question of equivalentQuestions) {
      const questionVariant = structuredClone(variant);
      const variantTarget = nodeAtPath(questionVariant.tree, path);
      const preparedQuestion = prepareQuestions(variantTarget.words, [question])[0];
      variantTarget.q = publicQuestion(question, preparedQuestion.groups);
      results.push({ question: variantTarget.q, variant: questionVariant });
    }
  }
  return results.sort((a, b) => {
    if (a.question.id === target.q.id) return -1;
    if (b.question.id === target.q.id) return 1;
    return a.question.text.localeCompare(b.question.text);
  });
}

export function solveAdvice(rawOptions, primary) {
  const options = {
    words: [],
    maxExclude: 0,
    maxVariants: 8,
    suggestionDepth: 5,
    maxSuggestionExclude: 10,
    ...rawOptions,
  };
  if (options.maxExclude > 0 || options.words.length <= 1) return null;
  const limit = Math.min(options.maxSuggestionExclude, options.words.length - 1);
  const kind = primary.status === 'solved' ? 'suggested' : 'required';
  if (kind === 'suggested' && primary.depth <= options.suggestionDepth) return null;

  const adviceOptions = { ...options, mode: '5050' };
  const questions = options.questions || buildQuestionChoices(options.words, options.allowed, options.customQs, options.allowNegative ?? true);
  const firstPossibleCount = Math.max(1, collisionLowerBound(options.words, questions));
  for (let count = firstPossibleCount; count <= limit; count++) {
    const variants = solveExactExclusions(adviceOptions, count);
    if (!variants.length) continue;
    if (kind === 'suggested' && variants[0].depth > options.suggestionDepth) continue;
    return { kind, count, variants };
  }
  return null;
}

export function solveRequest(options) {
  const primary = solvePrimary(options);
  return { primary, advice: solveAdvice(options, primary) };
}
