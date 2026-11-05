// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import registry from './cctp-networks.json' with { type: 'json' };
import { createPublicClient, defineChain, fallback, http, type Address } from 'viem';

export interface Network {
  type: 'evm'; chain: string; name: string; chainId: number; isTestnet: boolean;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  usdcAddress: string; rpcEndpoints: string[]; explorerUrl: string;
  cctp: { domain: number; contracts: { v2: { type: 'split'; tokenMessenger: string; messageTransmitter: string } }; forwarderSupported: { destination: boolean } };
}
// Only reviewed deployment data is retained; no SDK code or live registry enters signing.
export const networks: Network[] = registry.networks.map(c => ({
  type: 'evm', chain: c.chain, name: c.name, chainId: c.id, isTestnet: c.testnet,
  nativeCurrency: c.currency, usdcAddress: c.usdc, rpcEndpoints: c.rpc, explorerUrl: c.explorer,
  cctp: { domain: c.domain, contracts: { v2: { type: 'split', tokenMessenger: c.messenger, messageTransmitter: c.transmitter } }, forwarderSupported: { destination: c.forward } },
}));
export const mainnets = networks.filter(c => !c.isTestnet);
const order = ['Base', 'Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Avalanche'];
export function listNetworks(testnet = false) {
  return networks.filter(c => c.isTestnet === testnet).sort((a, b) => {
    const ai = order.indexOf(a.chain), bi = order.indexOf(b.chain);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.name.localeCompare(b.name);
  });
}
export function network(id: string) {
  const c = networks.find(n => n.chain === id);
  if (!c) throw new Error('This network is not supported by Circle CCTP.');
  return c;
}
export function contracts(c: Network) {
  const v2 = c.cctp.contracts.v2;
  if (!v2 || v2.type !== 'split') throw new Error('This chain has no supported EVM CCTP deployment.');
  return { messenger: v2.tokenMessenger as Address, transmitter: v2.messageTransmitter as Address };
}
export const canForward = (c: Network) => c.cctp.forwarderSupported?.destination === true;
export function chainConfig(c: Network) {
  return defineChain({ id: c.chainId, name: c.name, nativeCurrency: c.nativeCurrency,
    rpcUrls: { default: { http: c.rpcEndpoints } },
    blockExplorers: { default: { name: `${c.name} explorer`, url: c.explorerUrl.split('/tx/')[0] } }, testnet: c.isTestnet });
}
export function client(c: Network) {
  let overrides: Record<string, string[]> = {};
  try { overrides = JSON.parse(import.meta.env.VITE_RPC_URLS || '{}'); } catch { /* Defaults remain usable. */ }
  const urls = overrides[c.chainId] ?? c.rpcEndpoints;
  if (!Array.isArray(urls) || !urls.length || urls.some(u => typeof u !== 'string' || !u.startsWith('https://'))) {
    throw new Error('Invalid public RPC configuration. HTTPS endpoints are required.');
  }
  return createPublicClient({ chain: chainConfig(c), transport: fallback(urls.map(u => http(u, { timeout: 15000, retryCount: 2 }))) });
}
export const explorer = (c: Network, hash: string) => c.explorerUrl.replace('{hash}', hash);
export const prettyName = (c: Network) => c.chain === 'Optimism' ? 'Optimism' : c.name.replace(' Mainnet', '');
export function duration(c: Network, speed: 'SLOW' | 'FAST') {
  if (speed === 'FAST') return 'Usually under a minute';
  if (c.chain.startsWith('Linea')) return '6-32 hours';
  if (c.chain.startsWith('Ink') || c.chain.startsWith('Morph')) return '20-30 minutes';
  if (['Arc', 'Avalanche', 'Cronos', 'HyperEVM', 'Injective', 'Monad', 'Pharos', 'Plasma', 'Polygon', 'Sei', 'Sonic', 'XDC'].some(n => c.chain === n || c.chain.startsWith(n + '_'))) return 'Usually under a minute';
  return '15-30 minutes';
}
