// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import {
  createWalletClient, custom, decodeFunctionData, encodeFunctionData, formatUnits, parseEventLogs,
  parseUnits, zeroHash, type Address, type Hex,
} from 'viem';
import { chainConfig, client, contracts, network, type Network } from './chains';
import { messengerAbi, tokenAbi, transmitterAbi } from './abi';
import { address32, FORWARD_HOOK, isForwardHook, matchAttestation, validateMessage } from './message';
import {
  amountUnits, assertFreshQuote, exclusive, friendlyError, readTransfers, saveTransfer, storageAvailable,
  isRejection, isUnfinished, validateIntent, type FeeEstimate, type Intent, type Quote, type Transfer,
} from './model';
import { ensureAccount, switchTo, type Provider } from './wallet';
import { circleFees } from './fees';
import { gasBudget, gasLimit, GAS_FLOORS, RECEIVING_CALLDATA_BUDGET } from './gas';

export type Update = (t: Transfer) => void;
function publish(t: Transfer, update: Update) {
  // Keep hashes visible/exportable even if browser storage fills AFTER broadcast.
  update({ ...t });
  saveTransfer(t);
}
export async function balances(c: Network, address: Address) {
  const rpc = client(c);
  if (await rpc.getChainId() !== c.chainId) throw new Error('RPC network mismatch.');
  const [usdc, native] = await Promise.all([
    rpc.readContract({ address: c.usdcAddress as Address, abi: tokenAbi, functionName: 'balanceOf', args: [address] }),
    rpc.getBalance({ address }),
  ]);
  return { usdc, native };
}
export async function estimateTransfer(i: Intent, provider: Provider): Promise<FeeEstimate> {
  const createdAt = Date.now();
  validateIntent(i);
  await ensureAccount(provider, i.owner);
  const source = network(i.source), destination = network(i.destination);
  const fees = await circleFees(i);
  const args = [amountUnits(i.amount), destination.cctp.domain, address32(i.recipient), source.usdcAddress as Address, zeroHash,
    parseUnits(fees.maxFee, 6), i.speed === 'SLOW' ? 2000 : 1000] as const;
  const data = i.forward ? encodeFunctionData({ abi: messengerAbi, functionName: 'depositForBurnWithHook', args: [...args, FORWARD_HOOK] })
    : encodeFunctionData({ abi: messengerAbi, functionName: 'depositForBurn', args });
  const [sourceGas, destinationGas] = await Promise.all([
    gasBudget(source, [
      { to: source.usdcAddress as Address, data: encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [contracts(source).messenger, amountUnits(i.amount)] }), gas: GAS_FLOORS.approve },
      { to: contracts(source).messenger, data, gas: GAS_FLOORS.burn },
    ]),
    // The final proof does not exist yet. Budget a conservative calldata size;
    // receiving re-estimates the actual proof before asking for a signature.
    i.forward ? Promise.resolve(0n) : gasBudget(destination, [{ to: contracts(destination).transmitter, data: RECEIVING_CALLDATA_BUDGET, gas: GAS_FLOORS.mint }]),
  ]);
  return { intent: i, createdAt, ...fees, sourceGas, destinationGas,
    warnings: ['Gas shown is a conservative funding budget, not a fixed charge. Approval is included even if it can be skipped. Your wallet shows the final fee.'] };
}

