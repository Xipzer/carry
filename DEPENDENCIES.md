# Dependencies

Runtime: React, Viem, WalletConnect UniversalProvider, QRCode and Lucide. Versions are pinned in `package.json` and `package-lock.json`.

```sh
npm ci --ignore-scripts
npm run check:dependencies
```

The gate checks the installed tree, exact version pins, and full and production npm audits. Any known advisory or failed audit blocks release. It does not measure unknown vulnerabilities or replace a security review.

Dependency lifecycle scripts are disabled in `.npmrc`. Application scripts still run through `npm run`.

Circle contract data is a checked-in snapshot, not an executable SDK dependency. See CCTP_REGISTRY.md for provenance and update rules. Keep upstream licence notices when updating it.
