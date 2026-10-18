# Sample a rendered video at (scene, seconds-into-scene) points and build a labelled sheet.
# Usage: /usr/bin/python3 scripts/sync-check.py <project> <out.png> scene:dt:label ...
import sys, subprocess, json
from PIL import Image, ImageDraw
project, out, *checks = sys.argv[1:]
times = subprocess.run(['node', 'scripts/scene-times.mjs', project], capture_output=True, text=True).stdout
st = {l.split('\t')[0]: float(l.split('\t')[1]) for l in times.strip().splitlines()}
V = f'projects/{project}/out/{project}.mp4'
ims = []
for i, c in enumerate(checks):
    sc, dt, lab = c.split(':', 2)
    t = st[sc] + float(dt)
    f = f'/tmp/sync-{i:02d}.png'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-ss', f'{t:.2f}', '-i', V, '-frames:v', '1', '-vf', 'scale=640:-1', f])
    im = Image.open(f); d = ImageDraw.Draw(im); d.rectangle([0, 0, 360, 24], fill='white'); d.text((5, 5), f'{sc}+{dt} {lab}', fill='red'); ims.append(im)
w, h = ims[0].size; cols = 4; rows = (len(ims) + cols - 1) // cols
sh = Image.new('RGB', (w * cols, h * rows), 'white')
for i, im in enumerate(ims): sh.paste(im, ((i % cols) * w, (i // cols) * h))
sh.save(out)