export async function quoteTransfer(i: Intent, provider: Provider): Promise<Quote> {
  validateIntent(i); storageAvailable();
  await ensureAccount(provider, i.owner);
  const source = network(i.source), destination = network(i.destination), src = client(source), dst = client(destination);
  const [balance, sourceCode, destCode, decimals, messengerCode, transmitterCode, destinationId, destinationDecimals] = await Promise.all([
    balances(source, i.owner), src.getBytecode({ address: i.owner }), dst.getBytecode({ address: i.recipient }),
    src.readContract({ address: source.usdcAddress as Address, abi: tokenAbi, functionName: 'decimals' }),
    src.getBytecode({ address: contracts(source).messenger }), dst.getBytecode({ address: contracts(destination).transmitter }),
    dst.getChainId(), dst.readContract({ address: destination.usdcAddress as Address, abi: tokenAbi, functionName: 'decimals' }),
  ]);
  if (sourceCode && sourceCode !== '0x') throw new Error('Smart accounts and delegated accounts are not supported. Select a standard wallet account.');
  if (!messengerCode || messengerCode === '0x' || !transmitterCode || transmitterCode === '0x' || decimals !== 6 || destinationDecimals !== 6 || destinationId !== destination.chainId) throw new Error('This route could not be verified on-chain. Nothing will be sent.');
  if ([destination.usdcAddress, ...Object.values(contracts(destination))].some(a => a.toLowerCase() === i.recipient.toLowerCase())) throw new Error('Do not send to a token or bridge contract. Use a wallet address you control on the receiving network.');
  const units = amountUnits(i.amount);
  if (balance.usdc < units) throw new Error('Not enough native USDC on the sending network. Bridged USDC.e is a different token.');
  const estimate = await estimateTransfer(i, provider);
  const { sourceGas, destinationGas } = estimate;
  // Keep headroom for gas price changes and L2 data fees.
  const nativeTransfer = source.nativeCurrency.symbol === 'USDC' ? units * 10n ** 12n : 0n;
  if (balance.native < sourceGas * 3n / 2n + nativeTransfer) throw new Error(`Keep more ${source.nativeCurrency.symbol} on ${source.name} for gas${nativeTransfer ? ', or reduce the USDC amount' : ''}.`);
  if (!i.forward) {
    const native = await dst.getBalance({ address: i.owner });
    if (!destinationGas || native < destinationGas * 3n / 2n) throw new Error(`Add ${destination.nativeCurrency.symbol} to your connected wallet on ${destination.name} before starting. This destination requires a final wallet signature.`);
  }
  return { ...estimate, sourceBalance: balance.usdc, contractRecipient: Boolean(destCode && destCode !== '0x') };
}

export function verifySourceTransaction(t: Transfer, to: Address, data: Hex) {
  const source = network(t.source), dest = network(t.destination);
  const units = amountUnits(t.amount);
  if (to.toLowerCase() === source.usdcAddress.toLowerCase()) {
    const decoded = decodeFunctionData({ abi: tokenAbi, data });
    if (decoded.functionName !== 'approve' || decoded.args[0].toLowerCase() !== contracts(source).messenger.toLowerCase() || decoded.args[1] !== units) throw new Error('Unexpected token approval. Only the exact transfer amount can be approved to Circle.');
    return 'approve' as const;
  }
  if (to.toLowerCase() !== contracts(source).messenger.toLowerCase()) throw new Error('Unexpected transaction target.');
  const decoded = decodeFunctionData({ abi: messengerAbi, data });
  const args = decoded.args;
  if (args[0] !== units || args[1] !== dest.cctp.domain || args[2].toLowerCase() !== address32(t.recipient).toLowerCase() ||
      args[3].toLowerCase() !== source.usdcAddress.toLowerCase() || args[4] !== zeroHash || args[5] > parseUnits(t.maxFee, 6) ||
      args[6] !== (t.speed === 'SLOW' ? 2000 : 1000)) throw new Error('The wallet transaction differs from your reviewed transfer. Refresh the quote.');
  if (t.forward !== (decoded.functionName === 'depositForBurnWithHook') ||
      (decoded.functionName === 'depositForBurnWithHook' && !isForwardHook(decoded.args[7]))) throw new Error('Unexpected delivery instructions.');
  return 'burn' as const;
}

