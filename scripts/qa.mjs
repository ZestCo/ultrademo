// Automatic QA for a rendered project: checks the finished MP4 and its
// storyboard for problems a reviewer would otherwise have to spot by eye, and
// builds a contact sheet (one frame per scene) for the human/visual pass.
//
// Usage: npm run qa -- <project> [--target 1:30]
// Writes projects/<project>/out/qa.json and out/qa-sheet.jpg; exits 1 on a fail.
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const project = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--target');
const targetArg = args.includes('--target') ? args[args.indexOf('--target') + 1] : null;
if (!project) {
  console.error('Usage: npm run qa -- <project> [--target m:ss]');
  process.exit(1);
}

const dir = path.resolve('projects', project);
const assets = path.join(dir, 'assets');
const out = path.join(dir, 'out');
const video = path.join(out, `${project}.mp4`);
const checks = [];
const add = (check, status, detail) => checks.push({check, status, detail});

const seconds = (s) => {
  if (s == null) return null;
  const [m, sec] = String(s).includes(':') ? String(s).split(':') : [0, s];
  return Number(m) * 60 + Number(sec);
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const probe = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
// ffmpeg filter log (stderr) for a detect filter
const detect = (file, filter, extra = []) =>
  spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, ...extra, '-af', filter, '-f', 'null', '-'], {encoding: 'utf8'})
    .stderr;
const vdetect = (file, filter) =>
  spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', filter, '-an', '-f', 'null', '-'], {encoding: 'utf8'})
    .stderr;

if (!existsSync(video)) {
  add('render', 'fail', `no render at out/${project}.mp4 - run npm run render -- ${project}`);
  finish();
}
const sb = JSON.parse(readFileSync(path.join(assets, 'storyboard.json'), 'utf8'));
const duration = probe(video);
add('render', 'pass', `${fmt(duration)} (${duration.toFixed(1)}s)`);

// Length against the target from the batch file (or --target)
const target = seconds(targetArg);
if (target) {
  const off = (duration - target) / target;
  add('length', Math.abs(off) > 0.25 ? 'warn' : 'pass', `${fmt(duration)} vs target ${fmt(target)} (${off >= 0 ? '+' : ''}${Math.round(off * 100)}%)`);
}

// Narration: every scripted unit voiced; karaoke timings present if captions use them
const units = [
  ...(sb.intro?.script ? [['intro-slide', sb.intro]] : []),
  ...sb.scenes.map((s) => [s.id, s]),
  ...(sb.outro?.script ? [['outro-slide', sb.outro]] : []),
];
const unvoiced = units.filter(([, u]) => u.script && !u.audioDuration).map(([id]) => id);
add('narration', unvoiced.length ? 'fail' : 'pass', unvoiced.length ? `no audio for ${unvoiced.join(', ')} - run npm run tts` : `${units.length} lines voiced`);
if (sb.caption?.highlight) {
  const noWords = units.filter(([, u]) => u.script && !u.words?.length).map(([id]) => id);
  add('captions', noWords.length ? 'warn' : 'pass', noWords.length ? `static (no word timings) on ${noWords.join(', ')}` : `word timings on every line (${sb.caption.highlight})`);
}

// Dead air: a clip that runs well past its narration (the renderer speeds clips
// up to 1.3x before it lets them overrun)
const deadAir = sb.scenes
  .filter((s) => s.clipDuration && s.audioDuration)
  .map((s) => [s.id, s.clipDuration / 1.3 + 0.4 - (s.audioDuration + 0.7)])
  .filter(([, extra]) => extra > 3);
add('dead air', deadAir.length ? 'warn' : 'pass', deadAir.length ? deadAir.map(([id, x]) => `${id} +${x.toFixed(1)}s without narration`).join('; ') : 'clips fit their narration');

