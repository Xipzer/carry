// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { amountUnits, assertFreshQuote, canDismiss, exclusive, friendlyError, gasAmount, intentKey, money, readTransfers, recipientAddress, saveTransfer, storageAvailable, validateIntent, type Quote } from '../src/model';
import { canForward, contracts, duration, listNetworks, mainnets, network, networks } from '../src/chains';
import { baseTransfer, lockManager, MemoryStorage, OWNER } from './fixtures';

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); vi.stubGlobal('navigator', { locks: lockManager() }); });
describe('six-decimal, lossless amounts', () => {
  it.each(['0.000001', '1', '10000000', '0.1', '99.999999'])('accepts %s without floating-point math', value => { expect(amountUnits(value) > 0n).toBe(true); });
  it.each(['0', '-1', '1e6', '1,000', '01', '1.0000001', '10000000.000001', 'Infinity', '.5', '1.', ' 1', '', 'abc'])('rejects unsafe input %s', value => { expect(() => amountUnits(value)).toThrow(); });
  it('formats without rounding away the sixth decimal', () => { expect(money(100000001n)).toBe('100.000001'); expect(money(100000000n)).toBe('100'); });
});
describe('routing and quote consent', () => {
  it('includes all 25 currently registered EVM mainnets, no duplicate IDs', () => {
    expect(mainnets).toHaveLength(25); expect(new Set(networks.map(c => c.chainId)).size).toBe(networks.length);
    networks.forEach(c => expect(contracts(c).messenger).toMatch(/^0x[\da-fA-F]{40}$/));
    expect(listNetworks()[0].chain).toBe('Base'); expect(canForward(network('Cronos'))).toBe(false);
  });
  it('rejects mixed environments and same-chain transfers', () => {
    expect(() => validateIntent({ ...baseTransfer(), destination: 'Base' })).toThrow('different');
    expect(() => validateIntent({ ...baseTransfer(), destination: listNetworks(true)[1].chain })).toThrow('mixed');
  });
  it('rejects zero, ENS, and malformed receiving addresses', () => {
    ['0x' + '00'.repeat(20), 'vitalik.eth', '0x123'].forEach(v => expect(() => recipientAddress(v)).toThrow());
    expect(recipientAddress(OWNER)).toBe(OWNER);
  });
  it('expires a quote and binds every reviewed field', () => {
    const i = baseTransfer(), q: Quote = { intent: i, createdAt: 100000, fee: '0.1', cctpFee: '0', receivingFee: '0.1', estimatedReceived: '99.9', maxFee: '0.11', minimumReceived: '99.89', sourceGas: 1n, destinationGas: 0n, sourceBalance: 100000000n, contractRecipient: false, warnings: [] };
    expect(() => assertFreshQuote(q, i, 160001)).toThrow('expired');
    expect(() => assertFreshQuote(q, { ...i, amount: '101' }, 120000)).toThrow('changed');
    expect(() => assertFreshQuote(q, i, 99999)).toThrow('expired');
    expect(() => assertFreshQuote(q, i, 120000)).not.toThrow();
    expect(intentKey(i)).not.toBe(intentKey({ ...i, forward: false }));
  });
  it('does not advertise Linea as instant', () => { expect(duration(network('Linea'), 'SLOW')).toBe('6-32 hours'); expect(duration(network('Base'), 'SLOW')).toContain('15-30'); });
  it('does not display a small positive gas cost as zero', () => { expect(gasAmount(1n, 18)).toBe('<0.00000001'); expect(gasAmount(10000000000n, 18)).toBe('0.00000001'); expect(gasAmount(100000000000000n, 18)).toBe('0.0001'); });
});
describe('persistent recovery and exclusive execution', () => {
  it('saves bigint-free intents and deduplicates the same burn', () => {
    saveTransfer(baseTransfer()); saveTransfer({ ...baseTransfer(), id: 'restored' });
    expect(readTransfers()).toHaveLength(1); expect(readTransfers()[0].id).toBe('restored');
  });
  it('never silently drops an unfinished transfer when history is full', () => {
    const active = { ...baseTransfer(), id: 'active' }; saveTransfer(active);
    for (let i = 0; i < 105; i++) saveTransfer({ ...baseTransfer(), id: String(i), burnHash: undefined, sourceIntent: false, phase: 'complete' });
    expect(readTransfers()).toHaveLength(100); expect(readTransfers().some(t => t.id === 'active')).toBe(true);
  });
  it('fails closed on corrupt storage and invalid flags', () => {
    localStorage.setItem('carry.transfers.v1', '{}'); expect(() => readTransfers()).toThrow('damaged');
    localStorage.setItem('carry.transfers.v1', JSON.stringify([{ ...baseTransfer(), sourceIntent: 'false' }])); expect(() => readTransfers()).toThrow('flags');
  });
  it('does not hide storage quota failures', () => { expect(() => storageAvailable({ setItem: () => { throw new Error('quota'); } } as unknown as Storage)).toThrow('quota'); });
  it('cannot dismiss a submitted or ambiguous source burn', () => {
    expect(canDismiss(baseTransfer())).toBe(false);
    expect(canDismiss({ ...baseTransfer(), burnHash: undefined })).toBe(false);
    expect(canDismiss({ ...baseTransfer(), burnHash: undefined, sourceIntent: false })).toBe(true);
    expect(canDismiss({ ...baseTransfer(), sourceFailed: true })).toBe(true);
  });
  it('blocks simultaneous work for the same wallet across tabs', async () => {
    let release!: () => void;
    const first = exclusive(OWNER, () => new Promise<void>(r => { release = r; }));
    await expect(exclusive(OWNER, async () => true)).rejects.toThrow('another tab');
    release(); await first;
  });
  it('fails closed in browsers without Web Locks', async () => { vi.stubGlobal('navigator', {}); await expect(exclusive(OWNER, async () => true)).rejects.toThrow('browser'); });
  it('preserves meaningful network errors and string errors', () => {
    expect(friendlyError(new Error('Choose two different networks.'))).toBe('Choose two different networks.');
    expect(friendlyError('A specific problem')).toBe('A specific problem');
    expect(friendlyError({ code: 4001 })).toContain('rejected');
  });
});
