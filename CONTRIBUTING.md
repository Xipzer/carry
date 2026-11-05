# Contributing

Use Node.js 24. Follow the README setup, then run `npm run verify`. Browser tests also need `npx playwright install chromium`.

Keep pull requests focused. Explain what changes, why, and how you checked it. Include before/after screenshots for UI changes in both themes and at mobile width.

- Follow the surrounding TypeScript and CSS conventions.
- Add regression coverage for transaction, persistence or recovery changes.
- Use integer USDC arithmetic. Never round through JavaScript floating-point amounts.
- Keep dependencies pinned; commit the lockfile with version changes.
- Preserve upstream notices and original artwork files.
- Keep documentation concise. Explain behaviour, not development history.

Report exploitable issues through the private channel in SECURITY.md. Never include seed phrases, credentials, personal wallet history or browser storage dumps in an issue.
