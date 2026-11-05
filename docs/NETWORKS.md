# Networks

The reviewed snapshot supports these EVM mainnets and a testnet counterpart for each. Automatic receiving is paid Circle forwarding. Manual receiving is available on every listed destination.

| Network | Chain ID | Automatic receiving |
| --- | ---: | :---: |
| Arbitrum | 42161 | Yes |
| Arc | 5042 | Yes |
| Avalanche | 43114 | Yes |
| Base | 8453 | Yes |
| Codex | 81224 | Yes |
| Cronos | 25 | No |
| EDGE | 3343 | Yes |
| Ethereum | 1 | Yes |
| HyperEVM | 999 | Yes |
| Injective | 1776 | No |
| Ink | 57073 | Yes |
| Linea | 59144 | Yes |
| Monad | 143 | Yes |
| Morph | 2818 | No |
| Optimism | 10 | Yes |
| Pharos | 1672 | No |
| Plasma | 9745 | No |
| Plume | 98866 | Yes |
| Polygon | 137 | Yes |
| Sei | 1329 | Yes |
| Sonic | 146 | Yes |
| Unichain | 130 | Yes |
| World Chain | 480 | Yes |
| XDC | 50 | Yes |
| X Layer | 196 | No |

Support is a registry entry, not a guarantee of live RPC availability. Carry verifies chain identity, native USDC and deployed contracts before sending. Source and destination must be in the same environment.

HyperEVM receives into the EVM wallet, not a HyperCore trading account. Use Hyperliquid's separate deposit flow afterwards.

The exact contracts, RPC defaults and testnet IDs are in [src/cctp-networks.json](../src/cctp-networks.json). Update them using [CCTP_REGISTRY.md](../CCTP_REGISTRY.md) and [Circle's supported-network reference](https://developers.circle.com/cctp/concepts/supported-chains-and-domains).
