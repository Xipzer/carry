// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { getAddress, type Address, type EIP1193Provider } from 'viem';
import { chainConfig, type Network } from './chains';

export type Provider = Pick<EIP1193Provider, 'request'> & {
  on?: (name: string, fn: (...args: unknown[]) => void) => void;
  removeListener?: (name: string, fn: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
};
export interface WalletOption { id: string; name: string; provider: Provider; icon?: string }
export function walletIcon(value: unknown): string | undefined {
  // EIP-6963 supplies the wallet's own artwork as a data URI. Never inline its
  // SVG markup or fetch a tracking URL supplied by an extension announcement.
  if (typeof value !== 'string' || value.length > 256_000 || !/^data:image\/(?:png|jpeg|webp|svg\+xml)(?:;charset=utf-8)?(?:;base64)?,.+$/i.test(value)) return undefined;
  return value;
}
export async function discoverWallets(): Promise<WalletOption[]> {
  const found = new Map<string, WalletOption>();
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<{ info: { uuid: string; name: string; icon?: string }; provider: Provider }>).detail;
    if (detail?.provider && typeof detail.info?.uuid === 'string' && typeof detail.info.name === 'string') found.set(detail.info.uuid, { id: detail.info.uuid, name: detail.info.name, icon: walletIcon(detail.info.icon), provider: detail.provider });
  };
  window.addEventListener('eip6963:announceProvider', handler);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  await new Promise(r => setTimeout(r, 180));
  window.removeEventListener('eip6963:announceProvider', handler);
  const legacy = (window as Window & { ethereum?: Provider }).ethereum;
  if (!found.size && legacy) found.set('injected', { id: 'injected', name: 'Browser wallet', provider: legacy });
  return [...found.values()];
}
export async function connectProvider(provider: Provider): Promise<Address> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  if (!accounts[0]) throw new Error('No wallet account was selected.');
  return getAddress(accounts[0]);
}
export async function walletConnect(projectId: string, source: Network): Promise<Provider> {
  if (!/^[a-fA-F0-9]{32}$/.test(projectId)) throw new Error('WalletConnect needs a valid Reown project ID. Add it in Connection settings, or use a browser wallet.');
  const { connectWalletConnect } = await import('./walletconnect');
  return connectWalletConnect(projectId, source);
}
export async function ensureAccount(provider: Provider, expected: Address) {
  const accounts = await provider.request({ method: 'eth_accounts' });
  if (!accounts[0] || accounts[0].toLowerCase() !== expected.toLowerCase()) throw new Error('The connected account changed. Reconnect the wallet used for this action.');
}
export async function switchTo(provider: Provider, c: Network) {
  const hex = `0x${c.chainId.toString(16)}` as const;
  if (Number(await provider.request({ method: 'eth_chainId' })) === c.chainId) return;
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }); }
  catch (e) {
    const code = (e as { code?: number; data?: { originalError?: { code?: number } } });
    if (code.code !== 4902 && code.data?.originalError?.code !== 4902) throw e;
    const config = chainConfig(c);
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: hex, chainName: c.name, nativeCurrency: c.nativeCurrency,
      rpcUrls: c.rpcEndpoints, blockExplorerUrls: [config.blockExplorers.default.url] }] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  }
  if (Number(await provider.request({ method: 'eth_chainId' })) !== c.chainId) throw new Error('Your wallet did not switch networks. Please switch it manually and continue.');
}
