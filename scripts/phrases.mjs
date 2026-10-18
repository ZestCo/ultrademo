// Print the speech segments (start-end, seconds) of each narration line in a
// project, so clip actions can be pinned to the words they belong to.
// Usage: node scripts/phrases.mjs <project> [sceneId ...]
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const [project, ...only] = process.argv.slice(2);
const dir = path.resolve('projects', project, 'assets');
const sb = JSON.parse(readFileSync(path.join(dir, 'storyboard.json'), 'utf8'));
for (const s of sb.scenes) {
  if (only.length && !only.includes(s.id)) continue;
  if (!s.audio) continue;
  const log = spawnSync('ffmpeg', ['-hide_banner', '-i', path.join(dir, s.audio), '-af', 'silencedetect=noise=-35dB:d=0.15', '-f', 'null', '-'], {encoding: 'utf8'}).stderr;
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map((m) => +m[1]);
  const dur = s.audioDuration;
  // speech = gaps between silences
  const segs = [];
  let cur = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] > cur + 0.05) segs.push([cur, starts[i]]);
    cur = ends[i] ?? dur;
  }
  if (cur < dur - 0.05) segs.push([cur, dur]);
  console.log(`${s.id} (${dur}s, clip ${s.clipDuration ?? '-'}): ${s.script}`);
  console.log('   ' + segs.map(([a, b]) => `${a.toFixed(2)}-${b.toFixed(2)}`).join('  '));
}
