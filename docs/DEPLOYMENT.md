# Deploy

Carry needs HTTPS static hosting, not a server or database. Vercel and Render both support this model. Free-plan limits and eligibility belong to the provider; check your account before creating a project.

## Configuration

Set these before building. Changing them requires a rebuild.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_ENABLE_MAINNET_TRANSFERS` | `false` | Allow new mainnet burns |
| `VITE_DEFAULT_RECEIVING` | `manual` | `automatic` for paid Circle receiving, otherwise `manual` |
| `VITE_WALLETCONNECT_PROJECT_ID` | Empty | Public Reown project ID; optional for browser wallets |
| `VITE_RPC_URLS` | Registry endpoints | JSON mapping chain IDs to public HTTPS RPC arrays |

Example browser-safe RPC override:

```json
{"8453":["https://mainnet.base.org"]}
```

Every `VITE_*` value is bundled publicly. Never put private keys, seed phrases, hosting tokens or server-only API keys in these settings.

## Vercel

1. Fork the repository. Import the fork as a Vercel project.
2. Select Node.js 24. The checked-in `vercel.json` sets installation, build output and response headers.
3. Add public settings above. Start with mainnet disabled.
4. Deploy. Add the exact hostname to your Reown project's allowed origins if using WalletConnect.

## Render

1. Fork the repository. Create a Blueprint from the fork.
2. Render reads `render.yaml` and creates a static site, without a paid compute instance.
3. Set public environment values in the dashboard and deploy. Allowlist the origin in Reown if needed.

Both configurations run tests and the zero-advisory dependency gate before building. The browser suite runs separately in GitHub Actions. Render waits for passing checks; on Vercel, protect the production branch and require CI before merging.

## Enable mainnet

Test approval, send, refresh and receive on the intended testnet routes. Verify injected wallets and any WalletConnect pairing on the final origin. Read SECURITY.md, then set `VITE_ENABLE_MAINNET_TRANSFERS=true` in production only and redeploy. Set `VITE_DEFAULT_RECEIVING=automatic` for the hands-off receiving flow.

For a local release build:

```sh
npm run build:mainnet
```

That command enables new mainnet sends for its build and runs the dependency gate. Upload only `dist/`. The source checkout and `.env.local` are not deployment artefacts.

## Operating at scale

Static assets use the host's CDN. The bottlenecks are RPC quotas, Circle availability and WalletConnect limits. Use public, origin-restricted RPC capacity sized for traffic; a live transfer can trigger several reads every 15 seconds. Do not put a secret RPC credential in the browser to solve rate limiting.

Headers block framing and third-party scripts. HTTPS and WSS connections remain allowed for configurable RPCs and WalletConnect. The policy therefore reduces script-injection risk, not the consequences of a compromised approved dependency. Test any stricter endpoint allowlist against all enabled networks.

Keep HTML uncached or revalidated. Hashed assets may be cached long-term. Preserve the same hostname when possible: transfer records are origin-scoped. Users moving to another deployment must export recovery details first.

References: [Vercel configuration](https://vercel.com/docs/project-configuration), [Render Blueprints](https://render.com/docs/blueprint-spec).
