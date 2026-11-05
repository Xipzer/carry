# Recovery

## Refresh or close the tab

Return to the same browser and hostname, then open Activity. Wallet restoration is silent if still authorised. Convenience receiving continues through Circle even with the tab closed.

## Use another device

Open **Recover an existing transfer**, select the source network and enter the source send hash. Use the burn transaction, not its token approval. No wallet is needed to check status. Manual receiving needs a wallet with destination gas; it cannot change the original recipient.

Download **Recovery details** before clearing browser storage or moving to a different hostname. Exports contain public addresses and transaction metadata, not keys. Treat them as private financial records when sharing.

## Common cases

| Situation | Action |
| --- | --- |
| Approval succeeded but send did not | Use **Review again**. A usable allowance is reused. |
| Source hash missing after a wallet interruption | Find the send in wallet activity and attach its hash. Do not send again. |
| Circle confirmation is pending | Wait for source finality. Status updates automatically. |
| Offline or rate-limited | Reads retry automatically. Return to the tab after connectivity recovers. |
| Convenience receiving is delayed | Wait, or open **Receiving taking longer?** for manual fallback. Destination gas is needed; the original fee still applies. |
| Manual receive reverted | Retry only receiving after the app reconciles its receipt. |
| Receiving hash missing | Attach the destination hash from wallet activity before attempting another receive. |
| WalletConnect unavailable | Configure a public Reown project ID and allowed origin, or use a browser wallet. |
| History cannot be read | Export what remains available. Recover using known source hashes in a clean browser. |

Never repeat the source burn because receiving is slow. Issuer restrictions, a wrong recipient or funds sent outside the supported CCTP flow need separate investigation.
