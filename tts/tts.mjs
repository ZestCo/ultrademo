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
const OPENROUTER_TIMING = process.env.OPENROUTER_TIMING_MODEL || 'fish-audio/transcribe-1'; // 'off' = no word timings
const OPENROUTER_STYLE = process.env.OPENROUTER_TTS_STYLE?.trim() ?? '';
// Delivery guidance via the API's `instructions` field - honoured by OpenAI TTS
// (Gemini ignores it; use OPENROUTER_TTS_STYLE there).
const OPENROUTER_INSTRUCTIONS = process.env.OPENROUTER_TTS_INSTRUCTIONS?.trim() ?? '';
// Gemini TTS only returns raw PCM (24 kHz mono s16le); other models return mp3.
const OPENROUTER_PCM = /^google\//.test(OPENROUTER_MODEL);

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
    ? `openrouter:${OPENROUTER_MODEL}:${OPENROUTER_VOICE}:${OPENROUTER_STYLE}:${OPENROUTER_INSTRUCTIONS}`
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
// input as a labelled direction, and ffmpeg encodes the mp3. Word timings come
// from a second pass (openrouterWords). Any failure throws: never write silent audio.
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
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          voice: OPENROUTER_VOICE,
          input,
          response_format: OPENROUTER_PCM ? 'pcm' : 'mp3',
          ...(OPENROUTER_INSTRUCTIONS ? {instructions: OPENROUTER_INSTRUCTIONS} : {}),
        }),
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
    const body = Buffer.from(await res.arrayBuffer());
    // checks run on raw PCM; an mp3 reply is decoded for them and kept as sent
    const pcm = OPENROUTER_PCM
      ? body
      : execFileSync('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '24000', 'pipe:1'], {
          input: body,
          maxBuffer: 1 << 28,
        });
    const rate = OPENROUTER_PCM ? Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000) : 24000;
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
    if (OPENROUTER_PCM)
      execFileSync(
        'ffmpeg',
        ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0',
          '-ar', '44100', '-b:a', '128k', tmp],
        {input: pcm},
      );
    else await writeFile(tmp, body);
    renameSync(tmp, outFile);
    return null; // word timings are added by the caller (openrouterWords), against the script
  }
  throw new Error(`${problem} (gave up after 4 attempts)`);
};

// Map transcript timings onto the script's own tokens (whitespace-split, quotes
// and punctuation kept, as the ElevenLabs alignment produces). Matching is per
// character, so a misheard ("Zesk") or merged ("ZestDesk") word still lines up;
// tokens with no match share the gap between their neighbours.
const alignWords = (script, heard) => {
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const tokens = script.split(/\s+/).filter(Boolean);
  const a = [];
  const owner = [];
  tokens.forEach((tok, i) => {
    for (const c of norm(tok)) (a.push(c), owner.push(i));
  });
  const b = [];
  const span = [];
  for (const h of heard) {
    const cs = [...norm(h.word ?? '')];
    const step = (h.end - h.start) / Math.max(1, cs.length);
    cs.forEach((c, k) => (b.push(c), span.push([h.start + step * k, h.start + step * (k + 1)])));
  }
  const n = a.length;
  const m = b.length;
  const d = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) d[i][0] = i;
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
  const words = tokens.map((w) => ({w, start: null, end: null}));
  let matched = 0;
  for (let i = n, j = m; i > 0 && j > 0; ) {
    const same = a[i - 1] === b[j - 1];
    if (d[i][j] === d[i - 1][j - 1] + (same ? 0 : 1)) {
      const w = words[owner[i - 1]];
      const [s, e] = span[j - 1];
      w.start = w.start === null ? s : Math.min(w.start, s);
      w.end = w.end === null ? e : Math.max(w.end, e);
      matched += same;
      i--, j--;
    } else if (d[i][j] === d[i - 1][j] + 1) i--;
    else j--;
  }
  if (matched < n * 0.6) return null; // transcript doesn't resemble the script
  for (let i = 0; i < words.length; ) {
    if (words[i].start !== null) {
      i++;
      continue;
    }
    let k = i;
    while (k < words.length && words[k].start === null) k++;
    const from = words[i - 1]?.end ?? 0;
    const to = Math.max(from, words[k]?.start ?? from + 0.3 * (k - i));
    const step = (to - from) / (k - i);
    for (let x = i; x < k; x++) Object.assign(words[x], {start: from + step * (x - i), end: from + step * (x - i + 1)});
    i = k;
  }
  return words.map(({w, start, end}) => ({w, start: +start.toFixed(3), end: +end.toFixed(3)}));
};

// Karaoke timings for OpenRouter voices: transcribe the finished clip with word
// timestamps (OPENROUTER_TIMING_MODEL) and align them to the script. A failure
// here only costs the karaoke effect for that line, so it warns, never throws.
const openrouterWords = async (text, file) => {
  if (OPENROUTER_TIMING === 'off') return null;
  const form = new FormData();
  form.append('model', OPENROUTER_TIMING);
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');
  form.append('file', new Blob([readFileSync(file)], {type: 'audio/mpeg'}), path.basename(file));
  try {
    const res = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: {Authorization: `Bearer ${OPENROUTER_KEY}`},
      body: form,
    });
    if (!res.ok) throw new Error(`${OPENROUTER_TIMING} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const heard = (await res.json()).words;
    const words = heard?.length ? alignWords(text, heard) : null;
    if (!words) throw new Error(`${OPENROUTER_TIMING} returned no usable word timings`);
    return words;
  } catch (err) {
    console.warn(`  no word timings (${err.cause?.code ?? err.message}) - captions stay static for this line`);
    return null;
  }
};

const synth = {openrouter, elevenlabs, piper, say: macSay}[engine];

// Narratable units: every scene, plus the intro/outro slides when they carry a
// script (the renderer starts slide audio slightly after the card appears and
// holds the slide until the line finishes).
// Optional projects/<project>/pronounce.json: {"IT": "I.T."} - whole-word,
// case-sensitive substitutions applied to the SPOKEN text only, so captions
// keep the on-screen spelling while the voice says it right.
const pronouncePath = path.resolve('projects', project, 'pronounce.json');
const pronounce = existsSync(pronouncePath) ? JSON.parse(readFileSync(pronouncePath, 'utf8')) : {};
const escapeRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const spoken = (text) =>
  Object.entries(pronounce).reduce(
    (t, [from, to]) => t.replace(new RegExp(`(?<![\\w])${escapeRe(from)}(?![\\w])`, 'g'), to),
    text,
  );

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
  const sig = createHash('sha256').update(`${voiceSig}\n${spoken(scene.script)}`).digest('hex');

  const force = redo.has('all') || redo.has(id);
  const cached =
    !force && existsSync(outFile) && existsSync(sigFile) && readFileSync(sigFile, 'utf8') === sig;

  let words = null;
  if (!cached) {
    try {
      words = await synth(spoken(scene.script), outFile);
      // OpenRouter timings are aligned to the script as written, not the spoken text
      if (engine === 'openrouter') words = await openrouterWords(scene.script, outFile);
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
  } else if (engine === 'openrouter') {
    // voiced before timings existed (or the timing pass failed): add them
    // without re-voicing, so the line's audio is never re-billed
    words = await openrouterWords(scene.script, outFile);
    if (words) await writeFile(wordsFile, JSON.stringify(words));
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
