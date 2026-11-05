# Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
"""Create transparent display variants; pinned official originals stay untouched.

Maintenance only: requires Pillow. SVG variants preserve the original path data.
"""
import json
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
assets = {a['key']: a for a in json.loads((ROOT / 'src/brand-assets.json').read_text())['assets']}
out = ROOT / 'public/brand/transparent'
out.mkdir(exist_ok=True)
ET.register_namespace('', 'http://www.w3.org/2000/svg')
for key, color in [('Cronos', '#4CDBFF'), ('Polygon', '#9955FF'), ('Unichain', '#EC21B8'), ('Unichain_Sepolia', '#EC21B8')]:
    root = ET.fromstring((ROOT / ('public' + assets[key]['file'])).read_bytes())
    for parent in root.iter():
        for child in list(parent):
            if child.tag.split('}')[-1] in ('rect', 'defs') or (key == 'Unichain_Sepolia' and child.get('stroke') == '#FDAFF0'):
                parent.remove(child)
    for node in root.iter():
        if node.tag.endswith('path'):
            if node.get('stroke'):
                node.set('stroke', color)
            else:
                node.set('fill', color)
        node.attrib.pop('clip-path', None)
    ET.ElementTree(root).write(out / f'{key.lower()}.svg', encoding='unicode')

# Remove only the known flat backing colours from these official app icons.
# Foreground masks are antialiased, and the original canvas/shape is retained.
for key in ['Linea', 'Optimism', 'Pharos', 'Plume', 'XDC', 'X_Layer']:
    im = Image.open(ROOT / ('public' + assets[key]['file'])).convert('RGBA')
    pixels = []
    for r, g, b, a in im.get_flattened_data():
        if key == 'Linea':
            alpha = max(0, min(1, (190 - g) / 160)); rgb = (112, 80, 255)
        elif key == 'Optimism':
            alpha = max(0, (min(g, b) - 12) / 243); rgb = (255, 32, 66)
        elif key == 'Pharos':
            alpha = max(0, (240 - min(r, g, b)) / 240); rgb = (72, 98, 255)
        elif key in ('Plume', 'X_Layer'):
            alpha = max(0, (min(r, g, b) - 150) / 105); rgb = (220, 220, 220)
        else:
            alpha = max(r, g, b) / 255; rgb = (107, 190, 185)
        pixels.append((*rgb, round(a * alpha)))
    im.putdata(pixels)
    if key in ('Plume', 'X_Layer'):
        bounds = im.getbbox()
        if bounds:
            mark = im.crop(bounds)
            mark.thumbnail((round(im.width * .8), round(im.height * .8)), Image.Resampling.LANCZOS)
            im = Image.new('RGBA', im.size)
            im.paste(mark, ((im.width - mark.width) // 2, (im.height - mark.height) // 2))
    im.save(out / f'{key.lower()}.png')
