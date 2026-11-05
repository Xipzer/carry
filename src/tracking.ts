// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { isUnfinished, type Transfer } from './model';

export type TrackingStatus = { checking: boolean; checkedAt?: number; error?: string };

// Read-only monitoring. No wallet, signing or receiving action is invoked here.
export function trackTransfers(options: {
  rows: () => Transfer[]; available: () => boolean;
  check: (transfer: Transfer) => Promise<unknown>;
  status: (id: string, status: TrackingStatus) => void;
}) {
  let stopped = false, running = false, timer: ReturnType<typeof setTimeout> | undefined;
  const checked = new Map<string, number>(), failures = new Map<string, number>();
  function schedule(delay: number) { clearTimeout(timer); if (!stopped) timer = setTimeout(tick, delay); }
  async function tick() {
    if (stopped || running) return;
    if (!options.available()) { schedule(15000); return; }
    running = true;
    try {
      const pending = options.rows().filter(t => isUnfinished(t) && t.burnHash && !t.sourceFailed);
      for (const t of pending) {
        if (stopped || !options.available()) break;
        const interval = Math.min(120000, 15000 * 2 ** (failures.get(t.id) ?? 0));
        if (checked.has(t.id) && Date.now() - checked.get(t.id)! < interval) continue;
        options.status(t.id, { checking: true, checkedAt: checked.get(t.id) });
        try {
          await options.check(t);
          checked.set(t.id, Date.now()); failures.delete(t.id);
          if (!stopped) options.status(t.id, { checking: false, checkedAt: Date.now() });
        } catch {
          failures.set(t.id, Math.min(4, (failures.get(t.id) ?? 0) + 1));
          checked.set(t.id, Date.now());
          if (!stopped) options.status(t.id, { checking: false, error: 'Status connection interrupted. Retrying automatically.' });
        }
      }
    } finally { running = false; schedule(15000); }
  }
  return {
    wake() { if (stopped) return; checked.clear(); clearTimeout(timer); queueMicrotask(() => { void tick(); }); },
    stop() { stopped = true; clearTimeout(timer); },
  };
}
