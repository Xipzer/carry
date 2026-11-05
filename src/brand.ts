// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import manifest from './brand-assets.json';
import type { Network } from './chains';

export const brandAssets = manifest.assets;
const transparentIcons: Record<string, string> = {
  Base: '/brand/networks/base-symbol.svg',
  ...Object.fromEntries(['Cronos', 'Polygon', 'Unichain', 'Unichain_Sepolia'].map(key => [key, `/brand/transparent/${key.toLowerCase()}.svg`])),
  ...Object.fromEntries(['Linea', 'Optimism', 'Pharos', 'Plume', 'XDC', 'X_Layer'].map(key => [key, `/brand/transparent/${key.toLowerCase()}.png`])),
};
const networkAssets = brandAssets.filter(asset => asset.kind === 'network').sort((a, b) => b.key.length - a.key.length);

export function networkBrand(chain: Network) {
  const asset = networkAssets.find(asset => chain.chain === asset.key || chain.chain.startsWith(asset.key + '_'));
  if (!asset) throw new Error(`Official artwork is missing for ${chain.name}. Add its approved original before enabling this network.`);
  return { ...asset, file: transparentIcons[asset.key] ?? asset.file };
}

export function brand(key: 'USDC' | 'WalletConnect') {
  const asset = brandAssets.find(asset => asset.key === key);
  if (!asset) throw new Error(`Official artwork is missing for ${key}.`);
  return asset;
}