export function guardedProvider(provider: Provider, t: Transfer, update: Update): Provider {
  return { request: (async (args: { method: string; params?: unknown }) => {
    if (/^eth_sign|^personal_sign|^wallet_send|^eth_sendRawTransaction/.test(args.method)) throw new Error('Only reviewed CCTP transactions are allowed.');
    if (args.method !== 'eth_sendTransaction') return provider.request(args as Parameters<Provider['request']>[0]);
    await ensureAccount(provider, t.owner);
    const tx = (args.params as [{ from?: string; to?: Address; data?: Hex; value?: string; authorizationList?: unknown; calls?: unknown }])[0];
    if (!tx?.to || !tx.data || tx.from?.toLowerCase() !== t.owner.toLowerCase() || (tx.value && BigInt(tx.value) !== 0n) || tx.authorizationList || tx.calls) throw new Error('Unexpected signing account or native-token payment.');
    const id = Number(await provider.request({ method: 'eth_chainId' }));
    const source = network(t.source), dest = network(t.destination);
    let kind: 'approve' | 'burn' | 'mint';
    if (id === source.chainId) {
      kind = verifySourceTransaction(t, tx.to, tx.data);
      if (kind === 'burn' && (t.sourceIntent || t.burnHash)) throw new Error('A source transfer was already requested. Check or recover it; never send it twice.');
    } else if (id === dest.chainId && tx.to.toLowerCase() === contracts(dest).transmitter.toLowerCase()) {
      const decoded = decodeFunctionData({ abi: transmitterAbi, data: tx.data });
      if (decoded.functionName !== 'receiveMessage' || !t.burnHash) throw new Error('Unexpected destination action.');
      const original = await burnMessage(t);
      matchAttestation(decoded.args[0], original, t);
      kind = 'mint';
    } else throw new Error('The wallet is on the wrong signing network.');
    if (kind === 'burn') { t.sourceIntent = true; t.phase = 'source-signing'; }
    else if (kind === 'mint') { t.mintIntent = true; t.phase = 'mint-signing'; }
    else t.phase = 'approving';
    publish(t, update); // Persist intent BEFORE asking the wallet, not after mining.
    try {
      const hash = await provider.request(args as Parameters<Provider['request']>[0]) as Hex;
      if (!/^0x[\da-fA-F]{64}$/.test(hash)) throw new Error('Wallet returned an invalid transaction hash. Check its history before continuing.');
      if (kind === 'burn') { t.burnHash = hash; t.phase = 'source-pending'; }
      else if (kind === 'mint') { t.mintHash = hash; t.phase = 'mint-pending'; }
      else t.approvalHash = hash;
      publish(t, update);
      return hash;
    } catch (e) {
      if (isRejection(e)) {
        if (kind === 'burn') t.sourceIntent = false;
        if (kind === 'mint') t.mintIntent = false;
      }
      throw e;
    }
  }) as Provider['request'] };
}

