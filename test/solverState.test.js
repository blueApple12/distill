import test from 'node:test';
import assert from 'node:assert/strict';

import { INITIAL_SOLVER_STATE, beginSolverRequest, applySolverMessage } from '../src/solverState.js';

test('keeps the last solved tree visible while a new request runs', () => {
  const old = { ...INITIAL_SOLVER_STATE, requestId: 1, status: 'solved', solution: { depth: 3 } };
  assert.deepEqual(beginSolverRequest(old, 2), {
    requestId: 2, status: 'optimizing', solution: { depth: 3 }, advice: null, error: null,
  });
});

test('ignores stale primary and advice messages', () => {
  const current = beginSolverRequest(INITIAL_SOLVER_STATE, 5);
  assert.equal(applySolverMessage(current, { requestId: 4, type: 'primary', solution: { depth: 9 } }), current);
  assert.equal(applySolverMessage(current, { requestId: 4, type: 'advice', advice: { count: 2 } }), current);
});

test('merges matching primary and advice messages', () => {
  let state = beginSolverRequest(INITIAL_SOLVER_STATE, 5);
  state = applySolverMessage(state, { requestId: 5, type: 'primary', solution: { status: 'solved', depth: 7 } });
  assert.equal(state.status, 'solved');
  assert.equal(state.solution.depth, 7);
  state = applySolverMessage(state, { requestId: 5, type: 'advice', advice: { kind: 'suggested', count: 2 } });
  assert.equal(state.advice.count, 2);
});
