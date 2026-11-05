// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAddress } from 'viem';
import registry from '../src/cctp-networks.json' with { type: 'json' };
import { networks } from '../src/chains';

describe('dependency and deployment integrity', () => {
  it('does not reinstall the removed SDK/AppKit and vulnerable parser/crypto roots', () => {
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    for (const name of ['@circle-fin/bridge-kit', '@circle-fin/adapter-viem-v2', '@walletconnect/ethereum-provider', '@reown/appkit', 'zod', 'toml', 'stream-json', 'elliptic', 'uuid']) {
      expect(Object.keys(lock.packages).some(key => key.endsWith(`node_modules/${name}`)), name).toBe(false);
    }
    expect(lock.packages['node_modules/@walletconnect/universal-provider'].version).toBe('2.26.0');
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.overrides).toBeUndefined();
    for (const group of ['dependencies', 'devDependencies']) for (const [name, version] of Object.entries(manifest[group])) {
      expect(version, name).toMatch(/^\d+\.\d+\.\d+$/); expect(lock.packages[''][group][name]).toBe(version);
    }
  });
  it('keeps the reviewed deployment snapshot byte-for-byte intact', () => {
    expect(createHash('sha256').update(readFileSync('src/cctp-networks.json')).digest('hex')).toBe('2f76524a54456d1ee815e3cefec2a66ce1d82dde7427e50b85161502a6c22ad6');
    expect(registry.provenance.version).toBe('1.17.0'); expect(registry.networks).toHaveLength(50);
    for (const c of registry.networks) {
      expect([c.usdc, c.messenger, c.transmitter].every(a => isAddress(a, { strict: false }))).toBe(true);
      expect(c.rpc.every(u => new URL(u).protocol === 'https:')).toBe(true);
      expect(networks.find(n => n.chain === c.chain)?.chainId).toBe(c.id);
    }
  });
  it('ships the upstream deployment data licence and attribution', () => {
    const notice = readFileSync('public/legal/circle-Apache-2.0.txt', 'utf8');
    expect(notice).toContain('Apache License');
    expect(notice).toContain('Circle');
  });
});
