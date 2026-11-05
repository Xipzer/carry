# Working on Carry

Read README.md and docs/ARCHITECTURE.md first. This is a static wallet frontend, not a custody service.

## Set up and verify

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run verify
```

Use Node.js 24. The repository has no required private credentials. Keep `.env.local` untracked. Every `VITE_*` value is public in the built app.

## Change rules

- Keep changes narrow. Use existing components and design tokens.
- Keep copy short, factual and in plain English. Use ordinary hyphens, not typographic dashes.
- Preserve six-decimal integer accounting, exact approvals, fee caps, quote expiry and account checks.
- Never retry a source burn automatically. Recovery may receive an existing transfer, not send it again.
- Keep wallet prompts explicit. Background tracking is read-only.
- Treat contract addresses, message validation, gas estimates and dependencies as security-sensitive. Read CCTP_REGISTRY.md before changing them.
- Retain local progress, recovery hashes, accessibility and reduced-motion support.
- Do not replace official artwork with generated shapes. Keep its source and licence records.

## Deploy

Follow docs/DEPLOYMENT.md. Build with mainnet disabled unless the operator requests otherwise. Show the target account, project and public settings before deployment. Never create paid resources without approval.

Use mocked tests for wallet flows. Do not request private keys, send live funds, publish secrets, commit or push without the user's instruction. Report the changed files, checks run and any remaining limitations.