export async function startTransfer(q: Quote, provider: Provider, update: Update) {
  validateIntent(q.intent);
  if (!network(q.intent.source).isTestnet && import.meta.env.VITE_ENABLE_MAINNET_TRANSFERS !== 'true') throw new Error('New mainnet transfers are disabled for this preview. Use testnet mode; existing mainnet transfers can still be recovered.');
  assertFreshQuote(q, q.intent);
  return exclusive(q.intent.owner, async () => {
    storageAvailable();
    if (readTransfers().some(t => t.owner.toLowerCase() === q.intent.owner.toLowerCase() && isUnfinished(t))) throw new Error('Finish your existing transfer before starting another.');
    await ensureAccount(provider, q.intent.owner);
    const t: Transfer = { ...q.intent, id: crypto.randomUUID(), phase: 'prepared', createdAt: Date.now(), maxFee: q.maxFee };
    publish(t, update);
    try {
      const source = network(t.source), destination = network(t.destination), rpc = client(source);
      await switchTo(provider, source);
      assertFreshQuote(q, t);
      const wallet = createWalletClient({ account: t.owner, chain: chainConfig(source), transport: custom(guardedProvider(provider, t, update), { retryCount: 0 }) });
      const allowance = await rpc.readContract({ address: source.usdcAddress as Address, abi: tokenAbi, functionName: 'allowance', args: [t.owner, contracts(source).messenger] });
      const units = amountUnits(t.amount);
      if (allowance < units) {
        const { request } = await rpc.simulateContract({ account: t.owner, address: source.usdcAddress as Address, abi: tokenAbi, functionName: 'approve', args: [contracts(source).messenger, units] });
        t.phase = 'approving'; publish(t, update);
        const approvalGas = gasLimit('approve', await rpc.estimateContractGas({ ...request, account: t.owner }));
        const approvalData = encodeFunctionData({ abi: tokenAbi, functionName: 'approve', args: [contracts(source).messenger, units] });
        const budget = await gasBudget(source, [{ to: source.usdcAddress as Address, data: approvalData, gas: approvalGas, includesDataGas: true }]);
        if (await rpc.getBalance({ address: t.owner }) < budget) throw new Error('Source gas changed. Add gas and review again. No USDC was sent.');
        assertFreshQuote(q, t);
        t.approvalHash = await wallet.writeContract({ ...request, gas: approvalGas });
        const receipt = await rpc.waitForTransactionReceipt({ hash: t.approvalHash, timeout: 120000, onReplaced: r => { t.approvalHash = r.transaction.hash; publish(t, update); } });
        if (receipt.status !== 'success') throw new Error('The approval reverted. No USDC was sent. Check wallet activity before trying again.');
        // A load-balanced RPC's "latest" can lag behind the mined receipt.
        // Verify allowance in the approval's block, never an older node's head.
        const approved = await rpc.readContract({ address: source.usdcAddress as Address, abi: tokenAbi, functionName: 'allowance', args: [t.owner, contracts(source).messenger], blockNumber: receipt.blockNumber });
        if (approved < units) throw new Error('The mined approval is below the transfer amount. No USDC was sent. Check the approved amount in your wallet.');
      }
      // Recheck balance, gas, issuer state and live fees after a slow approval.
      // The reviewed cap is immutable, even if a newer quote suggests more.
      const fresh = await quoteTransfer(q.intent, provider);
      if (parseUnits(fresh.fee, 6) > parseUnits(t.maxFee, 6)) throw new Error('The delivery fee increased beyond your approved limit. No USDC was sent. Dismiss this attempt and review a fresh quote.');
      if (fresh.contractRecipient && !q.contractRecipient) throw new Error('The receiving address became a contract after your review. No USDC was sent. Review that address again before proceeding.');
      await switchTo(provider, source);
      const args = [units, destination.cctp.domain, address32(t.recipient), source.usdcAddress as Address, zeroHash, parseUnits(t.maxFee, 6), t.speed === 'SLOW' ? 2000 : 1000] as const;
      const data = t.forward
        ? encodeFunctionData({ abi: messengerAbi, functionName: 'depositForBurnWithHook', args: [...args, FORWARD_HOOK] })
        : encodeFunctionData({ abi: messengerAbi, functionName: 'depositForBurn', args });
      await rpc.call({ account: t.owner, to: contracts(source).messenger, data });
      const gas = gasLimit('burn', await rpc.estimateGas({ account: t.owner, to: contracts(source).messenger, data }));
      const budget = await gasBudget(source, [{ to: contracts(source).messenger, data, gas, includesDataGas: true }]);
      const nativeTransfer = source.nativeCurrency.symbol === 'USDC' ? units * 10n ** 12n : 0n;
      if (await rpc.getBalance({ address: t.owner }) < budget + nativeTransfer) throw new Error('Source gas changed. Add gas and review again. No USDC was sent.');
      assertFreshQuote(q, t);
      assertFreshQuote(fresh, t);
      t.burnHash = await wallet.sendTransaction({ to: contracts(source).messenger, data, gas });
      let cancelled = false;
      const receipt = await rpc.waitForTransactionReceipt({ hash: t.burnHash, timeout: 120000, onReplaced: r => { t.burnHash = r.transaction.hash; cancelled = r.reason === 'cancelled'; publish(t, update); } });
      if (receipt.status !== 'success' || cancelled) {
        t.sourceFailed = true; t.phase = 'attention'; t.error = cancelled ? 'Your wallet cancelled the source transaction on-chain. No CCTP burn completed for this attempt. Gas may have been spent. You can dismiss it.' : 'The source transaction reverted. No USDC was burned. Gas may have been spent. You can dismiss this attempt.';
      } else return await syncTransfer(t, update);
    } catch (e) { t.error = friendlyError(e); if (!t.burnHash) t.phase = 'attention'; }
    if (t.burnHash) {
      // Another gas-paying wallet may already be finishing this burn. A source
      // timeout must not overwrite its newer receiving intent/hash.
      try {
        return await exclusive(`transfer:${t.source}:${t.burnHash}`, async () => {
          const latest = readTransfers().find(r => r.source === t.source && r.burnHash?.toLowerCase() === t.burnHash!.toLowerCase());
          if (latest && (latest.mintIntent || latest.mintHash || latest.phase === 'complete')) { update(latest); return latest; }
          publish(t, update); return t;
        });
      } catch (e) {
        if (!/another tab/.test((e as Error).message)) throw e;
        const latest = readTransfers().find(r => r.source === t.source && r.burnHash?.toLowerCase() === t.burnHash!.toLowerCase());
        update(latest ?? t); return latest ?? t;
      }
    }
    publish(t, update); return t;
  });
}

