// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { type Page } from '@playwright/test';
import { decodeFunctionData, encodeAbiParameters, toHex, type Hex } from 'viem';
import { contracts, networks, network } from '../../src/chains';
import { messengerAbi } from '../../src/abi';
import { baseTransfer, BURN_HASH, message, MINT_HASH, OWNER, sourceReceipt } from '../fixtures';

export async function mockServices(page: Page, options: { rejectBurn?: boolean; attested?: boolean; autoReceive?: boolean; noGas?: boolean; noDestinationGas?: boolean; feeResponse?: unknown; increasedFeeAfterApproval?: boolean; storage?: 'corrupt' | 'unavailable'; history?: boolean } = {}) {
  const sent: { to: string; data: string; chainId: number }[] = [];
  let approved = false, minted = false;
  const blockHash = `0x${'01'.repeat(32)}`;
  function burnDetails() {
    const tx = sent.find(tx => tx.chainId === 8453 && tx.to.toLowerCase() === contracts(network('Base')).messenger.toLowerCase());
    return tx ? decodeFunctionData({ abi: messengerAbi, data: tx.data as Hex }) : undefined;
  }
  function destination() {
    const burn = burnDetails();
    return burn ? networks.find(c => !c.isTestnet && c.cctp.domain === burn.args[1])! : network('Ethereum');
  }
  function transferMessage(attested = false) {
    const decoded = burnDetails();
    if (!decoded) return message(attested);
    return message(attested, { destination: destination().chain, amount: decoded.args[0], maxFee: decoded.args[5], fee: decoded.functionName === 'depositForBurnWithHook' ? 100000n : 0n,
      recipient: `0x${decoded.args[2].slice(-40)}`, hook: decoded.functionName === 'depositForBurnWithHook' ? decoded.args[7] : '0x' });
  }
  const receipts = (hash: string) => ({
    transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: '0x64', from: OWNER, to: hash === BURN_HASH ? contracts(network('Base')).messenger : hash === MINT_HASH ? contracts(destination()).transmitter : network('Base').usdcAddress,
    cumulativeGasUsed: '0x186a0', gasUsed: '0x186a0', contractAddress: null, logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x2',
    logs: hash === BURN_HASH ? sourceReceipt(transferMessage()).logs.map((l, i) => ({ ...l, transactionHash: hash, transactionIndex: '0x0', blockHash, blockNumber: '0x64', logIndex: toHex(i), removed: false })) : [],
  });
  const rpc = (method: string, params: any[], chainId: number): unknown => {
    switch (method) {
      case 'eth_chainId': return toHex(chainId);
      case 'eth_getBalance': return options.noGas || (options.noDestinationGas && chainId !== 8453) ? '0x0' : toHex(10n ** 20n);
      case 'eth_getCode': return params[0]?.toLowerCase() === OWNER.toLowerCase() ? '0x' : '0x6000';
      case 'eth_call': {
        if (params[0]?.to?.toLowerCase() === '0x00000000000000000000000000000000000000c8') return encodeAbiParameters([{ type: 'uint64' }, { type: 'uint256' }, { type: 'uint256' }], [1000n, 1000000000n, 10000000000n]);
        const data: string = params[0]?.data ?? '';
        if (data.startsWith('0x313ce567')) return toHex(6, { size: 32 });
        if (data.startsWith('0x70a08231')) return toHex(1000000000n, { size: 32 });
        if (data.startsWith('0xdd62ed3e')) return toHex(approved ? 1000000000n : 0n, { size: 32 });
        if (data.startsWith('0xfeb61724')) return toHex(minted || (options.autoReceive && options.attested && burnDetails()?.functionName === 'depositForBurnWithHook') ? 1 : 0, { size: 32 });
        return toHex(1, { size: 32 });
      }
      case 'eth_gasPrice': case 'eth_maxPriorityFeePerGas': return '0x3b9aca00';
      case 'eth_estimateGas': return '0x493e0';
      case 'eth_blockNumber': return '0x64';
      case 'eth_getTransactionCount': return '0x1';
      case 'eth_getBlockByNumber': return { number: '0x64', hash: blockHash, parentHash: blockHash, baseFeePerGas: '0x3b9aca00', gasLimit: '0x1c9c380', gasUsed: '0x10000', timestamp: '0x65000000', transactions: [], miner: OWNER, difficulty: '0x0', totalDifficulty: '0x0', size: '0x100', extraData: '0x', mixHash: blockHash, nonce: '0x0000000000000000', receiptsRoot: blockHash, sha3Uncles: blockHash, stateRoot: blockHash, transactionsRoot: blockHash, logsBloom: `0x${'00'.repeat(256)}` };
      case 'eth_getTransactionReceipt': return receipts(params[0]);
      case 'eth_getTransactionByHash': return { hash: params[0], blockHash, blockNumber: '0x64', transactionIndex: '0x0', from: OWNER, to: sent.at(-1)?.to ?? network('Base').usdcAddress, input: sent.at(-1)?.data ?? '0x', value: '0x0', nonce: '0x1', gas: '0x493e0', gasPrice: '0x3b9aca00', type: '0x2', chainId: toHex(chainId), r: blockHash, s: blockHash, v: '0x1c' };
      default: throw new Error(`Unmocked RPC method: ${method}`);
    }
  };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === '/__test__/wallet') {
      const tx = request.postDataJSON(); sent.push(tx);
      const approval = tx.data.startsWith('0x095ea7b3');
      if (approval) approved = true;
      else if (tx.chainId !== 8453 && tx.to.toLowerCase() === contracts(destination()).transmitter.toLowerCase()) minted = true;
      await route.fulfill({ json: { hash: approval ? `0x${'ef'.repeat(32)}` : minted ? MINT_HASH : BURN_HASH } }); return;
    }
    if (url.hostname.includes('circle.com')) {
      const high = options.increasedFeeAfterApproval && approved ? '1000000' : '100000';
      const json = url.pathname.includes('/fees/') ? options.feeResponse ?? [1000, 2000].map(finalityThreshold => ({ finalityThreshold, minimumFee: 0, forwardFee: { low: high, med: high, high } })) : { messages: options.attested ? [{ status: 'complete', message: transferMessage(true), attestation: `0x${'11'.repeat(65)}` }] : [] };
      await route.fulfill({ json, headers: { 'access-control-allow-origin': '*' } }); return;
    }
    if (request.method() === 'POST') {
      let data: any; try { data = request.postDataJSON(); } catch { /* Only JSON-RPC requests are permitted outside localhost. */ }
      if (data?.jsonrpc || Array.isArray(data)) {
        const c = networks.find(n => n.rpcEndpoints.some(u => new URL(u).host === url.host));
        const respond = (d: any) => ({ jsonrpc: '2.0', id: d.id, result: rpc(d.method, d.params ?? [], c?.chainId ?? 8453) });
        await route.fulfill({ json: Array.isArray(data) ? data.map(respond) : respond(data), headers: { 'access-control-allow-origin': '*' } }); return;
      }
    }
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') { await route.continue(); return; }
    // No real RPC, wallets, analytics or external APIs can escape this fixture.
    await route.abort('blockedbyclient');
  });
  await page.addInitScript(({ owner, rejectBurn, storage, history, transfer }) => {
    if (storage === 'corrupt') localStorage.setItem('carry.transfers.v1', '{broken');
    if (history) localStorage.setItem('carry.transfers.v1', JSON.stringify([transfer]));
    if (storage === 'unavailable') Storage.prototype.setItem = () => { throw new DOMException('Storage unavailable', 'QuotaExceededError'); };
    let chainId = 8453;
    const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      on(name: string, fn: (...args: unknown[]) => void) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name)!.add(fn); },
      removeListener(name: string, fn: (...args: unknown[]) => void) { handlers.get(name)?.delete(fn); },
      async request({ method, params }: { method: string; params?: any[] }): Promise<unknown> {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner];
        if (method === 'eth_chainId') return '0x' + chainId.toString(16);
        if (method === 'wallet_switchEthereumChain') { chainId = Number(params![0].chainId); handlers.get('chainChanged')?.forEach(fn => fn(params![0].chainId)); return null; }
        if (method === 'wallet_getCapabilities') return {};
        if (method === 'eth_sendTransaction') {
          const tx = params![0];
          if (rejectBurn && !tx.data.startsWith('0x095ea7b3')) throw Object.assign(new Error('User rejected'), { code: 4001 });
          return (await (await fetch('/__test__/wallet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...tx, chainId }) })).json()).hash;
        }
        throw new Error('Unexpected wallet request: ' + method);
      },
    };
    Object.assign(window, { ethereum: provider });
  }, { owner: OWNER, rejectBurn: options.rejectBurn, storage: options.storage, history: options.history, transfer: baseTransfer() });
  return { sent };
}
