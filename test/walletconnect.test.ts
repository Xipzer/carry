// @vitest-environment jsdom
// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type UniversalProvider from '@walletconnect/universal-provider';
import { connectWalletConnect, ethereumSession } from '../src/walletconnect';
import { walletConnect } from '../src/wallet';
import { network } from '../src/chains';
import { OWNER, RECIPIENT } from './fixtures';
import { ensureAccount } from '../src/wallet';

const mocks = vi.hoisted(() => ({ init: vi.fn(), qr: vi.fn() }));
vi.mock('@walletconnect/universal-provider', () => ({ default: { init: mocks.init } }));
vi.mock('qrcode', () => ({ toDataURL: mocks.qr }));
const uri = `wc:${'ab'.repeat(32)}@2?relay-protocol=irn&symKey=${'cd'.repeat(32)}`;
const projectId = 'ab'.repeat(16), acceptedKey = `carry.walletconnect.accepted:${projectId}`;
const session = () => ({ topic: 'approved-topic', namespaces: { eip155: { accounts: [`eip155:8453:${OWNER}`, `eip155:42161:${OWNER}`], methods: ['eth_sendTransaction'], events: ['chainChanged', 'accountsChanged'] } } });
function fakeProvider(connected = true) {
  let chain = 8453;
  const events = new Map<string, Set<(...args: any[]) => void>>();
  const raw = {
    session: (connected ? session() : undefined) as any,
    client: { request: vi.fn(async () => '0xtransaction'), session: { get: vi.fn(() => raw.session) } },
    request: vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? chain : method === 'eth_accounts' || method === 'eth_requestAccounts' ? [OWNER] : '0xtransaction'),
    on: (name: string, fn: (...args: any[]) => void) => { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(fn); },
    removeListener: (name: string, fn: (...args: any[]) => void) => { events.get(name)?.delete(fn); },
    emit: (name: string, ...args: any[]) => { events.get(name)?.forEach(fn => fn(...args)); },
    setDefaultChain: vi.fn((id: string) => { chain = Number(id.split(':')[1]); raw.emit('chainChanged', String(chain)); }),
    connect: vi.fn(async () => { raw.session = session(); return raw.session; }),
    disconnect: vi.fn(async () => { raw.session = undefined; }),
    cleanupPendingPairings: vi.fn(async () => {}),
  };
  return raw;
}
const asProvider = (p: ReturnType<typeof fakeProvider>) => p as unknown as UniversalProvider;
beforeEach(() => {
  let next = 0; vi.stubGlobal('crypto', { randomUUID: () => `test-pairing-${next++}` });
  localStorage.clear();
  mocks.qr.mockResolvedValue('data:image/png;base64,AA==');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('WalletConnect EIP-1193 compatibility', () => {
  it('keeps accounts, hexadecimal chain IDs and approved chain switching', async () => {
    const raw = fakeProvider(), p = ethereumSession(asProvider(raw), network('Base'));
    expect(await p.request({ method: 'eth_requestAccounts' })).toEqual([OWNER]);
    expect(await p.request({ method: 'eth_chainId' })).toBe('0x2105');
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa4b1' }] });
    expect(raw.setDefaultChain).toHaveBeenLastCalledWith('eip155:42161');
    expect(await p.request({ method: 'eth_chainId' })).toBe('0xa4b1');
  });
  it('cannot silently switch to an unapproved or opposite-environment network', async () => {
    const raw = fakeProvider(), p = ethereumSession(asProvider(raw), network('Base'));
    await expect(p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x3e7' }] })).rejects.toThrow('not approved');
    raw.session!.namespaces.eip155.accounts.push(`eip155:84532:${OWNER}`);
    await expect(p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x14a34', chainName: 'untrusted' }] } as never)).rejects.toThrow('not approved');
    expect(raw.setDefaultChain).not.toHaveBeenCalled();
  });
  it('preserves account, chain and disconnect events and removes subscriptions', async () => {
    const raw = fakeProvider(), p = ethereumSession(asProvider(raw), network('Base'));
    raw.session.namespaces.eip155.accounts.push(`eip155:8453:${RECIPIENT}`);
    const account = vi.fn(), chain = vi.fn(), disconnect = vi.fn();
    p.on!('accountsChanged', account); p.on!('chainChanged', chain); p.on!('disconnect', disconnect);
    raw.emit('session_event', { params: { chainId: 'eip155:8453', event: { name: 'accountsChanged', data: [RECIPIENT] } } });
    expect(account).toHaveBeenLastCalledWith([RECIPIENT]); expect(await p.request({ method: 'eth_accounts' })).toEqual([RECIPIENT]);
    raw.emit('chainChanged', '42161'); expect(chain).toHaveBeenLastCalledWith('0xa4b1');
    raw.emit('session_update'); await vi.waitFor(() => expect(account).toHaveBeenLastCalledWith([OWNER]));
    raw.emit('disconnect', { code: 6000 }); expect(disconnect).toHaveBeenCalled(); expect(await p.request({ method: 'eth_accounts' })).toEqual([]);
    p.removeListener!('accountsChanged', account); p.removeListener!('chainChanged', chain); p.removeListener!('disconnect', disconnect);
    account.mockClear(); chain.mockClear(); disconnect.mockClear();
    raw.emit('accountsChanged', [RECIPIENT]); raw.emit('chainChanged', '1'); raw.emit('disconnect'); raw.emit('session_update');
    await Promise.resolve(); expect(account).not.toHaveBeenCalled(); expect(chain).not.toHaveBeenCalled(); expect(disconnect).not.toHaveBeenCalled();
  });
  it('does not permit raw signing, batching, or a send method the wallet never approved', async () => {
    const raw = fakeProvider(), p = ethereumSession(asProvider(raw), network('Base'));
    await expect(p.request({ method: 'personal_sign' } as never)).rejects.toThrow('reviewed');
    await expect(p.request({ method: 'wallet_sendCalls' } as never)).rejects.toThrow('reviewed');
    raw.session!.namespaces.eip155.methods = [];
    await expect(p.request({ method: 'eth_sendTransaction', params: [{ from: OWNER, to: OWNER, data: '0x' }] })).rejects.toThrow('not approved');
    expect(raw.request.mock.calls.some(([r]) => r.method === 'eth_sendTransaction')).toBe(false);
  });
  it('uses the selected account, not stale UP account order, for signing rechecks', async () => {
    const raw = fakeProvider(); raw.session.namespaces.eip155.accounts.push(`eip155:8453:${RECIPIENT}`);
    const p = ethereumSession(asProvider(raw), network('Base'));
    raw.emit('session_event', { params: { chainId: 'eip155:8453', event: { name: 'accountsChanged', data: [RECIPIENT] } } });
    await expect(ensureAccount(p, OWNER)).rejects.toThrow('changed'); await expect(ensureAccount(p, RECIPIENT)).resolves.toBeUndefined();
    await expect(p.request({ method: 'eth_sendTransaction', params: [{ from: OWNER, to: OWNER, data: '0x' }] })).rejects.toThrow('changed');
    await p.request({ method: 'eth_sendTransaction', params: [{ from: RECIPIENT, to: OWNER, data: '0x' }] });
    expect(raw.client.request).toHaveBeenLastCalledWith(expect.objectContaining({ topic: 'approved-topic', chainId: 'eip155:8453' }));
  });
  it('handles chain-scoped namespace updates without UP cached account reads or event races', async () => {
    const raw = fakeProvider(); raw.session.namespaces = { 'eip155:8453': { accounts: [`eip155:8453:${OWNER}`], methods: ['eth_sendTransaction'], events: [] } };
    const p = ethereumSession(asProvider(raw), network('Base')), events = vi.fn(); p.on!('accountsChanged', events);
    raw.session.namespaces['eip155:42161'] = { accounts: [`eip155:42161:${RECIPIENT}`], methods: ['eth_sendTransaction'], events: [] };
    raw.emit('session_update'); await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa4b1' }] });
    await Promise.resolve(); expect(events).toHaveBeenLastCalledWith([RECIPIENT]); expect(await p.request({ method: 'eth_accounts' })).toEqual([RECIPIENT]);
    raw.emit('accountsChanged', [OWNER]); expect(await p.request({ method: 'eth_accounts' })).toEqual([RECIPIENT]);
  });
  it('blocks an account revoked in SignClient before UP has received its update notification', async () => {
    const raw = fakeProvider(); raw.session.namespaces.eip155.accounts.push(`eip155:8453:${RECIPIENT}`);
    const p = ethereumSession(asProvider(raw), network('Base'));
    const current = session(); current.namespaces.eip155.accounts = [`eip155:8453:${RECIPIENT}`];
    raw.client.session.get.mockReturnValue(current);
    await expect(ensureAccount(p, OWNER)).rejects.toThrow('changed');
    await expect(p.request({ method: 'eth_sendTransaction', params: [{ from: OWNER, to: OWNER, data: '0x' }] })).rejects.toThrow('changed');
    expect(raw.client.request).not.toHaveBeenCalled();
    raw.client.session.get.mockImplementation(() => { throw new Error('Session deleted'); });
    expect(await p.request({ method: 'eth_accounts' })).toEqual([]);
  });
});
describe('pairing lifecycle without AppKit', () => {
  it('validates the public project ID before loading a relay session', async () => {
    await expect(walletConnect('', network('Base'))).rejects.toThrow('project ID'); expect(mocks.init).not.toHaveBeenCalled();
  });
  it('restores an approved source session without creating another pairing', async () => {
    const raw = fakeProvider(); mocks.init.mockResolvedValue(raw);
    localStorage.setItem(acceptedKey, `carry-v2:${projectId}:previously-accepted`);
    const p = await connectWalletConnect('ab'.repeat(16), network('Base'), true);
    expect(raw.connect).not.toHaveBeenCalled(); expect(await p.request({ method: 'eth_accounts' })).toEqual([OWNER]);
    expect(mocks.init).toHaveBeenCalledWith(expect.objectContaining({ telemetryEnabled: false }));
  });
  it('requests transaction permissions, not arbitrary signatures, in the selected environment only', async () => {
    const raw = fakeProvider(false); mocks.init.mockResolvedValue(raw);
    await connectWalletConnect('ab'.repeat(16), network('Base'));
    const ns = (raw.connect.mock.calls[0] as any)[0].optionalNamespaces.eip155;
    expect(ns.chains[0]).toBe('eip155:8453'); expect(ns.chains).not.toContain('eip155:84532');
    expect(ns.methods).toEqual(['eth_sendTransaction', 'wallet_switchEthereumChain', 'wallet_addEthereumChain']);
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('silent restoration never opens pairing when the accepted session is absent or expired', async () => {
    const raw = fakeProvider(false); mocks.init.mockResolvedValue(raw);
    await expect(connectWalletConnect(projectId, network('Base'), true)).rejects.toThrow('No approved');
    expect(mocks.init).not.toHaveBeenCalled();
    localStorage.setItem(acceptedKey, `carry-v2:${projectId}:expired`);
    await expect(connectWalletConnect(projectId, network('Base'), true)).rejects.toThrow('No approved');
    expect(raw.connect).not.toHaveBeenCalled(); expect(document.querySelector('dialog')).toBeNull();
  });
  it('cancels QR pairing immediately and disconnects a late wallet approval', async () => {
    const raw = fakeProvider(false); mocks.init.mockResolvedValue(raw);
    let approve!: () => void;
    raw.connect.mockImplementation(() => { raw.emit('display_uri', uri); return new Promise(resolve => { approve = () => { raw.session = session(); resolve(raw.session); }; }); });
    const result = connectWalletConnect('ab'.repeat(16), network('Base'));
    const rejected = expect(result).rejects.toMatchObject({ code: 4001 });
    await vi.waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull());
    expect(document.querySelector('a')!.getAttribute('href')).toBe(uri);
    (document.querySelector('button.text-button') as HTMLButtonElement).click();
    await rejected; expect(document.querySelector('dialog')).toBeNull(); expect(raw.cleanupPendingPairings).toHaveBeenCalledWith({ deletePairings: true });
    approve(); await vi.waitFor(() => expect(raw.disconnect).toHaveBeenCalled());
  });
  it('cleans up a rejected pairing and never connects an unapproved source', async () => {
    const raw = fakeProvider(false); mocks.init.mockResolvedValue(raw);
    raw.connect.mockRejectedValue(Object.assign(new Error('Rejected'), { code: 5000 }));
    await expect(connectWalletConnect('ab'.repeat(16), network('Base'))).rejects.toThrow('Rejected');
    expect(document.querySelector('dialog')).toBeNull();
    raw.connect.mockImplementation(async () => { raw.session = session(); raw.session.namespaces.eip155.accounts = [`eip155:1:${OWNER}`]; return raw.session; });
    await expect(connectWalletConnect('ab'.repeat(16), network('Base'))).rejects.toThrow('did not approve');
    expect(raw.disconnect).toHaveBeenCalled();
  });
  it('never registers a cancelled late-approved session, even when remote disconnect fails', async () => {
    const raw = fakeProvider(false); mocks.init.mockResolvedValue(raw);
    let approve!: () => void;
    raw.connect.mockImplementation(() => { raw.emit('display_uri', uri); return new Promise(resolve => { approve = () => { raw.session = session(); resolve(raw.session); }; }); });
    raw.disconnect.mockRejectedValue(new Error('Offline relay'));
    const result = connectWalletConnect(projectId, network('Base')), rejected = expect(result).rejects.toMatchObject({ code: 4001 });
    await vi.waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull());
    (document.querySelector('button.text-button') as HTMLButtonElement).click(); await rejected;
    approve(); await vi.waitFor(() => expect(raw.disconnect).toHaveBeenCalled()); expect(localStorage.getItem(acceptedKey)).toBeNull();
    const fresh = fakeProvider(false); mocks.init.mockResolvedValue(fresh);
    await connectWalletConnect(projectId, network('Base'));
    expect(fresh.connect).toHaveBeenCalled();
    const firstPrefix = mocks.init.mock.calls[0][0].customStoragePrefix, finalPrefix = mocks.init.mock.lastCall![0].customStoragePrefix;
    expect(finalPrefix).not.toBe(firstPrefix); expect(localStorage.getItem(acceptedKey)).toBe(finalPrefix);
  });
  it('removes a cancelled QR immediately without waiting for network teardown', async () => {
    const raw = fakeProvider(false); mocks.init.mockResolvedValue(raw);
    raw.connect.mockImplementation(() => { raw.emit('display_uri', uri); raw.session = session(); return new Promise(() => {}); });
    raw.cleanupPendingPairings.mockImplementation(() => new Promise(() => {})); raw.disconnect.mockImplementation(() => new Promise(() => {}));
    const result = connectWalletConnect(projectId, network('Base')), rejected = expect(result).rejects.toMatchObject({ code: 4001 });
    await vi.waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull());
    (document.querySelector('button.text-button') as HTMLButtonElement).click(); expect(document.querySelector('dialog')).toBeNull();
    await rejected; expect(localStorage.getItem(acceptedKey)).toBeNull();
  });
});
