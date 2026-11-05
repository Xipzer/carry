// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { getAddress, type Address } from 'viem';
import type UniversalProvider from '@walletconnect/universal-provider';
import { networks, type Network } from './chains';
import { pairingDialog } from './pairing';
import type { Provider } from './wallet';

function authoritativeSession(provider: UniversalProvider) {
  try { return provider.session ? provider.client.session.get(provider.session.topic) : undefined; }
  catch { return undefined; }
}
function accountsFor(provider: UniversalProvider, chain: number): Address[] {
  return [...new Set(Object.values(authoritativeSession(provider)?.namespaces ?? {}).flatMap(n => n.accounts ?? [])
    .filter(a => a.startsWith(`eip155:${chain}:`)).map(a => getAddress(a.split(':')[2])))];
}
export function ethereumSession(provider: UniversalProvider, source: Network): Provider {
  let chain = source.chainId, active = true;
  const selected = new Map<number, Address[]>(), listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (name: string, ...args: unknown[]) => listeners.get(name)?.forEach(fn => fn(...args));
  const accounts = () => {
    if (!active) return [];
    const approved = accountsFor(provider, chain), previous = selected.get(chain);
    const current = previous ? previous.filter(a => approved.includes(a)) : approved;
    selected.set(chain, current); return [...current];
  };
  accounts();
  const changed = (value: unknown) => {
    const id = Number(String(value).replace(/^eip155:/, ''));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    chain = id; emit('chainChanged', `0x${id.toString(16)}`); emit('accountsChanged', accounts());
  };
  const updated = () => { emit('accountsChanged', accounts()); };
  const event = (payload: { params?: { chainId?: string; event?: { name?: string; data?: unknown } } }) => {
    if (payload.params?.event?.name !== 'accountsChanged') return;
    const id = Number(payload.params.chainId?.replace(/^eip155:/, ''));
    if (!Number.isSafeInteger(id) || id <= 0) return;
    const values = payload.params.event.data, approved = accountsFor(provider, id);
    let next: Address[] = [];
    try { if (Array.isArray(values)) next = values.map(a => getAddress(String(a).split(':').at(-1)!)).filter(a => approved.includes(a)); } catch { /* Invalid selection becomes no selected account. */ }
    selected.set(id, next);
    if (chain === id) emit('accountsChanged', [...next]);
  };
  const disconnected = (...args: unknown[]) => { active = false; selected.clear(); emit('disconnect', ...args); };
  // UniversalProvider's raw accountsChanged is also emitted for its stale cached
  // account set on internal switches. Use chain-scoped wallet session events and
  // the current approved namespaces instead, with no asynchronous stale reads.
  provider.on('chainChanged', changed); provider.on('session_update', updated);
  provider.on('session_event', event); provider.on('disconnect', disconnected);
  return {
    request: (async (args: { method: string; params?: unknown }) => {
      if (args.method === 'eth_chainId') return `0x${chain.toString(16)}`;
      if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return accounts();
      if (args.method === 'wallet_getCapabilities') return {};
      if (args.method === 'wallet_switchEthereumChain' || args.method === 'wallet_addEthereumChain') {
        const id = Number((args.params as { chainId?: string }[])?.[0]?.chainId);
        if (!networks.some(c => c.chainId === id && c.isTestnet === source.isTestnet) || !accountsFor(provider, id).length) throw new Error('This network is not approved in WalletConnect. Reconnect with the receiving or sending network enabled.');
        provider.setDefaultChain(`eip155:${id}`);
        if (chain !== id) changed(id);
        return null;
      }
      if (args.method !== 'eth_sendTransaction') throw new Error('This WalletConnect session only permits reviewed transactions.');
      const tx = (args.params as { from?: string }[])?.[0];
      if (!tx?.from || tx.from.toLowerCase() !== accounts()[0]?.toLowerCase()) throw new Error('The connected account changed. Reconnect the wallet used for this action.');
      const current = authoritativeSession(provider);
      const approved = Object.values(current?.namespaces ?? {}).some(n => n.accounts.some(a => a.toLowerCase() === `eip155:${chain}:${tx.from!.toLowerCase()}`) && n.methods.includes('eth_sendTransaction'));
      if (!current || !approved) throw new Error('This wallet session has not approved transaction requests. Reconnect your wallet.');
      // Avoid UP's stale chain-scoped subprovider cache. SignClient validates the
      // current authoritative namespace, topic and explicit CAIP chain again.
      return provider.client.request({ topic: current.topic, chainId: `eip155:${chain}`, request: { method: args.method, params: args.params ?? [] } });
    }) as Provider['request'],
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
    removeListener(name, fn) { listeners.get(name)?.delete(fn); },
    async disconnect() {
      active = false;
      try { await provider.disconnect(); }
      finally { provider.removeListener('chainChanged', changed); provider.removeListener('session_update', updated); provider.removeListener('session_event', event); provider.removeListener('disconnect', disconnected); selected.clear(); listeners.clear(); }
    },
  };
}
export async function connectWalletConnect(projectId: string, source: Network, restoreOnly = false): Promise<Provider> {
  const { default: UniversalProvider } = await import('@walletconnect/universal-provider');
  const key = `carry.walletconnect.accepted:${projectId}`;
  const metadata = { name: 'Carry', description: 'Native USDC, across networks with Circle CCTP', url: window.location.origin, icons: [new URL('/carry.svg', window.location.origin).href] };
  const init = (prefix: string) => UniversalProvider.init({ projectId, telemetryEnabled: false, customStoragePrefix: prefix, metadata });
  let prefix = localStorage.getItem(key);
  if (!prefix?.startsWith(`carry-v2:${projectId}:`)) prefix = null;
  let provider = prefix ? await init(prefix) : undefined;
  // Only a previously ACCEPTED attempt has a restorable storage namespace.
  // Every fresh QR gets its own namespace, committed only after success. A failed
  // remote disconnect can leave an orphan in the wallet, but cannot restore a
  // locally cancelled attempt or overwrite a later accepted connection.
  if (!provider?.session || !accountsFor(provider, source.chainId).length) {
    if (restoreOnly) throw new Error('No approved WalletConnect session to restore.');
    prefix = `carry-v2:${projectId}:${crypto.randomUUID()}`;
    provider = await init(prefix);
    if (provider.session) throw new Error('A fresh WalletConnect namespace unexpectedly contained a session. Reconnect with a clean connection.');
    let cancelled = false, reject!: (e: Error) => void;
    const cancellation = new Promise<never>((_, fail) => { reject = fail; });
    const dialog = pairingDialog(() => stop(Object.assign(new Error('WalletConnect connection cancelled.'), { code: 4001 })));
    const display = (uri: unknown) => { void dialog.show(uri).catch(stop); };
    function stop(error: Error) { cancelled = true; dialog.close(); provider!.removeListener('display_uri', display); reject(error); }
    provider.on('display_uri', display);
    const timer = setTimeout(() => stop(new Error('WalletConnect pairing expired. Try connecting again.')), 180000);
    const attempt = provider.connect({ optionalNamespaces: { eip155: {
      chains: [source, ...networks.filter(c => c.chainId !== source.chainId && c.isTestnet === source.isTestnet)].map(c => `eip155:${c.chainId}`),
      methods: ['eth_sendTransaction', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'], events: ['chainChanged', 'accountsChanged'],
      rpcMap: Object.fromEntries(networks.map(c => [`eip155:${c.chainId}`, c.rpcEndpoints[0]])),
    } } });
    const cleanup = () => { void provider!.cleanupPendingPairings({ deletePairings: true }).catch(() => {}); if (provider!.session) void provider!.disconnect().catch(() => {}); };
    // abortPairingAttempt is a no-op in this release. Late approval is never
    // registered as accepted, regardless of whether relay teardown succeeds.
    void attempt.then(() => { if (cancelled) cleanup(); }).catch(() => {});
    try { await Promise.race([attempt, cancellation]); }
    catch (e) { cancelled = true; dialog.close(); cleanup(); throw e; }
    finally { clearTimeout(timer); provider.removeListener('display_uri', display); dialog.close(); }
  }
  if (!accountsFor(provider, source.chainId).length) {
    void provider.disconnect().catch(() => {});
    throw new Error(`Your wallet did not approve ${source.name}. Connect again with this network enabled.`);
  }
  provider.setDefaultChain(`eip155:${source.chainId}`);
  localStorage.setItem(key, prefix!);
  const result = ethereumSession(provider, source), disconnect = result.disconnect!;
  result.disconnect = async () => { if (localStorage.getItem(key) === prefix) localStorage.removeItem(key); await disconnect(); };
  return result;
}