// Frozen recordings (a tab that stopped painting mid-clip)
const frozen = [];
for (const s of sb.scenes.filter((x) => x.clip)) {
  const file = path.join(assets, s.clip);
  if (!existsSync(file)) continue;
  const len = probe(file);
  const log = vdetect(file, 'freezedetect=n=0.003:d=3');
  const fStarts = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const fEnds = [...log.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  // a freeze that lasts to the end of the clip never logs an end
  fStarts.forEach((start, i) => {
    const dur = (fEnds[i] ?? len) - start;
    if (start < len * 0.8) frozen.push(`${s.id} froze ${dur.toFixed(1)}s at ${start.toFixed(1)}s`);
  });
}
add('frozen clips', frozen.length ? 'warn' : 'pass', frozen.length ? frozen.join('; ') : 'no clip froze mid-action');

// Black frames, ignoring the fade in/out at the very start and end
const blacks = [...vdetect(video, 'blackdetect=d=1:pix_th=0.05').matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)]
  .map((m) => [Number(m[1]), Number(m[2])])
  .filter(([a, b]) => a > 1 && b < duration - 1);
add('black frames', blacks.length ? 'warn' : 'pass', blacks.length ? blacks.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}s`).join(', ') : 'none');

// Audio: long silences and levels
const silences = [...detect(video, 'silencedetect=noise=-45dB:d=4', ['-vn']).matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_duration: ([\d.]+)/g)]
  .map((m) => [Number(m[1]), Number(m[2])])
  .filter(([a]) => a > 1 && a < duration - 5);
add('silence', silences.length ? 'warn' : 'pass', silences.length ? silences.map(([a, d]) => `${d.toFixed(1)}s at ${fmt(a)}`).join(', ') : 'no gap over 4s');
const vol = detect(video, 'volumedetect', ['-vn']);
const peak = Number(/max_volume: (-?[\d.]+)/.exec(vol)?.[1]);
const mean = Number(/mean_volume: (-?[\d.]+)/.exec(vol)?.[1]);
add('levels', peak > -0.5 || mean < -35 ? 'warn' : 'pass', `peak ${peak} dB, mean ${mean} dB${peak > -0.5 ? ' (may clip)' : ''}${mean < -35 ? ' (quiet)' : ''}`);

// Contact sheet: one frame from the middle of each scene, in order
const starts = spawnSync('node', ['scripts/scene-times.mjs', project], {encoding: 'utf8'})
  .stdout.trim()
  .split('\n')
  .filter(Boolean)
  .map((l) => Number(l.split('\t')[1]));
const tmp = path.join(out, 'qa-frames');
rmSync(tmp, {recursive: true, force: true});
mkdirSync(tmp, {recursive: true});
const times = starts.map((t, i) => (t + (starts[i + 1] ?? Math.min(duration, t + 8))) / 2);
times.forEach((t, i) =>
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-1', path.join(tmp, `f${String(i).padStart(2, '0')}.png`)]),
);
const sheet = path.join(out, 'qa-sheet.jpg');
if (times.length) {
  const cols = Math.min(4, times.length);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(tmp, 'f%02d.png'),
    '-vf', `tile=${cols}x${Math.ceil(times.length / cols)}:padding=6:color=white`, '-frames:v', '1', '-q:v', '3', sheet]);
}
rmSync(tmp, {recursive: true, force: true});
add('contact sheet', 'pass', `out/qa-sheet.jpg (${times.length} scenes, in order) - check it for real names, secrets and wrong screens`);

finish();

function finish() {
  const status = checks.some((c) => c.status === 'fail') ? 'fail' : checks.some((c) => c.status === 'warn') ? 'warn' : 'pass';
  mkdirSync(out, {recursive: true});
  writeFileSync(path.join(out, 'qa.json'), JSON.stringify({project, status, checkedAt: new Date().toISOString(), checks}, null, 2));
  const mark = {pass: '✓', warn: '!', fail: '✗'};
  console.log(`qa ${project}: ${status.toUpperCase()}`);
  for (const c of checks) console.log(`  ${mark[c.status]} ${c.check}: ${c.detail}`);
  process.exit(status === 'fail' ? 1 : 0);
}
