// Print each scene's start time (seconds) in the rendered video, mirroring
// render/src/Demo.tsx timing. Usage: node scripts/scene-times.mjs <project>
import {readFileSync, existsSync} from 'node:fs';
import path from 'node:path';
const FPS = 30, HOLD_A = 0.7, HOLD_C = 0.4, SLIDE = 3, LEAD = 0.75;
const project = process.argv[2];
const sb = JSON.parse(readFileSync(path.resolve('projects', project, 'assets', 'storyboard.json'), 'utf8'));
let brand = {};
const bf = path.resolve('brands', sb.theme ?? '', 'brand.json');
if (sb.theme && existsSync(bf)) brand = JSON.parse(readFileSync(bf, 'utf8'));
const rate = (s) => { const n = (s.audioDuration ?? s.durationHint ?? 4) + HOLD_A; const c = s.clipDuration ?? 0; return !c || c <= n ? 1 : Math.min(1.3, c / n); };
const frames = (s) => { const n = (s.audioDuration ?? s.durationHint ?? 4) + HOLD_A; const c = s.clipDuration ? s.clipDuration / rate(s) + HOLD_C : 0; return Math.max(FPS, Math.round(Math.max(n, c) * FPS)); };
const slide = (sl) => sl?.audioDuration ? Math.max(SLIDE * FPS, Math.round((LEAD + sl.audioDuration + HOLD_A) * FPS)) : SLIDE * FPS;
let f = brand.sting?.open ? Math.round(brand.sting.open.seconds * FPS) : 0;
if (sb.intro) f += slide(sb.intro);
for (const s of sb.scenes) { console.log(`${s.id}\t${(f / FPS).toFixed(2)}\trate ${rate(s).toFixed(2)}`); f += frames(s); }
