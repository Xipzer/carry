# Architecture

Carry is a client-only React app. A static host serves files; all chain and Circle requests come from the visitor's browser.

```text
Static host
    |
    v
Browser UI --------> Wallet extension / WalletConnect
    |                        |
    | read-only RPC          | explicit approval + burn
    v                        v
Source CCTP contracts -> Circle attestation
                              |
                  +-----------+-----------+
                  |                       |
             Convenience                 Manual
             Circle relayer        wallet signs receive
                  |                       |
                  +-----------+-----------+
                              v
                   Destination CCTP mint
                              |
                  verify usedNonces via RPC
```

## Modules

| File | Responsibility |
| --- | --- |
| `src/App.tsx` | Form, review, wallet and recovery screens |
| `src/bridge.ts` | Quote, guarded signing, send, receive and recovery |
| `src/fees.ts`, `src/gas.ts` | Integer fee accounting and gas budgets |
| `src/message.ts` | Bind Circle proof to the original on-chain message |
| `src/chains.ts`, `src/cctp-networks.json` | Reviewed networks and contracts |
| `src/model.ts` | Durable transfer records and cross-tab locks |
| `src/session.ts`, `src/tracking.ts` | Refresh restoration and read-only polling |
| `src/wallet*.ts`, `src/pairing.ts` | Wallet permissions and local pairing QR |
| `src/activity.tsx` | Status, export and receiving actions |

## Transaction boundary

Before each signature, validate account, chain, contract, native token, recipient, amount, fee cap and method. Simulate against deployed contracts. Persist the intent before requesting a signature, then persist its hash as soon as the wallet returns it.

An owner lock prevents concurrent source sends. A transfer lock prevents racing receive attempts. Recovery rereads durable state under the lock. An interrupted signature remains unresolved until reconciled; it is not permission to resend.

Source receipts must contain one compatible CCTP message. Attested fields must match it. Completion requires the destination MessageTransmitter's `usedNonces` state, not merely a successful API response.

## Storage and background work

`localStorage` holds transfer history, accepted-wallet metadata and theme. `sessionStorage` holds the current form and panel. Refresh never restores a signed review or prompts a wallet.

Polling checks unfinished sent transfers every 15 seconds while visible and online. Failures back off to two minutes. Focus, reconnection and operation completion trigger a fresh read. Polling never signs or submits transactions.

Storage and locks belong to one browser origin. Another device or hostname needs recovery details; there is no central account database.