async function iris(path: string, testnet: boolean, method = 'GET'): Promise<unknown> {
  const host = testnet ? 'https://iris-api-sandbox.circle.com' : 'https://iris-api.circle.com';
  const response = await fetch(`${host}${path}`, { method, signal: AbortSignal.timeout(20000) });
  if (response.status === 404 && method === 'GET') return { messages: [] };
  if (!response.ok) throw new Error(`Circle service returned ${response.status}. Check again later; do not send again.`);
  return response.json();
}
export async function burnMessage(t: Transfer): Promise<Hex> {
  if (!t.burnHash) throw new Error('The source transaction hash is needed to recover this transfer.');
  const source = network(t.source), rpc = client(source);
  const receipt = await rpc.getTransactionReceipt({ hash: t.burnHash });
  if (receipt.status !== 'success') throw new Error('The source transaction reverted. USDC was not burned; gas may still have been spent.');
  const events = parseEventLogs({ abi: transmitterAbi, eventName: 'MessageSent', logs: receipt.logs.filter(l => l.address.toLowerCase() === contracts(source).transmitter.toLowerCase()) });
  if (events.length !== 1) throw new Error('This transaction does not contain exactly one supported CCTP message.');
  const message = events[0].args.message;
  const m = validateMessage(message, source, t);
  if (receipt.from.toLowerCase() !== m.owner.toLowerCase()) throw new Error('Unsupported source-account routing.');
  return message;
}
type Attestation = { message: Hex; attestation: Hex; eventNonce?: string };
async function attestationFor(t: Transfer, original: Hex): Promise<Attestation | undefined> {
  const response = await iris(`/v2/messages/${network(t.source).cctp.domain}?transactionHash=${t.burnHash}`, network(t.source).isTestnet) as { messages?: { status?: string; message?: string; attestation?: string; eventNonce?: string }[] };
  if (!Array.isArray(response.messages)) throw new Error('Unexpected Circle response. Please check again later.');
  const ready = response.messages.filter(m => m.status === 'complete' && typeof m.message === 'string' && typeof m.attestation === 'string');
  if (!ready.length) return undefined;
  if (ready.length !== 1) throw new Error('Ambiguous proof response. Nothing will be signed.');
  const a = ready[0] as Attestation;
  if (!/^0x(?:[\da-fA-F]{2})+$/.test(a.attestation) || a.attestation.length > 20_000) throw new Error('Invalid attestation response.');
  matchAttestation(a.message, original, t);
  return a;
}
async function used(t: Transfer, nonce: Hex) {
  const dest = network(t.destination);
  return client(dest).readContract({ address: contracts(dest).transmitter, abi: transmitterAbi, functionName: 'usedNonces', args: [nonce] });
}
export async function checkTransfer(t: Transfer): Promise<Transfer> {
  validateIntent(t);
  if (!t.burnHash) return { ...t, phase: 'attention', error: t.sourceIntent ? 'The wallet was interrupted before returning a source hash. Check its history and recover the transaction below. Do not send again.' : t.error };
  let original: Hex;
  try { original = await burnMessage(t); }
  catch (e) {
    if (/source transaction reverted/.test((e as Error).message)) return { ...t, sourceFailed: true, phase: 'attention', error: (e as Error).message };
    if (/not.*found|could not be found/i.test((e as Error).message)) return { ...t, phase: 'source-pending', error: 'The source transaction is still pending or was replaced. Check your wallet activity; recover with the replacement hash if needed.' };
    throw e;
  }
  const a = await attestationFor(t, original);
  if (!a) return { ...t, phase: 'attesting', error: undefined };
  const m = matchAttestation(a.message, original, t);
  if (await used(t, m.nonce) !== 0n) return { ...t, phase: 'complete', actualReceived: formatUnits(m.amount - m.fee, 6), error: undefined };
  if (t.mintHash) {
    try {
      const receipt = await client(network(t.destination)).getTransactionReceipt({ hash: t.mintHash });
      if (receipt.status === 'reverted') return { ...t, failedMintHash: t.mintHash, mintHash: undefined, mintIntent: false, phase: 'ready', error: 'The destination transaction reverted. Your source USDC must not be sent again. You can retry only the receiving step.' };
      return { ...t, phase: 'mint-pending', error: 'The destination transaction was mined. Waiting to verify the CCTP receipt; no additional signature is needed.' };
    } catch (e) {
      if (!/not.*found|could not be found/i.test((e as Error).message)) throw e;
      return { ...t, phase: 'mint-pending', error: 'A receiving transaction is already pending or was replaced. Check wallet activity before trying anything else.' };
    }
  }
  if (t.mintIntent) return { ...t, phase: 'attention', error: 'The receiving signature was interrupted before returning a hash. Add its destination transaction hash from wallet activity. A second mint will not be requested until this is resolved.' };
  if (m.expiration !== 0n && m.expiration <= await client(network(t.destination)).getBlockNumber()) {
    return { ...t, phase: 'attention', error: 'The fast-transfer proof expired. Select Refresh proof to request a finalized proof. Do not send USDC again.' };
  }
  return { ...t, phase: 'ready', error: undefined };
}

