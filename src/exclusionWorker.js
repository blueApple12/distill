import { solvePrimary, solveAdvice } from './solver.js';

self.addEventListener('message', event => {
  const { requestId, options } = event.data;
  try {
    const solution = solvePrimary(options);
    self.postMessage({ requestId, type: 'primary', solution });
    const advice = solveAdvice(options, solution);
    self.postMessage({ requestId, type: 'advice', advice });
  } catch (error) {
    self.postMessage({
      requestId,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
