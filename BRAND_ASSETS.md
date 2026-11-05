# Official brand artwork

Network, USDC and WalletConnect images are downloaded from official sources and stored locally. Carry's logo and navigation icons are separate from these brand assets.

## Where the files come from

[`src/brand-assets.json`](src/brand-assets.json) records each source page, download URL, ZIP member if applicable, byte length and SHA-256 checksum. The 28 images cover 25 network brands, their testnets, a Unichain testnet variant, USDC and WalletConnect.

Examples:

- **Base:** the UI uses the circular symbol from the [official pre-rebrand kit](https://github.com/base/brand-kit/blob/aff30a2e31907bfd0f51f90d52b8b513492b42ad/logo/symbol/Base_Symbol_Blue.svg). The newer Square export remains archived in the manifest.
- **USDC and Arc:** exact token/network-icon SVGs from [Circle's brand archives](https://www.circle.com/pressroom#brandkit).
- **Ethereum:** the purple diamond from [ethereum.org's approved assets](https://ethereum.org/en/assets/).
- **Codex, Injective, Monad and Unichain:** downloadable marks from their own brand kits.
- Other networks: the network's own published SVG or app/site icon, not an invented substitute. EDGE uses its operator [edgeX's official asset](https://pro.edgex.exchange/en-US/home), not the unrelated `edge.org` website.
- **WalletConnect:** the blue symbol published by the [official WalletConnect brand site](https://brand.walletconnect.com/).
- Installed browser wallets: use the wallet's own **EIP-6963 image metadata**, rendered as an isolated image, never inline SVG. Only bounded image data URIs are accepted; remote tracking URLs are not requested. Legacy wallets that do not announce artwork receive a neutral wallet utility icon, not an imitation of their brand. Provider-supplied artwork is not proof of a wallet's identity or trustworthiness.

## Rendering and availability

- Fixed images are served from `public/brand/` without third-party image requests.
- Pinned original bytes remain unchanged. The UI uses transparent display variants for rectangular app icons: original SVG paths with backing rectangles removed, or antialiased foreground masks from raster originals. These are derived presentations, not new official brand exports. `scripts/prepare-display-icons.py` reproduces them with Pillow; it is a maintenance tool, not a build dependency. Monochrome World/Plume/X Layer marks adapt to the theme, and Sei is brightened in dark mode for legibility.
- Both USDC token images render at 32 CSS pixels, following Circle's published token-logo minimum.
- Network wrappers are transparent in both themes. Circular network badges retain their native artwork; rectangular backing tiles are removed. Plume and X Layer display variants normalise excess canvas padding without stretching the marks.
- Testnets use their network's official brand unless the source publishes a dedicated approved variant. Network names and testnet mode remain explicit in the UI.
- Missing network artwork fails the coverage tests; there is no generated-logo fallback for a newly added chain.

## Verify or refresh

Python 3 is only needed for asset maintenance, not for running/building the frontend. No additional Python packages are required.

```sh
# Offline: confirm every checked-in file matches the approved original.
python3 scripts/fetch-brand-assets.py --check

# Re-download the exact approved versions; fail if any source has changed.
python3 scripts/fetch-brand-assets.py --fetch

# Explicit maintenance operation: review new sources/artwork, then update pins.
python3 scripts/fetch-brand-assets.py --pin
```

The fetcher reads only explicitly listed HTTPS sources, extracts only the specified ZIP member, limits download/member sizes, validates image formats and rejects SVG scripts, event handlers, external references and foreign objects. It does not execute downloaded code or change the artwork. Builds use local copies and never automatically adopt a rebrand or changed CDN file.

Artwork and trademarks remain subject to their owners' brand-use policies, including [Circle's policy](https://6778953.fs1.hubspotusercontent-na1.net/hubfs/6778953/CircleBrandUsePolicy.pdf). The files do not imply endorsement or grant a trademark license.
