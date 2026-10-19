// Batch runner: record, voice, render and QA a list of projects unattended.
//
// Usage: npm run batch -- <batch>            projects/_batches/<batch>.json
//        npm run batch -- <project> [...]    ad hoc list
// Options: --from tts|render|qa  start each video at that step (e.g. after a
//          narration edit, --from tts skips re-recording)
//          --only <project>      run just that video from the batch
//          --dry-run             print the plan and stop
//
// Batch file: {"name": "batch2", "videos": [{"project": "...", "target": "1:30"}, "other-project"]}
// Per video: reset.mjs (clear leftovers) -> seed.mjs -> capture -> tts -> render
// -> reset.mjs (clean up) -> qa. A failed step is logged, cleanup still runs,
// and the batch moves on. Writes projects/_batches/reports/<batch>-<stamp>.{json,md}.
import {spawn} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const from = opt('--from');
const only = opt('--only');
const dryRun = args.includes('--dry-run');
const names = args.filter((a, i) => !a.startsWith('--') && !['--from', '--only'].includes(args[i - 1]));
const STEPS = ['capture', 'tts', 'render', 'qa'];
if (!names.length || (from && !STEPS.includes(from))) {
  console.error('Usage: npm run batch -- <batch | project...> [--from tts|render|qa] [--only <project>] [--dry-run]');
  process.exit(1);
}

const batchFile = path.resolve('projects', '_batches', `${names[0]}.json`);
const batch = names.length === 1 && existsSync(batchFile)
  ? JSON.parse(readFileSync(batchFile, 'utf8'))
  : {name: 'adhoc', videos: names};
const videos = batch.videos
  .map((v) => (typeof v === 'string' ? {project: v} : v))
  .filter((v) => !only || v.project === only);
for (const v of videos) {
  if (!existsSync(path.resolve('projects', v.project, 'flow.mjs'))) {
    console.error(`batch: projects/${v.project}/flow.mjs not found`);
    process.exit(1);
  }
}

const has = (p, file) => existsSync(path.resolve('projects', p, file));
const plan = (v) => {
  const steps = [];
  const record = !from || from === 'capture';
  if (record && has(v.project, 'reset.mjs')) steps.push(['reset (before)', ['node', `projects/${v.project}/reset.mjs`]]);
  if (record && has(v.project, 'seed.mjs')) steps.push(['seed', ['node', `projects/${v.project}/seed.mjs`]]);
  for (const step of STEPS.slice(from ? STEPS.indexOf(from) : 0)) {
    if (step === 'qa') {
      if (record && has(v.project, 'reset.mjs')) steps.push(['reset (cleanup)', ['node', `projects/${v.project}/reset.mjs`], 'cleanup']);
      steps.push(['qa', ['node', 'scripts/qa.mjs', v.project, ...(v.target ? ['--target', v.target] : [])]]);
    } else {
      steps.push([step, ['npm', 'run', '-s', step, '--', v.project, ...(step === 'render' ? (v.render ?? []) : [])]]);
    }
  }
  return steps;
};

console.log(`batch ${batch.name}: ${videos.length} video(s)${from ? `, from ${from}` : ''}`);
for (const v of videos) console.log(`  ${v.project}${v.target ? ` (target ${v.target})` : ''}: ${plan(v).map(([s]) => s).join(' -> ')}`);
if (dryRun) process.exit(0);

// Run one command, streaming its output to the terminal and the video's log.
const run = (cmd, log) =>
  new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {stdio: ['ignore', 'pipe', 'pipe']});
    const tee = (stream, out) =>
      stream.on('data', (d) => {
        out.write(d);
        appendFileSync(log, d);
      });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('close', (code) => resolve(code ?? 1));
  });

const results = [];
const started = Date.now();
for (const v of videos) {
  const outDir = path.resolve('projects', v.project, 'out');
  mkdirSync(outDir, {recursive: true});
  const log = path.join(outDir, 'batch.log');
  appendFileSync(log, `\n=== batch ${batch.name} ${new Date().toISOString()}\n`);
  const t0 = Date.now();
  const result = {project: v.project, target: v.target ?? null, status: 'done', failedStep: null, notes: []};
  let failed = false;
  for (const [label, cmd, kind] of plan(v)) {
    // after a failure only cleanup still runs, so demo data never lingers
    if (failed && kind !== 'cleanup') continue;
    console.log(`\n--- ${v.project}: ${label}`);
    appendFileSync(log, `--- ${label}: ${cmd.join(' ')}\n`);
    const code = await run(cmd, log);
    if (label === 'qa') continue; // qa's verdict is read from qa.json below
    if (code !== 0) {
      if (kind === 'cleanup') result.notes.push(`cleanup exited ${code} - check demo data by hand`);
      else (failed = true), (result.status = 'failed'), (result.failedStep = label);
    }
  }
  const qaFile = path.join(outDir, 'qa.json');
  if (!failed && existsSync(qaFile)) {
    const qa = JSON.parse(readFileSync(qaFile, 'utf8'));
    result.qa = qa.status;
    result.length = qa.checks.find((c) => c.check === 'render')?.detail ?? null;
    result.notes.push(...qa.checks.filter((c) => c.status !== 'pass').map((c) => `${c.check}: ${c.detail}`));
    if (qa.status === 'fail') result.status = 'qa failed';
    result.video = `projects/${v.project}/out/${v.project}.mp4`;
    result.sheet = `projects/${v.project}/out/qa-sheet.jpg`;
  }
  result.minutes = Number(((Date.now() - t0) / 60000).toFixed(1));
  results.push(result);
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const reportDir = path.resolve('projects', '_batches', 'reports');
mkdirSync(reportDir, {recursive: true});
const base = path.join(reportDir, `${batch.name}-${stamp}`);
const report = {batch: batch.name, finishedAt: new Date().toISOString(), minutes: Number(((Date.now() - started) / 60000).toFixed(1)), results};
writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
const icon = (r) => (r.status === 'done' ? (r.qa === 'warn' ? '!' : '✓') : '✗');
const md = [
  `# Batch ${batch.name} - ${report.finishedAt.slice(0, 16).replace('T', ' ')} UTC (${report.minutes} min)`,
  '',
  '| | Video | Result | Length | Notes |',
  '|---|---|---|---|---|',
  ...results.map((r) =>
    `| ${icon(r)} | ${r.project} | ${r.status === 'failed' ? `failed at ${r.failedStep}` : `${r.status}, QA ${r.qa ?? '-'}`} | ${r.length ?? '-'} | ${r.notes.join('; ') || '-'} |`),
  '',
  'Next: watch each video and check its qa-sheet.jpg (names, secrets, wrong screens) before approving.',
].join('\n');
writeFileSync(`${base}.md`, md + '\n');
console.log(`\n${md}\n\nreport: ${path.relative(process.cwd(), base)}.md`);
process.exit(results.some((r) => r.status !== 'done') ? 1 : 0);
