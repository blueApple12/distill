import { solveForcedAlternatives } from './solver.js';

self.addEventListener('message', event => {
  const { requestId, options, path, baseline } = event.data;
  try {
    const alternatives = solveForcedAlternatives(options, { path, baseline });
    self.postMessage({ requestId, type: 'alternatives', alternatives });
  } catch (error) {
    self.postMessage({
      requestId,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
