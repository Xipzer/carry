// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { formatUnits } from 'viem';
import { canForward, network } from './chains';
import { amountUnits, type Intent } from './model';

const invalid = () => new Error('Invalid or incomplete Circle fee quote. Nothing will be sent.');
function decimal(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') throw invalid();
  const text = String(value);
  if (text.length > 24 || !/^\d+(?:\.\d{1,6})?$/.test(text)) throw invalid();
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
function minorUnits(value: unknown) {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isSafeInteger(value))) throw invalid();
  const text = String(value);
  if (!/^\d{1,20}$/.test(text)) throw invalid();
  return BigInt(text);
}
export function parseCircleFees(data: unknown, i: Intent) {
  if (!Array.isArray(data) || !data.length || data.length > 8) throw invalid();
  const finality = i.speed === 'SLOW' ? 2000 : 1000;
  const tiers = data.filter(t => t && typeof t === 'object' && t.finalityThreshold === finality);
  if (tiers.length !== 1) throw invalid();
  const tier = tiers[0], rate = decimal(tier.minimumFee), units = amountUnits(i.amount);
  // minimumFee is basis points, not USDC. Round UP to the next USDC minor unit.
  if (rate > 10_000n * 1_000_000n) throw invalid();
  const cctpFee = (units * rate + 9_999_999_999n) / 10_000_000_000n;
  // forwardFee.high already includes destination gas and Circle's service fee.
  const receivingFee = i.forward ? minorUnits(tier.forwardFee?.high) : 0n;
  const fee = cctpFee + receivingFee;
  const cap = fee === 0n ? 0n : fee + (fee / 10n > 10_000n ? fee / 10n : 10_000n);
  if (cap >= units) throw new Error('The amount is too small to cover receiving fees. Increase it or choose manual receiving.');
  return { fee: formatUnits(fee, 6), cctpFee: formatUnits(cctpFee, 6), receivingFee: formatUnits(receivingFee, 6),
    estimatedReceived: formatUnits(units - fee, 6), maxFee: formatUnits(cap, 6), minimumReceived: formatUnits(units - cap, 6) };
}
export async function circleFees(i: Intent) {
  const source = network(i.source), destination = network(i.destination);
  if (i.forward && !canForward(destination)) throw new Error('Automatic delivery is not available on this destination.');
  const host = source.isTestnet ? 'https://iris-api-sandbox.circle.com' : 'https://iris-api.circle.com';
  const response = await fetch(`${host}/v2/burn/USDC/fees/${source.cctp.domain}/${destination.cctp.domain}${i.forward ? '?forward=true' : ''}`, {
    signal: AbortSignal.timeout(15000), cache: 'no-store', credentials: 'omit', redirect: 'error',
  });
  if (!response.ok) throw new Error(`Circle fee quote returned ${response.status}. No transfer has started.`);
  const body = await response.text();
  if (body.length > 16_384) throw invalid();
  return parseCircleFees(JSON.parse(body), i);
}
