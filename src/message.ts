// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { getAddress, parseUnits, slice, size, zeroHash, type Address, type Hex } from 'viem';
import { contracts, network, networks, type Network } from './chains';
import { amountUnits, type Transfer } from './model';

const addr = (value: Hex) => {
  if (!/^0x0{24}/i.test(value)) throw new Error('A CCTP message address is not a padded EVM address.');
  return getAddress(`0x${value.slice(-40)}`);
};
export function decodeMessage(message: Hex) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(message) || size(message) < 376 || size(message) > 32_768) throw new Error('Unsupported CCTP message.');
  const n = (start: number, end: number) => BigInt(slice(message, start, end));
  if (n(0, 4) !== 1n || n(148, 152) !== 1n) throw new Error('Unsupported CCTP message version.');
  return {
    sourceDomain: Number(n(4, 8)), destinationDomain: Number(n(8, 12)), nonce: slice(message, 12, 44),
    sender: addr(slice(message, 44, 76)), receiver: addr(slice(message, 76, 108)), caller: slice(message, 108, 140),
    minFinality: Number(n(140, 144)), finality: Number(n(144, 148)), token: addr(slice(message, 152, 184)),
    recipient: addr(slice(message, 184, 216)), amount: n(216, 248), owner: addr(slice(message, 248, 280)),
    maxFee: n(280, 312), fee: n(312, 344), expiration: n(344, 376), hook: size(message) > 376 ? slice(message, 376) : '0x',
  };
}
export function validateMessage(message: Hex, source: Network, t?: Transfer) {
  const m = decodeMessage(message);
  const dest = networks.find(c => c.isTestnet === source.isTestnet && c.cctp.domain === m.destinationDomain);
  if (!dest || m.sourceDomain !== source.cctp.domain || m.sender.toLowerCase() !== contracts(source).messenger.toLowerCase() ||
      m.receiver.toLowerCase() !== contracts(dest).messenger.toLowerCase() || m.token.toLowerCase() !== source.usdcAddress.toLowerCase() || m.caller !== zeroHash) {
    throw new Error('The on-chain message is not a supported, permissionless native-USDC CCTP transfer.');
  }
  if (t && (dest.chain !== t.destination || m.amount !== amountUnits(t.amount) || m.recipient.toLowerCase() !== t.recipient.toLowerCase() || m.owner.toLowerCase() !== t.owner.toLowerCase() || m.maxFee > parseUnits(t.maxFee, 6))) {
    throw new Error('On-chain details do not match the saved transfer. Nothing will be signed. Recover using the original transaction hash.');
  }
  return { ...m, destination: dest };
}
export function matchAttestation(attested: Hex, original: Hex, t: Transfer) {
  attested = attested.toLowerCase() as Hex;
  original = original.toLowerCase() as Hex;
  const m = validateMessage(attested, network(t.source), t);
  // Circle fills nonce, executed finality, fee and expiration. All routing,
  // asset, owner, amount, max-fee and hook bytes must match the source event.
  if (slice(attested, 0, 12) !== slice(original, 0, 12) || slice(attested, 44, 144) !== slice(original, 44, 144) ||
      slice(attested, 148, 312) !== slice(original, 148, 312) || m.hook !== decodeMessage(original).hook ||
      m.nonce === zeroHash || m.fee > m.maxFee || m.fee >= m.amount || m.finality < m.minFinality) {
    throw new Error('Circle proof does not match the original burn or its fee limit. Nothing will be signed.');
  }
  return m;
}
export const FORWARD_HOOK: Hex = '0x636374702d666f72776172640000000000000000000000000000000000000000';
export const isForwardHook = (hook: string) => hook.toLowerCase() === FORWARD_HOOK;
export function address32(address: Address): Hex { return `0x${address.slice(2).padStart(64, '0')}`; }
