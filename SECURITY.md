# Security

## Reporting

Use [GitHub private vulnerability reporting](https://github.com/Xipzer/carry/security/advisories/new). Do not post exploitable details in a public issue. Include the affected commit, reproduction steps and expected impact. Use test data, not live credentials or private wallet records.

## Guarantees and limits

Carry holds no keys or funds and deploys no custom bridge contract. Wallet submissions are restricted to the reviewed CCTP targets and transfer intent. Approval amounts are exact, fee caps are fixed at review, and recovery never submits another source burn.

The frontend has not received a full independent security audit. Passing tests or a clean dependency scan does not prove it safe. It still trusts the deployed website, dependencies, wallet, RPC providers and Circle. Circle can pause or restrict USDC; contracts and issuers carry their own risks. A wrong recipient or compromised wallet cannot be repaired by this interface.

## Privacy

Carry adds no analytics or tracking backend. Settings and transfer records live in browser storage. RPC providers, Circle and WalletConnect can see requests and connection metadata. Public blockchains expose transfers. This is not a privacy tool.

No private keys or seed phrases are needed for setup, support or recovery. `VITE_*` settings and RPC URLs are visible to visitors. Use only browser-safe, origin-restricted credentials there.

## Public deployments

- Protect the GitHub and hosting accounts with strong authentication. Review changes before production deploys.
- Run the dependency gate on every release. CI scans Git history with checksum-pinned Gitleaks and uses pinned action revisions with read-only permissions.
- Use the supplied security headers. Keep HTML revalidated so fixes reach returning users.
- Use dedicated browser-safe RPC endpoints as traffic grows. Shared public RPCs can rate-limit; the app retries status reads and never responds by reburning.
- Restrict WalletConnect to your exact origin. Test mobile pairing on that origin before advertising it as supported.
- Monitor failed requests and provider quotas. Static hosting scales independently of RPC and Circle limits.

Source signing still needs wallet approval. Only read-only status monitoring runs unattended. A closed tab stops local polling; Circle's Convenience receiving can continue independently.
