# CCTP deployment data

`src/cctp-networks.json` is a data-only projection of `@circle-fin/bridge-kit@1.17.0/chains.mjs`, captured on 2026-11-04. It includes 25 EVM mainnets and 25 testnets: chain IDs, domains, USDC addresses, messenger/transmitter targets, RPCs, currencies, explorers and forwarding support. It contains no executable SDK code.

The snapshot records the original package's npm SHA-512 integrity and the source module's SHA-256. It is bundled locally, not fetched from a mutable URL at runtime. Changing a network or contract is a signing-critical change and requires reviewing the diff, provenance and regression tests.

## Updating

1. Download the intended version from the [official npm package](https://www.npmjs.com/package/@circle-fin/bridge-kit) in an isolated scratch directory, without lifecycle scripts. Check its integrity against the published registry metadata.
2. Compare the deployment data with [Circle's CCTP deployments](https://developers.circle.com/cctp/references/contract-addresses) and [native USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses). In particular, distinguish source/destination forwarding support and mainnet/testnet domains.
3. Review every changed field. Do not replace deployments using a wallet-provided RPC response or an unreviewed live registry. Preserve old deployment metadata needed for existing transfers.
4. Update the data, provenance and integrity regression test together. Run all tests, the dependency gate and a mainnet-disabled production build.

The snapshot is not a promise that every issuer deployment or public RPC remains available. Preflight verifies chain identity, six-decimal native USDC and deployed contract code before new burns. Existing transfers still require the original on-chain message and matching attestation.

## Upstream attribution

Deployment data: Copyright (c) 2026, Circle Internet Group, Inc. All rights reserved. Copyright 2025 Circle Internet Financial Limited. Apache-2.0.

Gas reservation floors in `src/gas.ts` are based on `@circle-fin/provider-cctp-v2@1.14.5`: 150,000 for approval, 500,000 for burn and 400,000 for receiving. They are conservative starting points, not maximum execution costs. Actual source and receiving submissions are simulated and estimated separately.

Fee families are explicitly mapped by CCTP domain, independently of display names. OP-family chains use the active oracle's `getL1FeeUpperBound` and `getOperatorFee`; an unavailable API fails quoting rather than selecting a guessed fork formula. Nitro chains include posting gas once, Morph uses its separate L1 oracle, and Linea uses its data-dependent estimation endpoint. The preliminary receiving payload budgets 11,000 non-secret high-entropy bytes, covering the proof-size limits currently accepted by Carry; the real proof is re-estimated before receiving.

Linea's quote-only call temporarily overrides the target code with STOP to obtain a conservative data-price recommendation without an approval or a proof. This override is never passed to an execution simulation or wallet. All actual approvals, burns and mints are checked against real contract code and state. Older oracle deployments or RPCs without the required methods can fail quoting; they must not silently become zero-fee estimates.

Fee references: [OP oracle implementation](https://github.com/ethereum-optimism/optimism/blob/develop/packages/contracts-bedrock/src/L2/GasPriceOracle.sol), [Morph transaction fees](https://docs.morph.network/docs/build-on-morph/build-on-morph/understand-transaction-cost-on-morph), [Nitro gas estimation](https://docs.arbitrum.io/arbitrum-essentials/how-to-estimate-gas), [Linea gas estimation and overrides](https://docs.linea.build/reference/apis/linea-api/linea-estimategas).

The complete licence and modification notice are distributed at [`public/legal/circle-Apache-2.0.txt`](./public/legal/circle-Apache-2.0.txt).
