// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackTransfers } from '../src/tracking';
import { baseTransfer } from './fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe('automatic read-only transfer tracking', () => {
  it('does not start a discarded mount check that could lock out the replacement tracker', async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const options = { rows: () => [baseTransfer()], available: () => true, check, status: vi.fn() };
    const discarded = trackTransfers(options); discarded.wake(); discarded.stop();
    const active = trackTransfers(options); active.wake(); await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1); active.stop();
  });
  it('checks every pending transfer immediately without a wallet and stops checking completed rows', async () => {
    const rows = [baseTransfer(), { ...baseTransfer(), id: 'second' }];
    const check = vi.fn(async t => { t.phase = 'complete'; });
    const tracker = trackTransfers({ rows: () => rows, available: () => true, check, status: vi.fn() });
    tracker.wake(); await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000); expect(check).toHaveBeenCalledTimes(2); tracker.stop();
  });
  it('does not overlap checks even when wake events arrive during a slow response', async () => {
    let release!: () => void;
    const check = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const tracker = trackTransfers({ rows: () => [baseTransfer()], available: () => true, check, status: vi.fn() });
    tracker.wake(); tracker.wake(); await vi.advanceTimersByTimeAsync(60000);
    expect(check).toHaveBeenCalledTimes(1); release(); await vi.advanceTimersByTimeAsync(0); tracker.stop();
  });
  it('backs off a failed service, exposes retries and recovers without a button', async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error('429')).mockResolvedValue(undefined), status = vi.fn();
    const tracker = trackTransfers({ rows: () => [baseTransfer()], available: () => true, check, status });
    tracker.wake(); await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenLastCalledWith('test-transfer', expect.objectContaining({ error: expect.stringContaining('Retrying automatically') }));
    await vi.advanceTimersByTimeAsync(15000); expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000); expect(check).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenLastCalledWith('test-transfer', { checking: false, checkedAt: Date.now() }); tracker.stop();
  });
  it('pauses offline, hidden or signing and wakes immediately when available', async () => {
    let available = false;
    const check = vi.fn().mockResolvedValue(undefined);
    const tracker = trackTransfers({ rows: () => [baseTransfer()], available: () => available, check, status: vi.fn() });
    tracker.wake(); await vi.advanceTimersByTimeAsync(60000); expect(check).not.toHaveBeenCalled();
    available = true; tracker.wake(); await vi.advanceTimersByTimeAsync(0); expect(check).toHaveBeenCalledTimes(1); tracker.stop();
  });
  it('never monitors unsubmitted, cancelled or reverted source transfers', async () => {
    const rows = [{ ...baseTransfer(), burnHash: undefined }, { ...baseTransfer(), phase: 'cancelled' as const }, { ...baseTransfer(), sourceFailed: true }];
    const check = vi.fn(); const tracker = trackTransfers({ rows: () => rows, available: () => true, check, status: vi.fn() });
    tracker.wake(); await vi.advanceTimersByTimeAsync(30000); expect(check).not.toHaveBeenCalled(); tracker.stop();
  });
  it('stops publishing status after unmount during an in-flight request', async () => {
    let release!: () => void; const status = vi.fn();
    const tracker = trackTransfers({ rows: () => [baseTransfer()], available: () => true, check: () => new Promise<void>(resolve => { release = resolve; }), status });
    tracker.wake(); await vi.advanceTimersByTimeAsync(0); tracker.stop(); release(); await vi.advanceTimersByTimeAsync(60000);
    expect(status).toHaveBeenCalledTimes(1);
  });
});
