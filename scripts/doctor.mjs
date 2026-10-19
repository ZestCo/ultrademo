// Environment check: verifies everything the pipeline needs, with fix hints.
// Usage: npm run doctor
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';

// Load .env here rather than with `node --env-file-if-exists`, so doctor still
// starts on a Node too old for that flag and can say so. Shell values win.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

let failed = false;
const ok = (label, detail = '') => console.log(`  ✓ ${label}${detail ? ` (${detail})` : ''}`);
const bad = (label, fix) => {
  failed = true;
  console.log(`  ✗ ${label}\n    fix: ${fix}`);
};
const info = (label) => console.log(`  · ${label}`);

console.log('ultrademo doctor\n');

// Node
// `npm run tts` needs --env-file-if-exists, so try the flag rather than guess from a version.
const envFileFlag = (() => {
  try {
    execFileSync(process.execPath, ['--env-file-if-exists=.env.none', '-e', ''], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
})();
if (envFileFlag) ok('node', `v${process.versions.node}`);
else
  bad(
    `node v${process.versions.node} is too old (npm run tts needs --env-file-if-exists)`,
    'nvm install && nvm use  (this folder\'s .nvmrc pins Node 22), then re-run npm run doctor',
  );

// ffmpeg / ffprobe
for (const bin of ['ffmpeg', 'ffprobe']) {
  try {
    const v = execFileSync(bin, ['-version']).toString().split('\n')[0];
    ok(bin, v.split(' ').slice(0, 3).join(' '));
  } catch {
    bad(`${bin} not found`, 'brew install ffmpeg (macOS) or apt install ffmpeg (Linux)');
  }
}

// Playwright chromium
try {
  const {chromium} = await import('playwright');
  const exe = chromium.executablePath();
  if (existsSync(exe)) ok('playwright chromium', exe.split('/').slice(-3).join('/'));
  else bad('playwright chromium browser not downloaded', 'npx playwright install chromium');
} catch {
  bad('playwright not installed', 'npm install');
}

// Remotion
try {
  await import('remotion');
  ok('remotion');
} catch {
  bad('remotion not installed', 'npm install');
}

// Voice chain: ElevenLabs -> Piper -> macOS say
let hasPiper = false;
try {
  execFileSync('piper', ['--help'], {stdio: 'ignore'});
  hasPiper = true;
} catch {
  /* not installed */
}

// OpenRouter: the key works, the account has credit, the model exists, and a
// one-word test line voices with the configured voice (a fraction of a cent).
const checkOpenRouter = async (key) => {
  const model = process.env.OPENROUTER_TTS_MODEL || 'google/gemini-3.1-flash-tts-preview';
  const voice = process.env.OPENROUTER_TTS_VOICE || 'Gacrux';
  const api = (p, init = {}) =>
    fetch(`https://openrouter.ai/api/v1/${p}`, {
      ...init,
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'},
    });
  const why = async (res) => {
    const body = await res.text();
    try {
      return `${res.status}: ${JSON.parse(body).error?.message}`;
    } catch {
      return `${res.status}: ${body.slice(0, 200)}`;
    }
  };
  try {
    const keyRes = await api('key');
    if (!keyRes.ok)
      return bad(`OPENROUTER_API_KEY rejected (${await why(keyRes)})`, 'paste a valid key from https://openrouter.ai/settings/keys into .env');
    const keyLeft = (await keyRes.json()).data?.limit_remaining; // null = no per-key limit
    const credits = await api('credits');
    const acct = credits.ok ? (await credits.json()).data : null;
    const left = Math.min(keyLeft ?? Infinity, acct ? acct.total_credits - acct.total_usage : Infinity);
    if (left <= 0)
      return bad('OpenRouter has no credit left for this key', 'top up at https://openrouter.ai/settings/credits (or raise the key limit)');
    ok('OPENROUTER_API_KEY set', `narration will use OpenRouter${Number.isFinite(left) ? `, $${left.toFixed(2)} credit left` : ''}`);

    if ((await api(`models/${model}/endpoints`)).status === 404)
      return bad(`OPENROUTER_TTS_MODEL ${model} not found`, 'pick a speech model at https://openrouter.ai/models?output_modalities=speech');
    const test = await api('audio/speech', {
      method: 'POST',
      body: JSON.stringify({model, voice, input: 'Test.', response_format: 'pcm'}),
    });
    if (test.ok && test.headers.get('content-type')?.startsWith('audio/')) ok('OpenRouter voice', `${voice} on ${model}`);
    else bad(`OpenRouter could not voice a test line with ${voice} on ${model} (${await why(test)})`, 'set OPENROUTER_TTS_VOICE in .env to a voice this model supports (see README)');
    const timing = process.env.OPENROUTER_TIMING_MODEL || 'fish-audio/transcribe-1';
    if (timing === 'off') info('OPENROUTER_TIMING_MODEL=off - no word timings, karaoke captions stay static');
    else if ((await api(`models/${timing}/endpoints`)).status === 404)
      bad(`OPENROUTER_TIMING_MODEL ${timing} not found`, 'pick a speech-to-text model at https://openrouter.ai/models?output_modalities=transcription, or set it to off');
    else ok('OpenRouter word timings', `${timing}, for karaoke captions`);
    if (process.env.OPENROUTER_TTS_STYLE) info(`style direction: ${process.env.OPENROUTER_TTS_STYLE}`);
    if (process.env.ELEVENLABS_API_KEY) info('ELEVENLABS_API_KEY is also set - OpenRouter takes priority');
  } catch (err) {
    bad(`could not reach openrouter.ai (${err.cause?.code ?? err.message})`, 'check your internet connection or proxy');
  }
};

const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
if (openrouterKey) {
  await checkOpenRouter(openrouterKey);
} else if (process.env.ELEVENLABS_API_KEY) {
  ok('ELEVENLABS_API_KEY set', 'narration will use ElevenLabs');
} else if (openrouterKey === '') {
  bad('OPENROUTER_API_KEY is empty in .env', 'paste your key from https://openrouter.ai/settings/keys, or delete the line to use Piper/say');
} else if (hasPiper) {
  ok('piper installed', 'free offline narration; set ELEVENLABS_API_KEY in .env for premium voice');
} else if (process.platform === 'darwin') {
  info('no OPENROUTER_API_KEY, no ELEVENLABS_API_KEY and no piper - narration falls back to the macOS `say` placeholder voice.');
  info('  better free option: pip install piper-tts · premium: OPENROUTER_API_KEY=... or ELEVENLABS_API_KEY=... in .env');
} else {
  bad(
    'no voice available (no OPENROUTER_API_KEY, no ELEVENLABS_API_KEY, no piper, no macOS say)',
    'pip install piper-tts  (free, offline)  or add OPENROUTER_API_KEY=... or ELEVENLABS_API_KEY=... to .env',
  );
}

console.log(failed ? '\nsome checks failed - fix the items above.' : '\nall good - you are ready to capture.');
process.exit(failed ? 1 : 0);
