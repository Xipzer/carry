// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, maxUint256, zeroHash, type Hex } from 'viem';
import { contracts, network } from '../src/chains';
import { messengerAbi, tokenAbi } from '../src/abi';
import { address32, FORWARD_HOOK } from '../src/message';
import { checkTransfer, estimateTransfer, finishTransfer, guardedProvider, quoteTransfer, refreshProof, startTransfer, storeRecovery, verifySourceTransaction } from '../src/bridge';
import { readTransfers, saveTransfer } from '../src/model';
import type { Provider } from '../src/wallet';
import { baseTransfer, BURN_HASH, lockManager, MemoryStorage, message, MINT_HASH, OWNER, RECIPIENT, sourceReceipt } from './fixtures';

const mocks = vi.hoisted(() => ({ source: {} as Record<string, ReturnType<typeof vi.fn>>, destination: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock('../src/chains', async original => ({ ...await original<object>(), client: (c: { chain: string }) => c.chain === 'Base' ? mocks.source : mocks.destination }));
const provider = (): Provider => ({ request: vi.fn(async ({ method }: { method: string }) => method === 'eth_chainId' ? '0x2105' : method === 'eth_sendTransaction' ? BURN_HASH : [OWNER]) as Provider['request'] });
function newIntent() { const { source, destination, amount, owner, recipient, speed, forward } = baseTransfer(); return { source, destination, amount, owner, recipient, speed, forward }; }
function burnData() { return encodeFunctionData({ abi: messengerAbi, functionName: 'depositForBurnWithHook', args: [100000000n, 0, address32(OWNER), network('Base').usdcAddress as Hex, zeroHash, 110000n, 2000, FORWARD_HOOK] }); }
beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage()); vi.stubGlobal('navigator', { locks: lockManager() });
  mocks.source = { getChainId: vi.fn(async () => 8453), getBytecode: vi.fn(async ({ address }) => [OWNER, RECIPIENT].includes(address) ? '0x' : '0x6000'),
    getBalance: vi.fn(async () => 10n ** 18n), getGasPrice: vi.fn(async () => 1000000000n),
    readContract: vi.fn(async ({ functionName }) => functionName === 'decimals' ? 6 : ['getL1Fee', 'getL1FeeUpperBound', 'getOperatorFee'].includes(functionName) ? 0n : 1000000000n), getTransactionReceipt: vi.fn(async () => sourceReceipt()) };
  mocks.destination = { getChainId: vi.fn(async () => 1), getBytecode: vi.fn(async ({ address }) => [OWNER, RECIPIENT].includes(address) ? '0x' : '0x6000'),
    readContract: vi.fn(async ({ functionName }) => functionName === 'decimals' ? 6 : 0n), getBalance: vi.fn(async () => 10n ** 18n), getBlockNumber: vi.fn(async () => 100n),
    getGasPrice: vi.fn(async () => 1000000000n), getTransactionReceipt: vi.fn(async () => { throw new Error('Transaction receipt could not be found'); }), simulateContract: vi.fn() };
  vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true,
    text: async () => JSON.stringify([{ finalityThreshold: 2000, minimumFee: 0, forwardFee: { high: '100000' } }]),
    json: async () => ({ messages: [{ status: 'complete', message: message(true), attestation: `0x${'11'.repeat(65)}` }] }) })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('preflight integration', () => {
  it('keeps new mainnet burns disabled without the explicit release opt-in', async () => {
    const p = provider(), q = await quoteTransfer(newIntent(), p);
    await expect(startTransfer(q, p, vi.fn())).rejects.toThrow('disabled'); expect(readTransfers()).toHaveLength(0);
  });
  it('quotes a conservative gas budget, bounded cap and minimum', async () => { const q = await quoteTransfer(baseTransfer(), provider()); expect(q.sourceGas).toBe(1300000000000000n); expect(q.maxFee).toBe('0.11'); expect(q.minimumReceived).toBe('99.89'); });
  it('blocks inadequate source gas before a burn', async () => { mocks.source.getBalance.mockResolvedValue(1n); await expect(quoteTransfer(baseTransfer(), provider())).rejects.toThrow('gas'); });
  it('does not require or read a destination native gas balance for convenience receiving', async () => {
    mocks.destination.getBalance.mockResolvedValue(0n);
    const q = await quoteTransfer(baseTransfer(), provider());
    expect(q.intent.forward).toBe(true); expect(q.destinationGas).toBe(0n);
    expect(mocks.destination.getBalance).not.toHaveBeenCalled();
  });
  it('blocks missing destination gas on manual routes', async () => { mocks.destination.getBalance.mockResolvedValue(0n); await expect(quoteTransfer({ ...baseTransfer(), forward: false }, provider())).rejects.toThrow('before starting'); });
  it('does not quote routes with incomplete fee responses', async () => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '[{"finalityThreshold":2000,"minimumFee":null}]' }))); await expect(quoteTransfer(baseTransfer(), provider())).rejects.toThrow('fee quote'); });
  it('rejects smart/delegated source wallets', async () => { mocks.source.getBytecode.mockResolvedValue('0xef0100'); await expect(quoteTransfer(baseTransfer(), provider())).rejects.toThrow('Smart accounts'); });
  it('blocks recognized protocol contracts as recipients', async () => { await expect(quoteTransfer({ ...baseTransfer(), recipient: network('Ethereum').usdcAddress as Hex }, provider())).rejects.toThrow('token or bridge contract'); });
  it('rejects a wallet account that changed', async () => { const p = { request: vi.fn(async () => [RECIPIENT]) } as unknown as Provider; await expect(quoteTransfer(baseTransfer(), p)).rejects.toThrow('account changed'); });
  it('separates protocol fees, relayer fees, expected receipt and fee-capped minimum', async () => {
    const q = await estimateTransfer(baseTransfer(), provider());
    expect(q.cctpFee).toBe('0'); expect(q.receivingFee).toBe('0.1'); expect(q.estimatedReceived).toBe('99.9'); expect(q.minimumReceived).toBe('99.89');
  });
  it('can estimate without gas while keeping sending preflight strict', async () => {
    mocks.source.getBalance.mockResolvedValue(0n);
    expect((await estimateTransfer(baseTransfer(), provider())).estimatedReceived).toBe('99.9');
    await expect(quoteTransfer(baseTransfer(), provider())).rejects.toThrow('gas');
  });
  it('does not request or deduct a relayer charge when manual receiving was selected', async () => {
    const q = await estimateTransfer({ ...baseTransfer(), forward: false }, provider());
    expect(q.receivingFee).toBe('0'); expect(q.estimatedReceived).toBe('100');
    expect(fetch).toHaveBeenCalledWith(expect.not.stringContaining('forward=true'), expect.anything());
  });
  it('quotes without any wallet request other than checking the selected account', async () => {
    const p = provider(); await estimateTransfer(baseTransfer(), p);
    expect(p.request).toHaveBeenCalledTimes(1); expect(p.request).toHaveBeenCalledWith({ method: 'eth_accounts' });
  });
  it('does not stamp old fee observations as fresh after slow gas requests', async () => {
    let now = 100000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.source.getGasPrice.mockImplementation(async () => { now = 220000; return 1000000000n; });
    expect((await estimateTransfer(baseTransfer(), provider())).createdAt).toBe(100000);
  });
  it('checks the actual source gas estimate before requesting a burn', async () => {
    vi.stubEnv('VITE_ENABLE_MAINNET_TRANSFERS', 'true');
    mocks.source.getBalance.mockResolvedValue(2000000000000000n);
    mocks.source.call = vi.fn(async () => ({})); mocks.source.estimateGas = vi.fn(async () => 5000000n);
    const p = provider(), q = await quoteTransfer(newIntent(), p);
    const result = await startTransfer(q, p, vi.fn());
    expect(result.error).toContain('gas changed'); expect(result.burnHash).toBeUndefined();
    expect(p.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
  });
  it('cannot submit a burn after the original reviewed quote expires during preflight', async () => {
    vi.stubEnv('VITE_ENABLE_MAINNET_TRANSFERS', 'true');
    let now = 100000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.source.call = vi.fn(async () => { now += 61000; return {}; }); mocks.source.estimateGas = vi.fn(async () => 100000n);
    const p = provider(), q = await quoteTransfer(newIntent(), p), result = await startTransfer(q, p, vi.fn());
    expect(result.error).toContain('expired'); expect(result.burnHash).toBeUndefined();
    expect(p.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'eth_sendTransaction' }));
  });
});
describe('signing constraints and durable intent', () => {
  it.each(['success', 'reverted', 'insufficient', 'unavailable'])('checks mined approval state with a lagging latest RPC: %s', async outcome => {
    vi.stubEnv('VITE_ENABLE_MAINNET_TRANSFERS', 'true');
    const originalRead = mocks.source.readContract.getMockImplementation() as (request: { functionName: string }) => Promise<unknown>;
    mocks.source.readContract.mockImplementation(async request => {
      if (request.functionName !== 'allowance') return originalRead(request);
      if (request.blockNumber === undefined) return 0n;
      expect(request.blockNumber).toBe(123n);
      if (outcome === 'unavailable') throw new Error('Requested block unavailable');
      return outcome === 'insufficient' ? 99999999n : 100000000n;
    });
    mocks.source.simulateContract = vi.fn(async request => ({ request }));
    mocks.source.estimateContractGas = vi.fn(async () => 60000n);
    mocks.source.waitForTransactionReceipt = vi.fn(async () => ({ ...sourceReceipt(), blockNumber: 123n, status: outcome === 'reverted' ? 'reverted' : 'success' }));
    mocks.source.call = vi.fn(async () => ({})); mocks.source.estimateGas = vi.fn(async () => 100000n);
    const p = provider(), q = await quoteTransfer(newIntent(), p);
    const result = await startTransfer(q, p, vi.fn());
    const submissions = vi.mocked(p.request as (args: { method: string }) => Promise<unknown>).mock.calls.filter(([args]) => args.method === 'eth_sendTransaction');
    expect(submissions).toHaveLength(outcome === 'success' ? 2 : 1);
    if (outcome === 'success') {
      expect(result.burnHash).toBe(BURN_HASH); expect(result.error).toBeUndefined();
      expect(mocks.source.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'allowance', blockNumber: 123n }));
    } else {
      expect(result.burnHash).toBeUndefined(); expect(result.sourceIntent).not.toBe(true);
      expect(result.error).toContain(outcome === 'reverted' ? 'approval reverted' : outcome === 'insufficient' ? 'below the transfer amount' : 'block unavailable');
      expect(mocks.source.call).not.toHaveBeenCalled();
    }
  });
  it('accepts only exact-amount approval to the official messenger', () => {
    const data = encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [contracts(network('Base')).messenger, 100000000n] });
    expect(verifySourceTransaction(baseTransfer(), network('Base').usdcAddress as Hex, data)).toBe('approve');
    const unlimited = encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [contracts(network('Base')).messenger, maxUint256] });
    expect(() => verifySourceTransaction(baseTransfer(), network('Base').usdcAddress as Hex, unlimited)).toThrow('exact');
  });
  it('matches the reviewed burn and refuses fee/recipient changes', () => { expect(verifySourceTransaction(baseTransfer(), contracts(network('Base')).messenger, burnData())).toBe('burn'); expect(() => verifySourceTransaction({ ...baseTransfer(), recipient: RECIPIENT }, contracts(network('Base')).messenger, burnData())).toThrow('reviewed'); });
  it('persists source intent before submission and hash immediately after', async () => {
    const t = { ...baseTransfer(), burnHash: undefined, sourceIntent: false }, p = provider();
    const request = p.request;
    p.request = vi.fn(async args => { if (args.method === 'eth_sendTransaction') expect(readTransfers()[0].sourceIntent).toBe(true); return request(args as never); }) as Provider['request'];
    const guard = guardedProvider(p, t, vi.fn());
    await guard.request({ method: 'eth_sendTransaction', params: [{ from: OWNER, to: contracts(network('Base')).messenger, data: burnData() }] });
    expect(readTransfers()[0].burnHash).toBe(BURN_HASH);
    await expect(guard.request({ method: 'eth_sendTransaction', params: [{ from: OWNER, to: contracts(network('Base')).messenger, data: burnData() }] })).rejects.toThrow('already requested');
  });
  it('never clears ambiguous source submission after an RPC error', async () => {
    const t = { ...baseTransfer(), burnHash: undefined, sourceIntent: false }, p = provider();
    p.request = vi.fn(async ({ method }) => { if (method === 'eth_sendTransaction') throw new Error('socket closed'); return method === 'eth_chainId' ? '0x2105' : [OWNER]; }) as Provider['request'];
    await expect(guardedProvider(p, t, vi.fn()).request({ method: 'eth_sendTransaction', params: [{ from: OWNER, to: contracts(network('Base')).messenger, data: burnData() }] })).rejects.toThrow();
    expect(t.sourceIntent).toBe(true);
  });
  it.each(['personal_sign', 'eth_signTypedData_v4', 'wallet_sendCalls', 'eth_sendRawTransaction'])('blocks %s', async method => { await expect(guardedProvider(provider(), baseTransfer(), vi.fn()).request({ method } as never)).rejects.toThrow('reviewed'); });
});
describe('proof and destination recovery', () => {
  it('verifies the actual source receipt and requires usedNonces to finish', async () => { expect((await checkTransfer(baseTransfer())).phase).toBe('ready'); mocks.destination.readContract.mockResolvedValue(1n); expect((await checkTransfer(baseTransfer())).phase).toBe('complete'); });
  it('rejects source-message/proof substitution', async () => { vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ messages: [{ status: 'complete', message: message(true, { recipient: RECIPIENT }), attestation: '0xab' }] }) }))); await expect(checkTransfer(baseTransfer())).rejects.toThrow('match'); });
  it('shows a genuinely pending attestation without asking for another burn', async () => { vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ messages: [] }) }))); expect((await checkTransfer(baseTransfer())).phase).toBe('attesting'); });
  it('never asks for a second mint while a previous hash is pending', async () => {
    const t = { ...baseTransfer(), mintHash: MINT_HASH, mintIntent: true }; saveTransfer(t);
    const p = provider(); expect((await finishTransfer(t, p, OWNER, vi.fn())).phase).toBe('mint-pending'); expect(mocks.destination.simulateContract).not.toHaveBeenCalled(); expect(p.request).not.toHaveBeenCalled();
  });
  it('blocks ambiguous receiving signatures with no returned hash', async () => { const t = { ...baseTransfer(), mintIntent: true }; expect((await finishTransfer(t, provider(), OWNER, vi.fn())).phase).toBe('attention'); expect(mocks.destination.simulateContract).not.toHaveBeenCalled(); });
  it('uses the newest stored mint hash instead of a stale tab copy', async () => { saveTransfer({ ...baseTransfer(), mintHash: MINT_HASH, mintIntent: true }); expect((await finishTransfer(baseTransfer(), provider(), OWNER, vi.fn())).phase).toBe('mint-pending'); });
  it('allows only the receiving step to retry after a proven destination revert', async () => { mocks.destination.getTransactionReceipt.mockResolvedValue({ status: 'reverted' }); const t = await checkTransfer({ ...baseTransfer(), mintHash: MINT_HASH, mintIntent: true }); expect(t.phase).toBe('ready'); expect(t.mintIntent).toBe(false); expect(t.failedMintHash).toBe(MINT_HASH); expect(t.burnHash).toBe(BURN_HASH); });
  it('fails closed on a successful destination tx with an unused nonce', async () => { mocks.destination.getTransactionReceipt.mockResolvedValue({ status: 'success' }); expect((await checkTransfer({ ...baseTransfer(), mintHash: MINT_HASH, mintIntent: true })).phase).toBe('mint-pending'); });
  it('requests re-attestation of an expired proof instead of a new source transfer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ messages: [{ status: 'complete', message: message(true, { expiration: 100n }), attestation: `0x${'11'.repeat(65)}` }] }) })));
    expect((await checkTransfer(baseTransfer())).error).toContain('proof expired');
    const updated = await refreshProof(baseTransfer(), vi.fn()); expect(updated.phase).toBe('attesting');
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/v2/reattest/'), expect.objectContaining({ method: 'POST' }));
  });
  it('recovery preserves receiving metadata written by a newer tab', async () => {
    saveTransfer({ ...baseTransfer(), mintHash: MINT_HASH, mintIntent: true });
    const t = await storeRecovery({ ...baseTransfer(), id: 'recovered' }, null, vi.fn()); expect(t.mintHash).toBe(MINT_HASH); expect(t.phase).toBe('mint-pending');
  });
  it('recovery attaches an unresolved source hash without creating another intent', async () => {
    saveTransfer({ ...baseTransfer(), burnHash: undefined, phase: 'attention' });
    const t = await storeRecovery({ ...baseTransfer(), id: 'recovered' }, 'test-transfer', vi.fn()); expect(t.id).toBe('test-transfer'); expect(readTransfers()).toHaveLength(1); expect(t.burnHash).toBe(BURN_HASH);
  });
});
