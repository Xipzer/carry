// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { brand, brandAssets, networkBrand } from '../src/brand';
import { networks, network } from '../src/chains';
import { ChainIcon, UsdcIcon, WalletConnectIcon } from '../src/components';
import { walletIcon } from '../src/wallet';

describe('official artwork coverage and provenance', () => {
  it('has a local original for every registered mainnet and testnet', () => {
    expect(networks).toHaveLength(50);
    for (const chain of networks) {
      const asset = networkBrand(chain);
      expect(asset.kind).toBe('network');
      expect(asset.file).toMatch(/^\/brand\/(networks|transparent)\/[a-z0-9_-]+\.(svg|png|ico)$/);
      expect(asset.sourcePage).toMatch(/^https:\/\//);
      expect(asset.sourceUrl).toMatch(/^https:\/\//);
    }
  });
  it('uses specific official testnet variants before inherited network branding', () => {
    expect(networkBrand(network('Unichain_Sepolia')).key).toBe('Unichain_Sepolia');
    expect(networkBrand(network('World_Chain_Sepolia')).key).toBe('World_Chain');
    expect(networkBrand(network('X_Layer_Testnet')).key).toBe('X_Layer');
    expect(networkBrand(network('Base_Sepolia')).key).toBe('Base');
  });
  it('pins every file byte-for-byte and includes source archive identity', () => {
    expect(brandAssets).toHaveLength(28);
    expect(new Set(brandAssets.map(a => a.file)).size).toBe(28);
    for (const asset of brandAssets) {
      const bytes = readFileSync(resolve('public', asset.file.slice(1)));
      expect(createHash('sha256').update(bytes).digest('hex'), asset.key).toBe(asset.sha256);
      expect(bytes.length).toBe(asset.bytes);
      if ('archiveMember' in asset) expect(asset.archiveSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
  it('renders real images, with no letter, dollar-sign or drawn-brand substitute', () => {
    for (const chain of networks) {
      const markup = renderToStaticMarkup(ChainIcon({ chain }));
      expect(markup).toContain(`<img src="${networkBrand(chain).file}"`);
      expect(markup).not.toContain('style=');
      expect(markup).not.toContain('<svg');
    }
    expect(renderToStaticMarkup(UsdcIcon())).toContain(`src="${brand('USDC').file}"`);
    expect(renderToStaticMarkup(UsdcIcon())).not.toContain('$');
    expect(renderToStaticMarkup(WalletConnectIcon())).toContain(`src="${brand('WalletConnect').file}"`);
  });
  it('requires explicit artwork when a new network is added', () => {
    expect(() => networkBrand({ ...network('Base'), chain: 'New_Unsupported_Chain' } as unknown as Parameters<typeof networkBrand>[0])).toThrow('Official artwork is missing');
  });
});

describe('wallet-supplied image metadata', () => {
  it('accepts bounded, isolated image data URIs from EIP-6963', () => {
    for (const uri of ['data:image/png;base64,aGVsbG8=', 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E', 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E']) expect(walletIcon(uri)).toBe(uri);
  });
  it('rejects tracking URLs, active documents and oversized metadata', () => {
    for (const uri of ['https://example.com/tracker.svg', 'javascript:alert(1)', 'data:text/html,<script>bad</script>', 'data:image/png;base64,' + 'a'.repeat(256000), undefined, {}]) expect(walletIcon(uri)).toBeUndefined();
  });
});
