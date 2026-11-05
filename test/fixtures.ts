// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { concat, encodeEventTopics, toHex, zeroHash, type Hex } from 'viem';
import { contracts, network } from '../src/chains';
import { address32, FORWARD_HOOK } from '../src/message';
import { transmitterAbi } from '../src/abi';
import type { Transfer } from '../src/model';

export const OWNER = '0x1111111111111111111111111111111111111111';
export const RECIPIENT = '0x2222222222222222222222222222222222222222';
export const BURN_HASH: Hex = `0x${'ab'.repeat(32)}`;
export const MINT_HASH: Hex = `0x${'cd'.repeat(32)}`;
export const NONCE: Hex = `0x${'12'.repeat(32)}`;
export const baseTransfer = (): Transfer => ({ id: 'test-transfer', createdAt: Date.now() - 180000, phase: 'attesting', source: 'Base', destination: 'Ethereum', amount: '100', owner: OWNER, recipient: OWNER, speed: 'SLOW', forward: true, maxFee: '0.11', burnHash: BURN_HASH, sourceIntent: true });
export function message(attested = false, overrides: { destination?: string; recipient?: string; fee?: bigint; maxFee?: bigint; finality?: number; nonce?: Hex; expiration?: bigint; hook?: Hex; amount?: bigint } = {}): Hex {
  const destination = network(overrides.destination ?? 'Ethereum');
  return concat([
    toHex(1, { size: 4 }), toHex(6, { size: 4 }), toHex(destination.cctp.domain, { size: 4 }), attested ? overrides.nonce ?? NONCE : zeroHash,
    address32(contracts(network('Base')).messenger), address32(contracts(destination).messenger), zeroHash,
    toHex(2000, { size: 4 }), toHex(attested ? overrides.finality ?? 2000 : 0, { size: 4 }), toHex(1, { size: 4 }),
    address32(network('Base').usdcAddress as Hex), address32((overrides.recipient ?? OWNER) as Hex), toHex(overrides.amount ?? 100000000n, { size: 32 }), address32(OWNER),
    toHex(overrides.maxFee ?? 110000n, { size: 32 }), toHex(attested ? overrides.fee ?? 100000n : 0n, { size: 32 }), toHex(overrides.expiration ?? 0n, { size: 32 }), overrides.hook ?? FORWARD_HOOK,
  ]);
}
export function sourceReceipt(original = message()) {
  return { status: 'success', from: OWNER, to: contracts(network('Base')).messenger, transactionHash: BURN_HASH,
    logs: [{ address: contracts(network('Base')).transmitter, data: concat([toHex(32, { size: 32 }), toHex((original.length - 2) / 2, { size: 32 }), original, `0x${'00'.repeat((32 - ((original.length - 2) / 2) % 32) % 32)}`]), topics: encodeEventTopics({ abi: transmitterAbi, eventName: 'MessageSent' }) }] };
}
export class MemoryStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, value); }
}
export function lockManager() {
  const held = new Set<string>();
  return { request: async (name: string, _options: unknown, fn: (lock: { name: string } | null) => Promise<unknown>) => {
    if (held.has(name)) return fn(null);
    held.add(name); try { return await fn({ name }); } finally { held.delete(name); }
  } };
}
