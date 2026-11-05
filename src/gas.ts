// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { parseAbi, serializeTransaction, size, type Address, type Hex } from 'viem';
import { client, type Network } from './chains';

// Conservative reservation floors from Circle CCTP provider 1.14.5, not cost guarantees.
export const GAS_FLOORS = { approve: 150_000n, burn: 500_000n, mint: 400_000n };
export const gasLimit = (step: keyof typeof GAS_FLOORS, estimate: bigint) => {
  const buffered = (estimate * 5n + 3n) / 4n;
  return buffered > GAS_FLOORS[step] ? buffered : GAS_FLOORS[step];
};
// Explicit CCTP-domain profiles apply to both environments, including testnets
// whose labels do not share a simple suffix. Unknown deployments fail closed.
type FeeProfile = 'evm' | 'op' | 'nitro' | 'morph' | 'linea';
const profiles: Record<number, FeeProfile> = {
  0: 'evm', 1: 'evm', 2: 'op', 3: 'nitro', 6: 'op', 7: 'evm', 10: 'op', 11: 'linea', 12: 'op',
  13: 'evm', 14: 'op', 15: 'evm', 16: 'evm', 18: 'evm', 19: 'evm', 21: 'op', 22: 'nitro', 26: 'evm',
  28: 'nitro', 29: 'evm', 30: 'morph', 31: 'evm', 32: 'evm', 33: 'evm', 37: 'op',
};
export function feeProfile(c: Network) {
  const profile = profiles[c.cctp.domain];
  if (!profile) throw new Error('Complete gas pricing is not configured for this network. Nothing will be sent.');
  return profile;
}
const opOracle = '0x420000000000000000000000000000000000000F';
const oracleAbi = parseAbi(['function getL1Fee(bytes) view returns (uint256)', 'function getL1FeeUpperBound(uint256) view returns (uint256)', 'function getOperatorFee(uint256) view returns (uint256)']);
const arbAbi = parseAbi(['function gasEstimateL1Component(address,bool,bytes) view returns (uint64,uint256,uint256)']);
export interface GasStep { to: Address; data: Hex; gas: bigint; includesDataGas?: boolean }

// Unknown proof: budget the largest receive calldata allowed by current proof
// validation, with non-secret high-entropy bytes instead of compressible ff runs.
export const RECEIVING_CALLDATA_BUDGET: Hex = (() => {
  let state = 0x12345678, hex = '0x';
  for (let i = 0; i < 11_000; i++) { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; hex += (1 + ((state >>> 0) % 255)).toString(16).padStart(2, '0'); }
  return hex as Hex;
})();

export async function gasBudget(c: Network, steps: GasStep[]) {
  const rpc = client(c);
  if (await rpc.getChainId() !== c.chainId) throw new Error('RPC network mismatch. Gas could not be quoted.');
  const price = await rpc.getGasPrice();
  if (price <= 0n) throw new Error('The network gas price is unavailable. Refresh the quote.');
  const profile = feeProfile(c);
  const costs = await Promise.all(steps.map(async step => {
    const execution = step.gas * price;
    if (profile === 'evm') return execution;
    if (profile === 'linea') {
      // Only this READ-ONLY pricing call uses a STOP override. It avoids requiring
      // approval/proof/gas before quoting data-dependent prices. Actual source and
      // mint simulations always use real state and real contract code.
      const quote = await rpc.request({ method: 'linea_estimateGas', params: [{ to: step.to, data: step.data }, { [step.to]: { code: '0x00' } }] } as never) as { gasLimit: Hex; baseFeePerGas: Hex; priorityFeePerGas: Hex };
      const gas = BigInt(quote.gasLimit), totalPrice = BigInt(quote.baseFeePerGas) + BigInt(quote.priorityFeePerGas);
      if (gas <= 0n || totalPrice <= 0n) throw new Error('Linea gas pricing is unavailable. Nothing will be sent.');
      return (gas > step.gas ? gas : step.gas) * (totalPrice > price ? totalPrice : price);
    }
    if (profile === 'nitro') {
      // A real Nitro eth_estimateGas already contains posting gas; only static
      // pre-burn floors need its separate L1 component added.
      if (step.includesDataGas) return execution;
      const [gas, baseFee] = await rpc.readContract({ address: '0x00000000000000000000000000000000000000C8', abi: arbAbi,
        functionName: 'gasEstimateL1Component', args: [step.to, false, step.data] });
      return execution + gas * baseFee;
    }
    const serialized = serializeTransaction({ chainId: c.chainId, type: 'eip1559', to: step.to, data: step.data,
      gas: step.gas, maxFeePerGas: price * 2n, maxPriorityFeePerGas: price, nonce: 1 });
    if (profile === 'morph') {
      const l1 = await rpc.readContract({ address: '0x530000000000000000000000000000000000000f', abi: oracleAbi, functionName: 'getL1Fee', args: [serialized] });
      return execution + l1;
    }
    // Query the active oracle implementation, never guess Isthmus/Jovian rules
    // after a timeout. Older/incompatible oracle deployments fail the quote.
    const [l1, operator] = await Promise.all([
      rpc.readContract({ address: opOracle, abi: oracleAbi, functionName: 'getL1FeeUpperBound', args: [BigInt(size(serialized))] }),
      rpc.readContract({ address: opOracle, abi: oracleAbi, functionName: 'getOperatorFee', args: [step.gas] }),
    ]);
    return execution + l1 + operator;
  }));
  // Includes approval even when an allowance might make it unnecessary. Double
  // current gas/data prices for funding headroom; the wallet still shows final fees.
  return 2n * costs.reduce((a, b) => a + b, 0n);
}
