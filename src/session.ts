// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { network } from './chains';
import { isUnfinished, type Transfer } from './model';

export type SavedWallet = { id: string; name: string; address: string };
export function savedWallet(): SavedWallet | null {
  try {
    const value = JSON.parse(localStorage.getItem('carry.wallet') || 'null');
    return value && typeof value.id === 'string' && typeof value.name === 'string' && /^0x[\da-f]{40}$/i.test(value.address) ? value : null;
  } catch { return null; }
}
export function rememberWallet(value: SavedWallet | null) {
  try { if (value) localStorage.setItem('carry.wallet', JSON.stringify(value)); else localStorage.removeItem('carry.wallet'); } catch {}
}
export type Draft = {
  source: string; destination: string; amount: string; custom: boolean; recipient: string;
  receivingMode: 'automatic' | 'manual'; panel: 'activity' | 'progress' | 'recover' | 'help' | null;
  selectedId: string; recoveryHash: string; recoverySource: string; recoveryTestnet: boolean; recoveryTarget: string | null;
};
export function readDraft(transfers: Transfer[]): Draft | null {
  try {
    const d = JSON.parse(sessionStorage.getItem('carry.draft') || 'null');
    if (d && network(d.source).isTestnet === network(d.destination).isTestnet && d.source !== d.destination
      && ['amount', 'recipient', 'selectedId', 'recoveryHash', 'recoverySource'].every(k => typeof d[k] === 'string')
      && typeof d.custom === 'boolean' && typeof d.recoveryTestnet === 'boolean'
      && (d.recoveryTarget === null || typeof d.recoveryTarget === 'string')
      && ['manual', 'automatic'].includes(d.receivingMode) && [null, 'activity', 'progress', 'recover', 'help'].includes(d.panel)
      && network(d.recoverySource).isTestnet === d.recoveryTestnet) return d;
  } catch {}
  const t = transfers.find(isUnfinished);
  return t ? { source: t.source, destination: t.destination, amount: t.amount, custom: t.recipient.toLowerCase() !== t.owner.toLowerCase(), recipient: t.recipient,
    receivingMode: t.forward ? 'automatic' : 'manual', panel: null, selectedId: t.id,
    recoveryHash: '', recoverySource: t.source, recoveryTestnet: network(t.source).isTestnet, recoveryTarget: null } : null;
}
export function saveDraft(draft: Draft) {
  try { sessionStorage.setItem('carry.draft', JSON.stringify(draft)); } catch {}
}
