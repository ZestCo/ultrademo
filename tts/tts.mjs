// Ultrademo TTS step.
// Reads a project storyboard, synthesizes one audio clip per scene, measures
// its duration with ffprobe, and writes audio/audioDuration back into the
// storyboard.
//
// Voice chain: OpenRouter (OPENROUTER_API_KEY in .env) -> ElevenLabs
// (ELEVENLABS_API_KEY in .env) -> Piper if installed (free, offline,
// cross-platform: `pip install piper-tts`) -> macOS `say` placeholder -> error
// with install instructions. An OPENROUTER_API_KEY= line left empty stops with
// a reminder instead of falling back to a free voice.
//
// Unchanged lines are cached: each clip stores a signature of (engine, voice,
// text); re-runs only synthesize scenes whose script or voice changed, so
// editing one line never re-bills the other twenty.
//
// Usage: npm run tts -- <project>

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? 'UM3TOcm5kcELI84GFoAz'; // default demo voice
const MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';
const API_KEY = process.env.ELEVENLABS_API_KEY;
const PIPER_MODEL = process.env.PIPER_MODEL ?? 'en_US-lessac-medium';
const STABILITY = process.env.ELEVENLABS_STABILITY ?? '0.45';
const SIMILARITY = process.env.ELEVENLABS_SIMILARITY ?? '0.75';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim();
const OPENROUTER_MODEL = process.env.OPENROUTER_TTS_MODEL || 'google/gemini-3.1-flash-tts-preview';
const OPENROUTER_VOICE = process.env.OPENROUTER_TTS_VOICE || 'Gacrux';
const OPENROUTER_STYLE = process.env.OPENROUTER_TTS_STYLE?.trim() ?? '';

const args = process.argv.slice(2);
const project = args.find((a) => !a.startsWith('--'));
if (!project) {
  console.error('Usage: npm run tts -- <project> [--redo <sceneId,sceneId|all>] (slide ids: intro-slide, outro-slide)');
  process.exit(1);
}
const redoArg = args.includes('--redo') ? (args[args.indexOf('--redo') + 1] ?? 'all') : null;
const redo = new Set(redoArg ? redoArg.split(',') : []);

const assetsDir = path.resolve('projects', project, 'assets');
const sbPath = path.join(assetsDir, 'storyboard.json');
const storyboard = JSON.parse(await readFile(sbPath, 'utf8'));
await mkdir(path.join(assetsDir, 'audio'), {recursive: true});

const hasPiper = (() => {
  try {
    execFileSync('piper', ['--help'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
})();

const engine = OPENROUTER_KEY
  ? 'openrouter'
  : API_KEY
    ? 'elevenlabs'
    : hasPiper
      ? 'piper'
      : process.platform === 'darwin'
        ? 'say'
        : null;

// The OPENROUTER_API_KEY= line is there but empty (fresh copy of .env.example):
// stop rather than quietly narrate with a placeholder voice.
if (OPENROUTER_KEY === '' && engine !== 'elevenlabs') {
  console.error(
    `OPENROUTER_API_KEY is empty in ${path.resolve('.env')}\n` +
      '  - paste your key from https://openrouter.ai/settings/keys after the =, or\n' +
      '  - delete that line to use the free Piper/say voice instead.',
  );
  process.exit(1);
}

if (!engine) {
  console.error(
    'No voice available. Either:\n' +
      '  - add OPENROUTER_API_KEY=... or ELEVENLABS_API_KEY=... to a .env file in this folder, or\n' +
      '  - install Piper (free, offline): pip install piper-tts',
  );
  process.exit(1);
}

const voiceSig =
  engine === 'openrouter'
    ? `openrouter:${OPENROUTER_MODEL}:${OPENROUTER_VOICE}:${OPENROUTER_STYLE}`
    : engine === 'elevenlabs'
      ? `elevenlabs:${VOICE_ID}:${MODEL_ID}:${STABILITY}:${SIMILARITY}`
      : engine === 'piper'
        ? `piper:${PIPER_MODEL}`
        : 'say';

const labels = {
  openrouter: `OpenRouter (${OPENROUTER_MODEL}, voice ${OPENROUTER_VOICE})`,
  elevenlabs: `ElevenLabs (voice ${VOICE_ID})`,
  piper: `Piper (${PIPER_MODEL}, offline)`,
  say: 'macOS say fallback (placeholder voice)',
};
console.log(`TTS: ${labels[engine]}`);

const probeSeconds = (file) =>
  parseFloat(
    execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ]).toString(),
  );

// Collapse ElevenLabs' per-character alignment into per-word [start,end] timings
// (used by the renderer's karaoke word-highlight captions).
const wordsFromAlignment = (al) => {
  if (!al?.characters?.length) return null;
  const {characters: ch, character_start_times_seconds: st, character_end_times_seconds: en} = al;
  const words = [];
  let cur = null;
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) {
      if (cur) (words.push(cur), (cur = null));
      continue;
    }
    if (!cur) cur = {w: '', start: st[i], end: en[i]};
    cur.w += ch[i];
    cur.end = en[i];
  }
  if (cur) words.push(cur);
  return words.length ? words : null;
};

