#!/usr/bin/env python3
"""Generates the Android launcher icons and splash screens from the desktop app icon.

    python3 apps/mobile/scripts/android-icons.py   (needs Pillow)
"""
import os
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SRC = os.path.join(ROOT, 'apps', 'desktop', 'build', 'icon.png')
RES = os.path.join(ROOT, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res')
BACKGROUND = (10, 15, 30, 255)  # --bg of the dark theme
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

icon = Image.open(SRC).convert('RGBA')


def fit(img, size):
    return img.resize((size, size), Image.LANCZOS)


def on_background(width, height, logo_size):
    canvas = Image.new('RGBA', (width, height), BACKGROUND)
    logo = fit(icon, logo_size)
    canvas.alpha_composite(logo, ((width - logo_size) // 2, (height - logo_size) // 2))
    return canvas.convert('RGB')


for density, scale in DENSITIES.items():
    folder = os.path.join(RES, f'mipmap-{density}')
    os.makedirs(folder, exist_ok=True)
    legacy = round(48 * scale)
    # Legacy icons: the logo on the app's dark background.
    square = on_background(legacy, legacy, round(legacy * 0.84))
    square.save(os.path.join(folder, 'ic_launcher.png'), optimize=True)
    mask = Image.new('L', (legacy, legacy), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).ellipse((0, 0, legacy - 1, legacy - 1), fill=255)
    round_icon = Image.new('RGBA', (legacy, legacy), (0, 0, 0, 0))
    round_icon.paste(on_background(legacy, legacy, round(legacy * 0.70)), (0, 0), mask)
    round_icon.save(os.path.join(folder, 'ic_launcher_round.png'), optimize=True)
    # Adaptive icon foreground: 108 dp canvas, logo inside the 66 dp safe zone.
    fg_size = round(108 * scale)
    foreground = Image.new('RGBA', (fg_size, fg_size), (0, 0, 0, 0))
    logo_size = round(64 * scale)
    foreground.alpha_composite(fit(icon, logo_size), ((fg_size - logo_size) // 2, (fg_size - logo_size) // 2))
    foreground.save(os.path.join(folder, 'ic_launcher_foreground.png'), optimize=True)

with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0A0F1E</color>\n</resources>\n')

# Splash screens keep their sizes; the logo takes a quarter of the short side.
for folder in sorted(os.listdir(RES)):
    path = os.path.join(RES, folder, 'splash.png')
    if folder.startswith('drawable') and os.path.exists(path):
        w, h = Image.open(path).size
        on_background(w, h, min(w, h) // 4).save(path, optimize=True)
print('icons and splash screens written to', RES)
