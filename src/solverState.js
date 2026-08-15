export const INITIAL_SOLVER_STATE = Object.freeze({
  requestId: 0,
  status: 'idle',
  solution: null,
  advice: null,
  error: null,
});

export function beginSolverRequest(state, requestId) {
  return { requestId, status: 'optimizing', solution: state.solution, advice: null, error: null };
}

export function applySolverMessage(state, message) {
  if (message.requestId !== state.requestId) return state;
  if (message.type === 'primary') {
    return {
      ...state,
      status: message.solution.status,
      solution: message.solution,
      error: null,
    };
  }
  if (message.type === 'advice') return { ...state, advice: message.advice };
  if (message.type === 'error') {
    return { ...state, status: 'error', solution: null, advice: null, error: message.error };
  }
  return state;
}
