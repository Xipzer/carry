// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address, type Hex } from 'viem';
import { network } from './chains';

export type Phase = 'prepared' | 'approving' | 'source-signing' | 'source-pending' | 'attesting' | 'ready' | 'mint-signing' | 'mint-pending' | 'complete' | 'attention' | 'cancelled';
export interface Intent { source: string; destination: string; amount: string; owner: Address; recipient: Address; speed: 'SLOW' | 'FAST'; forward: boolean }
export interface Transfer extends Intent {
  id: string; createdAt: number; phase: Phase; maxFee: string;
  approvalHash?: Hex; burnHash?: Hex; mintHash?: Hex; failedMintHash?: Hex;
  sourceIntent?: boolean; mintIntent?: boolean; sourceFailed?: boolean; error?: string; actualReceived?: string;
}
export interface FeeEstimate {
  intent: Intent; createdAt: number; fee: string; maxFee: string; minimumReceived: string;
  estimatedReceived: string; cctpFee: string; receivingFee: string;
  sourceGas: bigint; destinationGas: bigint; warnings: string[];
}
export interface Quote extends FeeEstimate { sourceBalance: bigint; contractRecipient: boolean }
export const MAX_TRANSFER = 10_000_000n * 1_000_000n;
export function amountUnits(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) || value.length > 24) {
    throw new Error('Enter a number with up to 6 decimal places. No commas or scientific notation.');
  }
  const units = parseUnits(value, 6);
  if (units <= 0n) throw new Error('Enter an amount greater than zero.');
  if (units > MAX_TRANSFER) throw new Error('CCTP supports up to 10,000,000 USDC per transfer.');
  return units;
}
export function recipientAddress(value: string): Address {
  if (!isAddress(value, { strict: true }) || value.toLowerCase() === zeroAddress) throw new Error('Enter a valid, non-zero EVM wallet address.');
  return getAddress(value);
}
export function validateIntent(i: Intent) {
  const a = network(i.source), b = network(i.destination);
  if (a.chainId === b.chainId) throw new Error('Choose two different networks.');
  if (a.isTestnet !== b.isTestnet) throw new Error('Mainnet and testnet cannot be mixed.');
  if (!['SLOW', 'FAST'].includes(i.speed) || typeof i.forward !== 'boolean') throw new Error('Invalid transfer settings.');
  amountUnits(i.amount); recipientAddress(i.recipient); recipientAddress(i.owner);
}
export function intentKey(i: Intent) {
  return JSON.stringify([i.source, i.destination, i.amount, i.owner.toLowerCase(), i.recipient.toLowerCase(), i.speed, i.forward]);
}
export function assertFreshQuote(q: Quote, i: Intent, now = Date.now()) {
  if (intentKey(q.intent) !== intentKey(i)) throw new Error('Transfer details changed. Review a fresh quote.');
  if (now - q.createdAt > 60_000 || now < q.createdAt) throw new Error('This quote expired. Refresh it before continuing.');
}
export const shortAddress = (s: string) => `${s.slice(0, 6)}...${s.slice(-4)}`;
export function money(s: string | bigint, decimals = 6) {
  const value = typeof s === 'bigint' ? formatUnits(s, decimals) : s;
  const [whole, fraction = ''] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? '.' + fraction.slice(0, 6).replace(/0+$/, '') : ''}`.replace(/\.$/, '');
}
export function friendlyError(error: unknown) {
  if (typeof error === 'string') return error.slice(0, 320);
  const e = error as { code?: number; message?: string; shortMessage?: string; cause?: { code?: number } };
  const text = e?.shortMessage || e?.message || 'This step could not be completed.';
  if (e?.code === 4001 || e?.cause?.code === 4001 || /user rejected|user denied/i.test(text)) return 'Wallet request rejected. No transaction was signed.';
  if (/insufficient funds|gas required exceeds|not enough.*gas/i.test(text)) return 'Your wallet needs more gas on this network. Add its native token, then continue the existing transfer.';
  if (/429|rate.limit/i.test(text)) return 'The network provider is busy. Wait a moment and check again. Do not start a second transfer.';
  if (/failed to fetch|timed? ?out|timeout|network error|connection (?:lost|closed)|socket/i.test(text)) return 'The connection was interrupted. Check your wallet activity before trying again. Any saved transfer is in Activity.';
  if (/blacklist|denylist|sanction|blocked/i.test(text)) return 'The token issuer or service blocked this transfer. Check Circle support; retrying cannot remove an issuer restriction.';
  return text.slice(0, 320);
}
export function gasAmount(units: bigint, decimals: number) {
  const [whole, fraction = ''] = formatUnits(units, decimals).split('.');
  if (units > 0n && whole === '0' && !/[1-9]/.test(fraction.slice(0, 8))) return '<0.00000001';
  const digits = fraction.slice(0, 8).replace(/0+$/, '');
  return `${whole}${digits ? '.' + digits : ''}`;
}

const STORE = 'carry.transfers.v1';
const phases: Phase[] = ['prepared', 'approving', 'source-signing', 'source-pending', 'attesting', 'ready', 'mint-signing', 'mint-pending', 'complete', 'attention', 'cancelled'];
export function readTransfers(storage: Storage = localStorage): Transfer[] {
  const raw = storage.getItem(STORE);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 200) throw new Error('Saved transfer history is damaged. Export it before resetting this browser.');
  for (const r of data) {
    if (!r || typeof r.id !== 'string' || !phases.includes(r.phase) || !Number.isFinite(r.createdAt) || typeof r.maxFee !== 'string' || !/^\d+(\.\d{1,6})?$/.test(r.maxFee)) throw new Error('Saved transfer history is invalid. Do not start another transfer until it is recovered.');
    validateIntent(r);
    for (const key of ['burnHash', 'mintHash', 'approvalHash', 'failedMintHash']) if (r[key] && !/^0x[\da-fA-F]{64}$/.test(r[key])) throw new Error('Saved transaction hash is invalid.');
    for (const key of ['sourceIntent', 'mintIntent', 'sourceFailed']) if (r[key] !== undefined && typeof r[key] !== 'boolean') throw new Error('Saved transfer flags are invalid.');
  }
  return data as Transfer[];
}
export function saveTransfer(t: Transfer, storage: Storage = localStorage) {
  const rows = readTransfers(storage);
  const next = [t, ...rows.filter(r => r.id !== t.id && !(t.burnHash && r.source === t.source && r.burnHash?.toLowerCase() === t.burnHash.toLowerCase()))];
  // Never silently evict an unfinished transfer.
  const pending = next.filter(r => !['complete', 'cancelled'].includes(r.phase));
  const finished = next.filter(r => ['complete', 'cancelled'].includes(r.phase)).slice(0, Math.max(0, 100 - pending.length));
  if (pending.length > 100) throw new Error('Too many unfinished transfers. Recover them before starting another.');
  storage.setItem(STORE, JSON.stringify([...pending, ...finished]));
}
export function storageAvailable(storage: Storage = localStorage) {
  const key = 'carry.storage-check'; storage.setItem(key, 'ok'); storage.removeItem(key);
}
export async function exclusive<T>(address: string, fn: () => Promise<T>) {
  if (!navigator.locks) throw new Error('This browser cannot safely coordinate transfers across tabs. Use a current Chrome, Firefox or Safari.');
  return navigator.locks.request(`carry:wallet:${address.toLowerCase()}`, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('A transfer is already being handled in another tab. Continue there first.');
    return fn();
  });
}
export const canDismiss = (t: Transfer) => t.sourceFailed === true || (!t.sourceIntent && !t.burnHash);
export const isUnfinished = (t: Transfer) => !['complete', 'cancelled'].includes(t.phase);
export const isRejection = (e: unknown): boolean => {
  const err = e as { code?: number; cause?: unknown };
  return err?.code === 4001 || (err?.cause ? isRejection(err.cause) : false);
};
