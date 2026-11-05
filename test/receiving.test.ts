// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { network } from '../src/chains';
import { fundingNetworks, initialReceivingMode, isHyperliquidDestination, receiveAutomatically, receivingRouteName } from '../src/receiving';

afterEach(() => vi.unstubAllEnvs());
describe('receiving route configuration', () => {
  it.each(['', 'manual', 'invalid'])('defaults to manual for %s', value => {
    vi.stubEnv('VITE_DEFAULT_RECEIVING', value); expect(initialReceivingMode()).toBe('manual');
  });
  it('accepts an explicit paid convenience default from the deployment', () => {
    vi.stubEnv('VITE_DEFAULT_RECEIVING', 'automatic'); expect(initialReceivingMode()).toBe('automatic');
  });
  it.each(['Arbitrum', 'HyperEVM'])('uses Circle forwarding for %s convenience receiving', id => {
    expect(receiveAutomatically('automatic', network(id))).toBe(true);
    expect(receiveAutomatically('manual', network(id))).toBe(false);
  });
  it('does not turn an unavailable convenience route into manual receiving', () => {
    expect(() => receiveAutomatically('automatic', network('Cronos'))).toThrow('Choose Manual');
    expect(receiveAutomatically('manual', network('Cronos'))).toBe(false);
  });
  it('keeps mainnet and testnet funding presets separate', () => {
    expect(fundingNetworks(false).map(c => c.chain)).toEqual(['Arbitrum', 'HyperEVM']);
    expect(fundingNetworks(true).map(c => c.chain)).toEqual(['Arbitrum_Sepolia', 'HyperEVM_Testnet']);
    expect(fundingNetworks(true).every(c => c.isTestnet)).toBe(true);
  });
  it('only offers the Hyperliquid handoff for supported mainnet wallet destinations', () => {
    expect(isHyperliquidDestination(network('Arbitrum'))).toBe(true);
    expect(isHyperliquidDestination(network('HyperEVM'))).toBe(true);
    expect(isHyperliquidDestination(network('Arbitrum_Sepolia'))).toBe(false);
    expect(isHyperliquidDestination(network('Ethereum'))).toBe(false);
  });
  it('names the immutable route saved on a transfer', () => {
    expect(receivingRouteName(true)).toBe('Convenience'); expect(receivingRouteName(false)).toBe('Manual');
  });
});