export async function syncTransfer(t: Transfer, update: Update): Promise<Transfer> {
  return exclusive(`transfer:${t.source}:${t.burnHash}`, async () => {
    const saved = readTransfers().find(r => r.id === t.id || (t.burnHash && r.source === t.source && r.burnHash?.toLowerCase() === t.burnHash.toLowerCase()));
    const checked = await checkTransfer(saved ?? t);
    publish(checked, update);
    return checked;
  });
}

export async function finishTransfer(t: Transfer, provider: Provider, caller: Address, update: Update) {
  return exclusive(`transfer:${t.source}:${t.burnHash}`, () => exclusive(caller, async () => {
    // Read the newest saved metadata while holding both locks; stale tabs must
    // not erase a pending mint hash or request a second signature.
    const saved = readTransfers().find(r => r.source === t.source && r.burnHash?.toLowerCase() === t.burnHash?.toLowerCase());
    const current = await checkTransfer(saved ?? t);
    if (current.phase === 'complete' || current.phase !== 'ready') { publish(current, update); return current; }
    const original = await burnMessage(current), proof = await attestationFor(current, original);
    if (!proof) throw new Error('The proof is not ready. Check again in a moment.');
    await ensureAccount(provider, caller);
    const destination = network(current.destination);
    await switchTo(provider, destination);
    const rpc = client(destination);
    const { request } = await rpc.simulateContract({ account: caller, address: contracts(destination).transmitter,
      abi: transmitterAbi, functionName: 'receiveMessage', args: [proof.message, proof.attestation] });
    const gas = gasLimit('mint', await rpc.estimateContractGas({ ...request, account: caller }));
    const data = encodeFunctionData({ abi: transmitterAbi, functionName: 'receiveMessage', args: [proof.message, proof.attestation] });
    const budget = await gasBudget(destination, [{ to: contracts(destination).transmitter, data, gas, includesDataGas: true }]);
    if (await rpc.getBalance({ address: caller }) < budget) throw new Error(`Add ${destination.nativeCurrency.symbol} on ${destination.name} to finish. Your USDC does not need to be sent again.`);
    try {
      await ensureAccount(provider, caller);
      if (Number(await provider.request({ method: 'eth_chainId' })) !== destination.chainId) throw new Error('Wallet network changed. Switch back to the destination network.');
      const wallet = createWalletClient({ account: caller, chain: chainConfig(destination), transport: custom(provider, { retryCount: 0 }) });
      current.mintIntent = true; current.phase = 'mint-signing'; publish(current, update);
      const hash = await wallet.writeContract({ ...request, gas });
      if (!/^0x[\da-fA-F]{64}$/.test(hash)) throw new Error('The wallet did not return a valid receiving hash. Check destination wallet activity before continuing.');
      current.mintHash = hash;
      current.phase = 'mint-pending'; publish(current, update);
      await rpc.waitForTransactionReceipt({ hash: current.mintHash, timeout: 120000, onReplaced: r => { current.mintHash = r.transaction.hash; publish(current, update); } });
      Object.assign(current, await checkTransfer(current));
    } catch (e) {
      if (isRejection(e)) { current.mintIntent = false; current.phase = 'ready'; }
      current.error = friendlyError(e);
    }
    publish(current, update); return current;
  }));
}

