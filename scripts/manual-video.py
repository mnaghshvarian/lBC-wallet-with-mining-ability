#!/usr/bin/env python3
"""Builds the video manual from a recording made by apps/desktop/e2e/manual-videos.ts.

    python3 scripts/manual-video.py tts DIR     # speaks every caption (Kokoro) into DIR/narration, writes narration.json
    python3 scripts/manual-video.py build DIR   # DIR/manual.webm + timeline.json -> DIR/out/*.mp4, .srt, .vtt, .jpg

Needs ffmpeg (libx264, aac) and Pillow. The tts step needs kokoro-onnx with its model files
(kokoro-v1.0.onnx and voices-v1.0.bin) in KOKORO_DIR; without them, build makes silent videos
with the captions burned in, and holds each caption for a time that depends on its length.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

W, H, FPS = 1280, 820, 30
CARD_SECONDS = 3.2
SLIDE_PAD = 1.2  # seconds of silence after a slide's narration
root = Path(__file__).resolve().parent.parent

# The installation chapter is made of cards: installers show OS dialogs that cannot be recorded.
INSTALL = [
    ('Download',
     ['GitHub → mnaghshvarian / lBC-wallet-with-mining-ability → Releases',
      'Windows: LBC-Wallet-Setup-x64.exe',
      'Mac: LBC-Wallet-mac-arm64.dmg (Apple chip) or LBC-Wallet-mac-x64.dmg (Intel)',
      'Linux: lbc-wallet_amd64.deb, lbc-wallet.x86_64.rpm or LBC-Wallet-linux-x86_64.AppImage',
      'Android 7 or newer: LBC-Wallet-android.apk'],
     "Download LBC Wallet from the project's Releases page on GitHub: the Windows installer, the Mac disk image for your chip, a Linux package, or the Android APK. Download from nowhere else."),
    ('Check the download',
     ['Every release lists SHA-256 checksums (SHA256SUMS-*.txt)',
      'Compare the checksum of your file before installing',
      'The written manual shows how, on each system'],
     'Every release lists the SHA-256 checksum of each file. Compare it with your download before installing; the written manual shows how on each system.'),
    ('Windows',
     ['The installer is not code-signed yet',
      'Windows may say “Windows protected your PC”',
      'Click More info → Run anyway, then follow the installer'],
     'On Windows the installer is not code-signed yet, so Windows may warn you. Click More info, then Run anyway, and follow the installer.'),
    ('Mac',
     ['Open the .dmg and drag LBC Wallet to Applications',
      'If macOS refuses to open it:',
      'System Settings → Privacy & Security → Open Anyway'],
     'On a Mac, open the disk image and drag the app to Applications. If macOS refuses to open it, allow it under Privacy and Security, Open Anyway.'),
    ('Linux and Android',
     ['Linux: install the .deb or .rpm, or make the AppImage executable and run it',
      'Android: open the APK and allow installing from this source',
      'The phone app is a complete wallet of its own, and it can mine while charging'],
     'On Linux, install the deb or rpm package, or make the AppImage executable and run it. On Android, open the APK and allow installing from this source; the phone app is a complete wallet of its own.'),
]
INSTALL_TITLE = 'Installing LBC Wallet'


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def ffmpeg(*args):
    try:
        run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *args])
    except subprocess.CalledProcessError as err:
        sys.exit(f'ffmpeg failed: {err.stderr.decode(errors="replace")[-2000:]}')


def duration_of(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], check=True, capture_output=True, text=True).stdout
    return float(out.strip())


def slug(title):
    return re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')


def key(text):
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:16]


# ---------------------------------------------------------------- cards

def font(size, bold=False):
    from PIL import ImageFont
    for name in (['DejaVuSans-Bold.ttf'] if bold else ['DejaVuSans.ttf']):
        for base in ['/usr/share/fonts/truetype/dejavu', '/usr/share/fonts/dejavu', '/usr/share/fonts/TTF']:
            p = Path(base) / name
            if p.exists():
                return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def wrap(draw, text, fnt, width):
    words, lines, line = text.split(), [], ''
    for w in words:
        trial = f'{line} {w}'.strip()
        if draw.textlength(trial, font=fnt) <= width:
            line = trial
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def card(path, kicker, title, lines=()):
    from PIL import Image, ImageDraw
    img = Image.new('RGB', (W, H), '#0b1020')
    d = ImageDraw.Draw(img)
    # a soft band and the brand
    d.rectangle([0, 0, W, 6], fill='#2dd4a0')
    icon = root / 'apps' / 'desktop' / 'build' / 'icon.png'
    x = 96
    if icon.exists():
        try:
            im = Image.open(icon).convert('RGBA').resize((72, 72))
            img.paste(im, (x, 92), im)
            x += 92
        except Exception:
            pass
    d.text((x, 108), kicker, font=font(24), fill='#8fa3c7')
    y = 220
    for l in wrap(d, title, font(50, bold=True), W - 192):
        d.text((96, y), l, font=font(50, bold=True), fill='#ffffff')
        y += 66
    y += 18
    for l in lines:
        for i, part in enumerate(wrap(d, l, font(28), W - 240)):
            d.text((120 if i == 0 else 150, y), ('•  ' if i == 0 else '') + part, font=font(28), fill='#d6def0')
            y += 40
        y += 10
    d.text((96, H - 70), 'LBC Wallet · video manual · experimental, unaudited software — use at your own risk', font=font(20), fill='#5c6b8a')
    img.save(path)


def still(png, seconds, out):
    ffmpeg('-loop', '1', '-framerate', str(FPS), '-i', str(png), '-t', f'{seconds:.3f}', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-r', str(FPS), str(out))


def cut(webm, start, end, out):
    ffmpeg('-i', str(webm), '-ss', f'{start:.3f}', '-to', f'{end:.3f}', '-vf', f'fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-an', str(out))


def concat(parts, out):
    lst = out.with_suffix('.txt')
    lst.write_text(''.join(f"file '{p}'\n" for p in parts), encoding='utf-8')
    ffmpeg('-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(out))
    lst.unlink()


def add_audio(video, clips, out):
    """Mixes narration clips at their offsets (seconds) over silence as long as the video."""
    length = duration_of(video)
    args = ['-i', str(video), '-f', 'lavfi', '-t', f'{length:.3f}', '-i', 'anullsrc=r=24000:cl=mono']
    labels = ['[1]']
    filters = []
    for i, (path, offset) in enumerate(clips):
        args += ['-i', str(path)]
        ms = max(0, int(offset * 1000))
        filters.append(f'[{i + 2}]adelay={ms}|{ms}[a{i}]')
        labels.append(f'[a{i}]')
    filters.append(f'{"".join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first[mix]')
    ffmpeg(*args, '-filter_complex', ';'.join(filters), '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '112k', '-movflags', '+faststart', str(out))


def srt(path, entries):
    def ts(t):
        ms = int(round(t * 1000))
        return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'
    path.write_text(''.join(f'{i + 1}\n{ts(a)} --> {ts(b)}\n{text}\n\n' for i, (a, b, text) in enumerate(entries)), encoding='utf-8')


def vtt(path, entries):
    """The same subtitles as WebVTT, for a web page's <track>."""
    def ts(t):
        ms = int(round(t * 1000))
        return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}'
    path.write_text('WEBVTT\n\n' + ''.join(f'{ts(a)} --> {ts(b)}\n{text}\n\n' for a, b, text in entries), encoding='utf-8')


