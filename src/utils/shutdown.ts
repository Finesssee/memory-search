// Graceful shutdown handling with AbortController

let globalController = new AbortController();
let shutdownRequested = false;

export function getAbortSignal(): AbortSignal {
  return globalController.signal;
}

export function isShutdownRequested(): boolean {
  return shutdownRequested;
}

export function requestShutdown(): void {
  shutdownRequested = true;
  globalController.abort();
}

export function resetShutdown(): void {
  shutdownRequested = false;
  globalController = new AbortController();
}

export function installSigintHandler(): void {
  let sigintCount = 0;
  process.on('SIGINT', () => {
    sigintCount++;
    if (sigintCount === 1) {
      process.stderr.write('\nGracefully shutting down (press Ctrl+C again to force)...\n');
      requestShutdown();
    } else {
      process.stderr.write('\nForce exit.\n');
      process.exit(1);
    }
  });
}
