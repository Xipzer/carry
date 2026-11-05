// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { describe, expect, it } from 'vitest';
import { concat, slice, toHex, zeroHash } from 'viem';
import { network } from '../src/chains';
import { decodeMessage, FORWARD_HOOK, isForwardHook, matchAttestation, validateMessage } from '../src/message';
import { baseTransfer, message, RECIPIENT } from './fixtures';

describe('CCTP V2 byte-level proof binding', () => {
  it('decodes the official header/body layout', () => { const m = decodeMessage(message(true)); expect(m.sourceDomain).toBe(6); expect(m.amount).toBe(100000000n); expect(m.fee).toBe(100000n); });
  it('allows Circle to fill only nonce, finality, executed fee and expiration', () => { expect(matchAttestation(message(true), message(), baseTransfer()).fee).toBe(100000n); });
  it('accepts a hook-free manual proof with a zero fee cap', () => {
    const options = { hook: '0x', maxFee: 0n, fee: 0n } as const;
    const proof = matchAttestation(message(true, options), message(false, options), { ...baseTransfer(), forward: false, maxFee: '0' });
    expect(proof.hook).toBe('0x'); expect(proof.fee).toBe(0n);
  });
  it('rejects adding or removing the source forwarding hook', () => {
    expect(() => matchAttestation(message(true), message(false, { hook: '0x' }), baseTransfer())).toThrow('match');
    expect(() => matchAttestation(message(true, { hook: '0x' }), message(), baseTransfer())).toThrow('match');
  });
  it.each([
    ['recipient substitution', { recipient: RECIPIENT }], ['oversized fee', { fee: 120000n }], ['fee-cap change', { maxFee: 120000n }],
    ['amount substitution', { amount: 99000000n }], ['insufficient finality', { finality: 1000 }], ['empty nonce', { nonce: zeroHash }],
    ['arbitrary hook', { hook: '0x1234' as const }],
  ])('rejects %s', (_label, changes) => { expect(() => matchAttestation(message(true, changes), message(), baseTransfer())).toThrow(); });
  it('rejects a different source domain or a restricted destination caller', () => {
    const original = message();
    expect(() => validateMessage(concat([slice(original, 0, 4), toHex(3, { size: 4 }), slice(original, 8)]), network('Base'))).toThrow();
    expect(() => validateMessage(concat([slice(original, 0, 108), toHex(1, { size: 32 }), slice(original, 140)]), network('Base'))).toThrow();
  });
  it.each(['0x1234', '0xzz', '0x1'])('rejects malformed/truncated %s', value => { expect(() => decodeMessage(value as `0x${string}`)).toThrow(); });
  it('only allows the empty, standard Circle forwarding hook', () => { expect(isForwardHook(FORWARD_HOOK)).toBe(true); expect(isForwardHook(FORWARD_HOOK + 'ff')).toBe(false); });
});