def poster(video, out):
    """A still of the chapter's title card, for a web page's poster."""
    ffmpeg('-ss', '0.5', '-i', str(video), '-frames:v', '1', '-q:v', '4', str(out))


# ---------------------------------------------------------------- steps

def tts(d):
    import soundfile as sf
    from kokoro_onnx import Kokoro
    model_dir = Path(os.environ.get('KOKORO_DIR', d))
    captions = json.loads((d / 'captions.json').read_text(encoding='utf-8'))
    texts = list(dict.fromkeys(captions + [n for _, _, n in INSTALL]))
    k = Kokoro(str(model_dir / 'kokoro-v1.0.onnx'), str(model_dir / 'voices-v1.0.bin'))
    out = d / 'narration'
    out.mkdir(exist_ok=True)
    durations = json.loads((d / 'narration.json').read_text(encoding='utf-8')) if (d / 'narration.json').exists() else {}
    for i, text in enumerate(texts):
        wav = out / f'{key(text)}.wav'
        if not wav.exists():
            samples, rate = k.create(text, voice=os.environ.get('KOKORO_VOICE', 'af_heart'), speed=1.0, lang='en-us')
            sf.write(str(wav), samples, rate)
        durations[text] = round(len(sf.read(str(wav))[0]) / sf.info(str(wav)).samplerate, 3)
        print(f'{i + 1}/{len(texts)} {durations[text]:5.1f} s  {text[:70]}')
    (d / 'narration.json').write_text(json.dumps(durations, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def build(d):
    timeline = json.loads((d / 'timeline.json').read_text(encoding='utf-8'))
    webm = d / 'manual.webm'
    total = duration_of(webm)
    narration = json.loads((d / 'narration.json').read_text(encoding='utf-8')) if (d / 'narration.json').exists() else {}
    out = d / 'out'
    work = d / 'work'
    out.mkdir(exist_ok=True)
    work.mkdir(exist_ok=True)

    def clip(text):
        wav = d / 'narration' / f'{key(text)}.wav'
        return wav if text in narration and wav.exists() else None

    chapters = []  # chapter files, in order
    subtitles = {}  # chapter file -> its subtitle entries

    # 0. installation, from cards
    parts, clips, entries, t = [], [], [], 0.0
    png = work / 'install-title.png'
    card(png, 'Chapter 0', INSTALL_TITLE)
    still(png, CARD_SECONDS, work / 'install-title.mp4')
    parts.append(work / 'install-title.mp4')
    t += CARD_SECONDS
    for i, (title, lines, text) in enumerate(INSTALL):
        png = work / f'install-{i}.png'
        card(png, INSTALL_TITLE, title, lines)
        seconds = (narration.get(text, 0.0) or max(5.0, 1.4 + len(text) * 0.052)) + SLIDE_PAD
        still(png, seconds, work / f'install-{i}.mp4')
        parts.append(work / f'install-{i}.mp4')
        if clip(text):
            clips.append((clip(text), t + 0.3))
        entries.append((t + 0.3, t + seconds, text))
        t += seconds
    concat(parts, work / 'install-video.mp4')
    add_audio(work / 'install-video.mp4', clips, out / '00-installing.mp4')
    srt(out / '00-installing.srt', entries)
    vtt(out / '00-installing.vtt', entries)
    poster(out / '00-installing.mp4', out / '00-installing.jpg')
    chapters.append(out / '00-installing.mp4')
    subtitles[out / '00-installing.mp4'] = entries
    print(f'00-installing.mp4  {t:.0f} s')

    # 1… the recorded chapters
    chs = timeline['chapters']
    for n, ch in enumerate(chs):
        start = max(0.0, ch['at'] - 0.4)
        end = chs[n + 1]['at'] - 0.4 if n + 1 < len(chs) else total
        name = f'{n + 1:02d}-{slug(ch["title"])}'
        png = work / f'{name}-card.png'
        card(png, f'Chapter {n + 1}', ch['title'])
        still(png, CARD_SECONDS, work / f'{name}-card.mp4')
        cut(webm, start, end, work / f'{name}-cut.mp4')
        concat([work / f'{name}-card.mp4', work / f'{name}-cut.mp4'], work / f'{name}-video.mp4')
        clips, entries = [], []
        for c in timeline['captions']:
            if start <= c['at'] < end:
                offset = CARD_SECONDS + (c['at'] - start) + 0.15
                if clip(c['text']):
                    clips.append((clip(c['text']), offset))
                entries.append((offset, offset + c['hold'], c['text']))
        add_audio(work / f'{name}-video.mp4', clips, out / f'{name}.mp4')
        srt(out / f'{name}.srt', entries)
        vtt(out / f'{name}.vtt', entries)
        poster(out / f'{name}.mp4', out / f'{name}.jpg')
        chapters.append(out / f'{name}.mp4')
        subtitles[out / f'{name}.mp4'] = entries
        print(f'{name}.mp4  {end - start + CARD_SECONDS:.0f} s, {len(clips)} narration clips')

    concat(chapters, out / 'LBC-Wallet-video-manual.mp4')
    # the same subtitles for the whole video, shifted by the chapters before them
    shifted, offset = [], 0.0
    for file in chapters:
        shifted += [(a + offset, b + offset, text) for a, b, text in subtitles[file]]
        offset += duration_of(file)
    srt(out / 'LBC-Wallet-video-manual.srt', shifted)
    vtt(out / 'LBC-Wallet-video-manual.vtt', shifted)
    print(f'LBC-Wallet-video-manual.mp4  {duration_of(out / "LBC-Wallet-video-manual.mp4"):.0f} s')


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ('tts', 'build'):
        sys.exit(__doc__)
    d = Path(sys.argv[2]).resolve()
    (tts if sys.argv[1] == 'tts' else build)(d)


if __name__ == '__main__':
    main()
