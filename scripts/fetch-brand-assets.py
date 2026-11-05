#!/usr/bin/env python3
# Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
"""Fetch approved originals, or verify checked-in artwork without network access."""
import argparse
import concurrent.futures
import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'src/brand-assets.json'
MAX_DOWNLOAD = 60_000_000
MAX_ICON = 1_000_000


def sha(data):
    return hashlib.sha256(data).hexdigest()


def target_path(asset):
    relative = asset['file']
    if not re.fullmatch(r'/brand/(networks|tokens|wallets)/[a-z0-9-]+\.(svg|png|ico)', relative):
        raise ValueError('Unexpected asset path: ' + relative)
    return ROOT / 'public' / relative.lstrip('/')


def check_image(asset, data):
    if not 0 < len(data) <= MAX_ICON:
        raise ValueError('Invalid icon size: ' + asset['key'])
    suffix = target_path(asset).suffix
    if suffix == '.svg':
        text = data.decode('utf-8-sig')
        # Keep original bytes; reject active/external content rather than rewriting a logo.
        forbidden = r'<(?:script|foreignObject)\b|\bon\w+\s*=|<!ENTITY|@import|(?:href|src)\s*=\s*[\"\'](?:https?:|//)|url\(\s*[\"\']?(?:https?:|//)'
        if re.search(forbidden, text, re.I) or ET.fromstring(text).tag != '{http://www.w3.org/2000/svg}svg':
            raise ValueError('Unsafe or invalid SVG: ' + asset['key'])
    elif suffix == '.png' and not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Not an original PNG: ' + asset['key'])
    elif suffix == '.ico' and not data.startswith(b'\x00\x00\x01\x00'):
        raise ValueError('Not an original ICO: ' + asset['key'])


def download(url):
    if not url.startswith('https://'):
        raise ValueError('Only HTTPS sources are allowed.')
    request = urllib.request.Request(url, headers={'User-Agent': 'Carry-official-brand-assets/1.0'})
    with urllib.request.urlopen(request, timeout=45) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Source redirected outside HTTPS.')
        data = response.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError('Source exceeds archive download limit.')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--fetch', action='store_true', help='Re-fetch originals, requiring the pinned hashes to match.')
    mode.add_argument('--pin', action='store_true', help='Explicitly review/update the approved originals and their checksums.')
    mode.add_argument('--check', action='store_true', help='Verify existing files offline (default).')
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text())
    assets = manifest['assets']
    if len({a['key'] for a in assets}) != len(assets) or len({a['file'] for a in assets}) != len(assets):
        raise ValueError('Duplicate brand key or file.')
    sources = {}
    if args.fetch or args.pin:
        urls = list(dict.fromkeys(a['sourceUrl'] for a in assets))
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            sources = dict(zip(urls, pool.map(download, urls)))
    checked = []
    for asset in assets:
        path = target_path(asset)
        if args.fetch or args.pin:
            source = sources[asset['sourceUrl']]
            if 'archiveMember' in asset:
                archive_hash = sha(source)
                if not args.pin and asset.get('archiveSha256') != archive_hash:
                    raise ValueError('Source archive changed; review it before pinning: ' + asset['key'])
                with zipfile.ZipFile(io.BytesIO(source)) as archive:
                    info = archive.getinfo(asset['archiveMember'])
                    if info.file_size > MAX_ICON:
                        raise ValueError('Oversized archive member.')
                    data = archive.read(info)
                if args.pin:
                    asset['archiveSha256'] = archive_hash
            else:
                data = source
        else:
            data = path.read_bytes()
        check_image(asset, data)
        digest = sha(data)
        if args.pin:
            asset['sha256'] = digest
            asset['bytes'] = len(data)
        elif not asset.get('sha256') or asset['sha256'] != digest:
            raise ValueError('Artwork differs from the approved original: ' + asset['key'])
        checked.append((path, data))
    # Validate the full set before replacing any existing original.
    if args.fetch or args.pin:
        for path, data in checked:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
    if args.pin:
        manifest['retrievedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Verified {len(assets)} official assets ({sum(len(data) for _, data in checked):,} bytes).')


if __name__ == '__main__':
    main()