// Uses the with-timestamps endpoint so we get word-level timings for free.
// Returns the word track (or null if alignment is unavailable).
const elevenlabs = async (text, outFile) => {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {'xi-api-key': API_KEY, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: {stability: Number(STABILITY), similarity_boost: Number(SIMILARITY)},
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  await writeFile(outFile, Buffer.from(data.audio_base64, 'base64'));
  return wordsFromAlignment(data.alignment);
};

// Piper/say don't emit word timings, so they return null: captions stay static
// on the free voices (karaoke word-highlight is an ElevenLabs-only feature).
const piper = (text, outFile) => {
  const wav = outFile.replace(/\.mp3$/, '.wav');
  const modelDir = path.join(os.homedir(), '.ultrademo', 'piper');
  // Piper auto-downloads the voice model on first use.
  execFileSync(
    'piper',
    ['--model', PIPER_MODEL, '--download-dir', modelDir, '--data-dir', modelDir, '--output_file', wav],
    {input: text},
  );
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, outFile]);
  rmSync(wav, {force: true});
  return null;
};

const macSay = (text, outFile) => {
  const aiff = outFile.replace(/\.mp3$/, '.aiff');
  execFileSync('say', ['-o', aiff, text]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, outFile]);
  rmSync(aiff, {force: true});
  return null;
};

// OpenRouter's speech endpoint (Gemini TTS by default). Gemini only returns raw
// PCM and ignores the `instructions` field, so an optional style goes in the
// input as a labelled direction, and ffmpeg encodes the mp3. No word timings,
// so captions stay static. Any failure throws: never write silent audio.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const openrouterError = async (res) => {
  const body = await res.text();
  let msg = body.slice(0, 300);
  try {
    msg = JSON.parse(body).error?.message ?? msg;
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return `OpenRouter rejected OPENROUTER_API_KEY (401: ${msg}) - check the key in .env`;
  if (res.status === 402)
    return `OpenRouter account is out of credit (402: ${msg}) - top up at https://openrouter.ai/settings/credits`;
  if (res.status === 400 || res.status === 404)
    return `OpenRouter ${res.status}: ${msg} - check OPENROUTER_TTS_MODEL (${OPENROUTER_MODEL}) and OPENROUTER_TTS_VOICE (${OPENROUTER_VOICE}) in .env`;
  return `OpenRouter ${res.status}: ${msg}`;
};