export async function attachMintHash(t: Transfer, hash: string, update: Update): Promise<Transfer> {
  return exclusive(`transfer:${t.source}:${t.burnHash}`, async () => {
  t = readTransfers().find(r => r.source === t.source && r.burnHash?.toLowerCase() === t.burnHash?.toLowerCase()) ?? t;
  if (!/^0x[\da-fA-F]{64}$/.test(hash)) throw new Error('Paste a valid destination transaction hash.');
  const destination = network(t.destination), tx = await client(destination).getTransaction({ hash: hash as Hex });
  if (tx.to?.toLowerCase() !== contracts(destination).transmitter.toLowerCase()) throw new Error('That transaction is not addressed to the destination CCTP contract.');
  const decoded = decodeFunctionData({ abi: transmitterAbi, data: tx.input });
  if (decoded.functionName !== 'receiveMessage') throw new Error('That is not a receiving transaction.');
  matchAttestation(decoded.args[0], await burnMessage(t), t);
  const checked = await checkTransfer({ ...t, mintHash: hash as Hex, mintIntent: true });
  publish(checked, update); return checked;
  });
}
export async function refreshProof(t: Transfer, update: Update) {
  return exclusive(`transfer:${t.source}:${t.burnHash}`, async () => {
  t = readTransfers().find(r => r.source === t.source && r.burnHash?.toLowerCase() === t.burnHash?.toLowerCase()) ?? t;
  const checked = await checkTransfer(t);
  if (checked.phase === 'complete' || checked.mintIntent || checked.mintHash) { publish(checked, update); return checked; }
  const original = await burnMessage(t), proof = await attestationFor(t, original);
  if (!proof) { publish(checked, update); return checked; }
  const m = matchAttestation(proof.message, original, t);
  await iris(`/v2/reattest/${encodeURIComponent(proof.eventNonce || m.nonce)}`, network(t.source).isTestnet, 'POST');
  const next = { ...t, phase: 'attesting' as const, error: 'A refreshed proof was requested. Check again after the source transaction is finalized.' };
  publish(next, update); return next;
  });
}
export async function recoverTransfer(source: Network, hash: string): Promise<Transfer> {
  if (!/^0x[\da-fA-F]{64}$/.test(hash)) throw new Error('Paste a valid source transaction hash (0x followed by 64 characters).');
  const receipt = await client(source).getTransactionReceipt({ hash: hash as Hex });
  if (receipt.status !== 'success') throw new Error('That source transaction did not succeed. No CCTP transfer can be recovered from it.');
  const events = parseEventLogs({ abi: transmitterAbi, eventName: 'MessageSent', logs: receipt.logs.filter(l => l.address.toLowerCase() === contracts(source).transmitter.toLowerCase()) });
  if (events.length !== 1) throw new Error('No single CCTP transfer was found. Check the source network and transaction hash.');
  const m = validateMessage(events[0].args.message, source);
  if (m.hook !== '0x' && !isForwardHook(m.hook)) throw new Error('This transfer uses custom hooks and needs its original application to recover it safely.');
  const t: Transfer = { id: `recover:${source.chainId}:${hash.toLowerCase()}`, source: source.chain, destination: m.destination.chain,
    owner: m.owner, recipient: m.recipient, amount: formatUnits(m.amount, 6), maxFee: formatUnits(m.maxFee, 6),
    speed: m.minFinality >= 2000 ? 'SLOW' : 'FAST', forward: isForwardHook(m.hook), burnHash: hash as Hex, sourceIntent: true,
    createdAt: Date.now(), phase: 'attesting' };
  validateIntent(t);
  // Validate the original sender as well, before saving or displaying success.
  await burnMessage(t);
  return checkTransfer(t);
}

