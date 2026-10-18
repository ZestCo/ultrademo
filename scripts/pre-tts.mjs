// Write a script-only storyboard from a project's flow (no capture), so narration
// can be synthesized and measured BEFORE recording - lets clip actions be pinned
// to word timings in a single capture pass.
// Usage: node scripts/pre-tts.mjs <project>   (then: npm run tts -- <project>; node scripts/phrases.mjs <project>)
// A later `npm run capture` overwrites this storyboard; the TTS cache is reused.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const project = process.argv[2];
const dir = path.resolve('projects', project);
const {default: flow} = await import(pathToFileURL(path.join(dir, 'flow.mjs')).href);
mkdirSync(path.join(dir, 'assets'), {recursive: true});
const sbPath = path.join(dir, 'assets', 'storyboard.json');
const prev = existsSync(sbPath) ? JSON.parse(readFileSync(sbPath, 'utf8')) : null;
if (prev?.scenes?.some((s) => s.clip || s.screenshot)) {
  console.log('pre-tts: storyboard already has captured scenes - leaving it alone');
  process.exit(0);
}
const sb = {
  title: flow.title,
  project,
  ...(flow.intro ? {intro: flow.intro} : {}),
  ...(flow.outro ? {outro: flow.outro} : {}),
  scenes: flow.scenes.filter((s) => !s.skip).map((s) => ({id: s.id, media: s.media ?? 'still', script: s.script})),
};
writeFileSync(sbPath, JSON.stringify(sb, null, 2));
console.log(`pre-tts: wrote script-only storyboard with ${sb.scenes.length} scenes`);