const openrouter = async (text, outFile) => {
  const input = OPENROUTER_STYLE
    ? 'Read the transcript aloud. Speak only the transcript, never the direction.\n\n' +
      `DIRECTION: ${OPENROUTER_STYLE}\n\nTRANSCRIPT: ${text}`
    : text;
  const maxSeconds = 3 + 1.5 * text.split(/\s+/).length; // longer = the direction was read aloud
  let problem = '';
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (attempt > 1) await sleep(1000 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch('https://openrouter.ai/api/v1/audio/speech', {
        method: 'POST',
        headers: {Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({model: OPENROUTER_MODEL, voice: OPENROUTER_VOICE, input, response_format: 'pcm'}),
      });
    } catch (err) {
      problem = `could not reach openrouter.ai (${err.cause?.code ?? err.message})`;
      continue;
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('audio/')) {
      problem = await openrouterError(res);
      // bad key / no credit / unknown model won't fix themselves; anything else
      // (rate limits, provider hiccups, Gemini's occasional 400) gets a retry
      if ([401, 402, 403, 404].includes(res.status)) throw new Error(problem);
      continue;
    }
    const pcm = Buffer.from(await res.arrayBuffer());
    const rate = Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000);
    const seconds = pcm.length / 2 / rate;
    let peak = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)));
    if (seconds < 0.3 || peak < 500) {
      problem = `OpenRouter returned silent audio (${seconds.toFixed(1)}s)`;
      continue;
    }
    if (seconds > maxSeconds) {
      problem = `audio ran ${seconds.toFixed(1)}s for a ${maxSeconds.toFixed(0)}s-max line - the style direction was likely read aloud; shorten OPENROUTER_TTS_STYLE`;
      continue;
    }
    // same mp3 as the ElevenLabs path (44.1kHz, 128k); encode beside the target
    // and rename, so a failed encode never leaves a broken clip
    const tmp = outFile.replace(/\.mp3$/, '.tmp.mp3');
    execFileSync(
      'ffmpeg',
      ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
        '-ar', '44100', '-b:a', '128k', tmp],
      {input: pcm},
    );
    renameSync(tmp, outFile);
    return null;
  }
  throw new Error(`${problem} (gave up after 4 attempts)`);
};

const synth = {openrouter, elevenlabs, piper, say: macSay}[engine];

// Narratable units: every scene, plus the intro/outro slides when they carry a
// script (the renderer starts slide audio slightly after the card appears and
// holds the slide until the line finishes).
const units = [
  ...(storyboard.intro?.script ? [{id: 'intro-slide', obj: storyboard.intro}] : []),
  ...storyboard.scenes.map((scene) => ({id: scene.id, obj: scene})),
  ...(storyboard.outro?.script ? [{id: 'outro-slide', obj: storyboard.outro}] : []),
];

for (const {id, obj: scene} of units) {
  const rel = `audio/${id}.mp3`;
  const outFile = path.join(assetsDir, rel);
  const sigFile = `${outFile}.sig`;
  const wordsFile = `${outFile}.words.json`; // per-word timings cached beside the audio
  const sig = createHash('sha256').update(`${voiceSig}\n${scene.script}`).digest('hex');

  const force = redo.has('all') || redo.has(id);
  const cached =
    !force && existsSync(outFile) && existsSync(sigFile) && readFileSync(sigFile, 'utf8') === sig;

  let words = null;
  if (!cached) {
    try {
      words = await synth(scene.script, outFile);
    } catch (err) {
      console.error(
        `\nTTS failed on line "${id}": ${scene.script}\n  ${err.message}\n` +
          'Lines voiced before it are cached; fix the problem and re-run the same command.',
      );
      process.exit(1);
    }
    await writeFile(sigFile, sig);
    if (words) await writeFile(wordsFile, JSON.stringify(words));
    else rmSync(wordsFile, {force: true}); // drop stale timings if the voice changed
  } else if (existsSync(wordsFile)) {
    words = JSON.parse(readFileSync(wordsFile, 'utf8'));
  }

  scene.audio = rel;
  scene.audioDuration = probeSeconds(outFile);
  if (words) scene.words = words;
  else delete scene.words;
  console.log(
    `${id}: ${scene.audioDuration.toFixed(2)}s${cached ? ' (cached)' : ''}${words ? ' +words' : ''}`,
  );
}

// atomic write: a crash mid-write must never truncate the storyboard
const {rename} = await import('node:fs/promises');
await writeFile(`${sbPath}.tmp`, JSON.stringify(storyboard, null, 2));
await rename(`${sbPath}.tmp`, sbPath);
console.log('storyboard.json updated with audio durations');
