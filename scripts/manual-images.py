#!/usr/bin/env python3
"""Builds the user manual's pictures and animations from the UI test screenshots.

    SCREENSHOT_DIR=... npm run test:ui -w lbc-wallet-desktop      # produces the screenshots
    python3 scripts/manual-images.py <screenshot dir>               # needs Pillow

Writes docs/manual/images/*.png and *.gif.
"""
import os
import sys
from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('SCREENSHOT_DIR', 'apps/desktop/e2e/screenshots')
root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
out = os.path.join(root, 'docs', 'manual', 'images')
os.makedirs(out, exist_ok=True)

PICTURES = {
    'disclaimer': '00-disclaimer', 'welcome': '01-welcome', 'restore-phrase': '02-restore-phrase',
    'restore-found': '03-restore-detected', 'overview': '04-overview', 'receive': '05-receive',
    'activity': '06-activity', 'create-phrase': '07-create-phrase', 'create-verify': '08-create-verify',
    'send': '09-send', 'send-review': '10-send-review', 'send-done': '11-send-done', 'tx-detail': '12-tx-detail',
    'mining': '13-mining', 'mining-idle': '13b-mining-idle', 'node': '14-node', 'node-running': '15-node-running',
    'solo-mining': '15b-solo-mining', 'settings-general': '16-settings-general', 'settings-network': '17-settings-network',
    'settings-security': '18-settings-security', 'settings-about': '19-settings-about', 'overview-fa': '21-overview-fa',
    'phone-overview': '25-phone-overview', 'phone-receive': '26-phone-receive', 'phone-send': '27-phone-send',
    'phone-more': '28-phone-more', 'phone-overview-fa': '23-phone-overview-fa',
}
ANIMATIONS = {
    'restore': (['01-welcome', '02-restore-phrase', '03-restore-detected', '04-overview'], 1800),
    'create': (['01-welcome', '07-create-phrase', '08-create-verify'], 2000),
    'send': (['09-send', '10-send-review', '11-send-done', '12-tx-detail'], 1800),
    'mining': ([f'anim-mining-{i}' for i in range(6)], 700),
    'node': (['14-node', '15-node-running', '15b-solo-mining'], 2200),
    'languages': (['20-overview-after', '21-overview-fa'], 1800),
}


def load(name):
    return Image.open(os.path.join(src, f'{name}.png')).convert('RGB')


for target, name in PICTURES.items():
    img = load(name)
    # 256 colours keeps the flat UI crisp and the files small.
    img.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(out, f'{target}.png'), optimize=True)

for target, (frames, ms) in ANIMATIONS.items():
    images = [load(f) for f in frames]
    scale = 960 / images[0].width if images[0].width > 960 else 1
    images = [i.resize((round(i.width * scale), round(i.height * scale)), Image.LANCZOS) for i in images]
    palette = images[0].quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    frames_p = [i.quantize(palette=palette, dither=Image.Dither.NONE) for i in images]
    frames_p[0].save(os.path.join(out, f'{target}.gif'), save_all=True, append_images=frames_p[1:], duration=ms, loop=0, optimize=True)

total = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
print(f'{len(os.listdir(out))} files, {total / 1e6:.1f} MB in {out}')
