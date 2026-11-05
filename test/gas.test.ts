// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { network, networks } from '../src/chains';
import { feeProfile, GAS_FLOORS, gasBudget, gasLimit, RECEIVING_CALLDATA_BUDGET, type GasStep } from '../src/gas';
import { OWNER } from './fixtures';

const mocks = vi.hoisted(() => ({ rpc: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock('../src/chains', async original => ({ ...await original<object>(), client: () => mocks.rpc }));
const step: GasStep = { to: OWNER, data: '0xabcd', gas: GAS_FLOORS.burn };
beforeEach(() => { mocks.rpc = { getChainId: vi.fn(async () => 8453), getGasPrice: vi.fn(async () => 10n), readContract: vi.fn(async ({ functionName }) => functionName === 'getL1FeeUpperBound' || functionName === 'getL1Fee' ? 20n : 30n), request: vi.fn() }; });
describe('gas funding budget', () => {
  it('keeps quoting and submitted gas floors aligned and rounds headroom up', () => {
    expect(gasLimit('burn', 100000n)).toBe(500000n); expect(gasLimit('mint', 400001n)).toBe(500002n);
  });
  it('includes OP execution, L1 data and operator fees for every step', async () => {
    expect(await gasBudget(network('Base'), [step, step])).toBe(20000200n);
    expect(mocks.rpc.readContract).toHaveBeenCalledTimes(4);
  });
  it('does not infer a legacy operator formula from a single failed call', async () => {
    mocks.rpc.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === 'getOperatorFee') throw new Error('Method unavailable');
      return functionName === 'operatorFeeScalar' ? 3 : functionName === 'operatorFeeConstant' ? 4n : 20n;
    });
    await expect(gasBudget(network('Base'), [step])).rejects.toThrow('unavailable');
    expect(mocks.rpc.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: 'operatorFeeScalar' }));
  });
  it('cannot silently ignore unavailable data or operator fee RPCs', async () => {
    mocks.rpc.readContract.mockRejectedValue(new Error('RPC unavailable'));
    await expect(gasBudget(network('Base'), [step])).rejects.toThrow('unavailable');
  });
  it('includes Arbitrum L1 posting costs rather than quoting L2 execution alone', async () => {
    mocks.rpc.getChainId.mockResolvedValue(42161); mocks.rpc.readContract.mockResolvedValue([100n, 3n, 5n]);
    expect(await gasBudget(network('Arbitrum'), [step])).toBe(10000600n);
  });
  it.each(['Edge', 'Edge_Testnet'])('includes non-zero Nitro posting fees for %s', async id => {
    const c = network(id); mocks.rpc.getChainId.mockResolvedValue(c.chainId); mocks.rpc.readContract.mockResolvedValue([100n, 3n, 5n]);
    expect(feeProfile(c)).toBe('nitro'); expect(await gasBudget(c, [step])).toBe(10000600n);
    expect(mocks.rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'gasEstimateL1Component' }));
  });
  it('does not double-charge Nitro posting gas already included in a real estimate', async () => {
    mocks.rpc.getChainId.mockResolvedValue(42161);
    expect(await gasBudget(network('Arbitrum'), [{ ...step, includesDataGas: true }])).toBe(10000000n);
    expect(mocks.rpc.readContract).not.toHaveBeenCalled();
  });
  it('includes Morph L1 data fees and Plume posting costs', async () => {
    mocks.rpc.getChainId.mockResolvedValue(2818);
    expect(await gasBudget(network('Morph'), [step])).toBe(10000040n);
    expect(mocks.rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: '0x530000000000000000000000000000000000000f', functionName: 'getL1Fee' }));
    mocks.rpc.getChainId.mockResolvedValue(98866); mocks.rpc.readContract.mockResolvedValue([100n, 3n, 5n]);
    expect(await gasBudget(network('Plume'), [step])).toBe(10000600n);
  });
  it('uses OP upper bounds so compressible placeholders cannot underprice proof calldata', async () => {
    await gasBudget(network('Base'), [{ ...step, data: RECEIVING_CALLDATA_BUDGET }]);
    expect((RECEIVING_CALLDATA_BUDGET.length - 2) / 2).toBe(11000);
    expect(mocks.rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'getL1FeeUpperBound', args: [expect.any(BigInt)] }));
    expect(mocks.rpc.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: 'getL1Fee' }));
  });
  it('prices Linea data through a read-only override, never a transaction', async () => {
    mocks.rpc.getChainId.mockResolvedValue(59144);
    mocks.rpc.request.mockResolvedValue({ gasLimit: '0x5208', baseFeePerGas: '0x2', priorityFeePerGas: '0x14' });
    expect(await gasBudget(network('Linea'), [step])).toBe(22000000n);
    expect(mocks.rpc.request).toHaveBeenCalledWith({ method: 'linea_estimateGas', params: [{ to: OWNER, data: '0xabcd' }, { [OWNER]: { code: '0x00' } }] });
  });
  it('has explicit profiles for every retained deployment and rejects unknown fee families', () => {
    expect(networks.every(c => Boolean(feeProfile(c)))).toBe(true);
    expect(feeProfile(network('X_Layer'))).toBe('op'); expect(feeProfile(network('Plume_Testnet'))).toBe('nitro');
    const c = network('Base'); expect(() => feeProfile({ ...c, cctp: { ...c.cctp, domain: 999 } })).toThrow('not configured');
  });
  it('blocks a wrong-chain RPC and missing gas price', async () => {
    await expect(gasBudget(network('Ethereum'), [step])).rejects.toThrow('mismatch');
    mocks.rpc.getGasPrice.mockResolvedValue(0n);
    await expect(gasBudget(network('Base'), [step])).rejects.toThrow('unavailable');
  });
});