export async function storeRecovery(recovered: Transfer, targetId: string | null, update: Update) {
  return exclusive(`transfer:${recovered.source}:${recovered.burnHash}`, async () => {
    const rows = readTransfers();
    const existing = rows.find(t => t.source === recovered.source && t.burnHash?.toLowerCase() === recovered.burnHash?.toLowerCase());
    if (existing) {
      const checked = await checkTransfer(existing); publish(checked, update); return checked;
    }
    const target = rows.find(t => t.id === targetId) ?? rows.find(t => !t.burnHash && t.sourceIntent && t.source === recovered.source && t.destination === recovered.destination && t.owner.toLowerCase() === recovered.owner.toLowerCase() && t.recipient.toLowerCase() === recovered.recipient.toLowerCase() && amountUnits(t.amount) === amountUnits(recovered.amount));
    if (target) {
      if (target.burnHash && target.burnHash.toLowerCase() !== recovered.burnHash?.toLowerCase()) throw new Error('This attempt already has a different source hash. Recover the other transfer separately.');
      if (target.source !== recovered.source || target.destination !== recovered.destination || target.recipient.toLowerCase() !== recovered.recipient.toLowerCase() || amountUnits(target.amount) !== amountUnits(recovered.amount) || target.owner.toLowerCase() !== recovered.owner.toLowerCase()) throw new Error('That transaction does not match this attempt. Check the source hash or recover it separately from Activity.');
      recovered = { ...recovered, id: target.id, createdAt: target.createdAt, mintHash: target.mintHash, mintIntent: target.mintIntent };
    }
    publish(recovered, update); return recovered;
  });
}
