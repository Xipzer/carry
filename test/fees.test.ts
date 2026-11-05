// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { circleFees, parseCircleFees } from '../src/fees';
import { baseTransfer } from './fixtures';

const tier = (minimumFee: unknown = 0, high: unknown = '100000') => ({ finalityThreshold: 2000, minimumFee, forwardFee: { low: '1', med: '2', high } });
afterEach(() => vi.unstubAllGlobals());
describe('Circle fee units and bounded parsing', () => {
  it('uses the selected Standard tier and the high forwarding quote', () => {
    const q = parseCircleFees([{ ...tier(100), finalityThreshold: 1000 }, tier()], baseTransfer());
    expect(q).toMatchObject({ cctpFee: '0', receivingFee: '0.1', fee: '0.1', estimatedReceived: '99.9', maxFee: '0.11', minimumReceived: '99.89' });
  });
  it('does not assume Standard is free if Circle changes its protocol fee', () => {
    expect(parseCircleFees([tier('1.3')], baseTransfer()).cctpFee).toBe('0.013');
  });
  it('rounds fractional USDC minor units upward using integer arithmetic', () => {
    expect(parseCircleFees([tier('1.3', 0)], { ...baseTransfer(), amount: '0.020001' }).cctpFee).toBe('0.000003');
    expect(parseCircleFees([tier('0.000001', 0)], { ...baseTransfer(), amount: '10000000' }).cctpFee).toBe('0.001');
  });
  it('manual receiving does not require forwarding data or invent a charge', () => {
    const q = parseCircleFees([{ finalityThreshold: 2000, minimumFee: 0 }], { ...baseTransfer(), forward: false });
    expect(q).toMatchObject({ receivingFee: '0', fee: '0', maxFee: '0', estimatedReceived: '100' });
  });
  it.each([null, [], {}, [tier(), tier()], [{ ...tier(), finalityThreshold: 1000 }], [{ finalityThreshold: 2000 }]])('fails closed on ambiguous or incomplete data %j', data => {
    expect(() => parseCircleFees(data, baseTransfer())).toThrow('fee quote');
  });
  it.each([null, undefined, -1, '-1', Infinity, '1e2', '1.2345678', '10001', '', true, {}, '9'.repeat(100)])('rejects invalid protocol rates %j', value => {
    expect(() => parseCircleFees([{ ...tier(), minimumFee: value }], baseTransfer())).toThrow('fee quote');
  });
  it.each([-1, '-1', 1.1, '1.1', Number.MAX_SAFE_INTEGER + 1, '0xff', '', true, {}, '9'.repeat(100)])('rejects invalid forwarding units %j', value => {
    expect(() => parseCircleFees([tier(0, value)], baseTransfer())).toThrow('fee quote');
  });
  it('does not allow the fee cap to consume the transfer amount', () => {
    expect(() => parseCircleFees([tier()], { ...baseTransfer(), amount: '0.11' })).toThrow('too small');
  });
  it('requests only official route-specific URLs, without credentials, redirects or caching', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, text: async () => JSON.stringify([tier()]) })); vi.stubGlobal('fetch', fetcher);
    await circleFees({ ...baseTransfer(), destination: 'HyperEVM' });
    expect(fetcher).toHaveBeenLastCalledWith('https://iris-api.circle.com/v2/burn/USDC/fees/6/19?forward=true', expect.objectContaining({ cache: 'no-store', credentials: 'omit', redirect: 'error' }));
    await circleFees({ ...baseTransfer(), forward: false });
    expect(fetcher).toHaveBeenLastCalledWith('https://iris-api.circle.com/v2/burn/USDC/fees/6/0', expect.anything());
  });
  it('does not treat an unavailable API or an oversized response as zero fees', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    await expect(circleFees(baseTransfer())).rejects.toThrow('503');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => ' '.repeat(16_385) })));
    await expect(circleFees(baseTransfer())).rejects.toThrow('fee quote');
  });
});
