/**
 * In-process background jobs. The interface is deliberately small so an external worker
 * (BullMQ, a separate process) can replace it later without touching callers.
 */
export interface JobQueue {
  /** Register a handler for a job type. */
  register<T = unknown>(type: string, handler: (payload: T) => Promise<void>): void;
  /** Enqueue a job; runs asynchronously, retried with backoff on failure. */
  enqueue<T = unknown>(type: string, payload: T, opts?: { delayMs?: number; maxAttempts?: number }): void;
  /** Run `fn` every `intervalMs` (not overlapping itself). */
  every(name: string, intervalMs: number, fn: () => Promise<void>): void;
  /** Stop timers and wait for running jobs. */
  stop(): Promise<void>;
  /** Resolves when no job is pending or running (useful in tests). */
  idle(): Promise<void>;
}

interface Log { error(obj: unknown, msg?: string): void }

export function createInProcessQueue(logger: Log = console): JobQueue {
  const handlers = new Map<string, (p: any) => Promise<void>>();
  const timers = new Set<NodeJS.Timeout>();
  const running = new Set<Promise<void>>();
  let stopped = false;

  const track = (p: Promise<void>) => {
    running.add(p);
    void p.finally(() => running.delete(p));
  };

  function run(type: string, payload: unknown, attempt: number, maxAttempts: number): void {
    const handler = handlers.get(type);
    if (!handler || stopped) return;
    track((async () => {
      try {
        await handler(payload);
      } catch (err) {
        logger.error({ err, type, attempt }, 'job failed');
        if (attempt < maxAttempts && !stopped) schedule(type, payload, 2 ** attempt * 1000, attempt + 1, maxAttempts);
      }
    })());
  }

  function schedule(type: string, payload: unknown, delayMs: number, attempt: number, maxAttempts: number): void {
    if (delayMs <= 0) return run(type, payload, attempt, maxAttempts);
    const t = setTimeout(() => { timers.delete(t); run(type, payload, attempt, maxAttempts); }, delayMs);
    t.unref();
    timers.add(t);
  }

  return {
    register: (type, handler) => { handlers.set(type, handler); },
    enqueue: (type, payload, opts = {}) => {
      if (!handlers.has(type)) throw new Error(`No handler registered for job "${type}"`);
      schedule(type, payload, opts.delayMs ?? 0, 1, opts.maxAttempts ?? 3);
    },
    every(name, intervalMs, fn) {
      let busy = false;
      const t = setInterval(() => {
        if (busy || stopped) return;
        busy = true;
        track(fn().catch((err) => logger.error({ err, name }, 'periodic job failed')).finally(() => { busy = false; }));
      }, intervalMs);
      t.unref();
      timers.add(t);
    },
    async stop() {
      stopped = true;
      for (const t of timers) { clearTimeout(t); clearInterval(t); }
      timers.clear();
      await Promise.allSettled([...running]);
    },
    async idle() {
      while (running.size) await Promise.allSettled([...running]);
    },
  };
}
