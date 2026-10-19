# Ultrademo

Point your AI Agent at your web app and get a narrated demo video. Everything runs on **your** machine: your credentials, your data, and your renders never leave it.

> **Zest fork** of [new-xp/ultrademo](https://github.com/new-xp/ultrademo). It adds an OpenRouter narration voice - see [Narration via OpenRouter](#narration-via-openrouter). Install commands below point at this fork, so the skill and its workspace both use this code.

## See it work

![Ultrademo output: building a project tracker in Notion, captured and narrated automatically](docs/notion-tracker-2026-07-10.gif)

This 90-second Notion tutorial was produced end to end by the pipeline: scouted, scripted (with a human sign-off), captured through a signed-in browser session, narrated with ElevenLabs, and rendered - all from [one flow file](examples/notion-tracker/flow.mjs). The full MP4 with narration is on [ultrademo.net](https://ultrademo.net).

Ultrademo is a capture-and-render pipeline plus a Claude Code skill that drives it. Tell Claude "make a 2-minute walkthrough of my app", review the script it drafts, and get a finished, narrated MP4. The same capture can also produce opt-in extras when they fit: a GIF (downscaled, for READMEs and embeds), a 9:16 vertical cut (best when your app has a mobile view - cropping a dense desktop UI rarely earns it), or editor-ready stems (clean video + narration track + SRT) if you finish in your own editor.

**How it works:** a flow file (the shot list) drives Playwright through your app, producing a `storyboard.json` - ordered scenes with screenshots, real screen-recording clips, cursor tracks, and narration lines. TTS voices each line; Remotion renders the result with zooms, a synthetic cursor, and captions. The storyboard is the single source of truth: edit a narration line and re-render in minutes, re-capture one scene when your UI changes.

## Requirements

- Node 22 (`.nvmrc` pins it: `nvm install && nvm use`), macOS / Linux / Windows
- ffmpeg + ffprobe (`brew install ffmpeg` / `apt install ffmpeg` / `winget install ffmpeg`)
- Chromium for Playwright (`npx playwright install chromium`)
- A voice, best-first: an [OpenRouter](https://openrouter.ai) API key in `.env` (see [below](#narration-via-openrouter)) → an [ElevenLabs](https://elevenlabs.io) API key in `.env` (premium) → [Piper](https://github.com/rhasspy/piper) (`pip install piper-tts` - free, offline, all platforms) → macOS `say` (zero-install placeholder). Unchanged narration lines are cached, so re-renders never re-bill your ElevenLabs quota.

## Install

**Recommended - install the skill:**

```bash
npx skills add ZestCo/ultrademo          # pick YOUR agent when prompted
npx skills add ZestCo/ultrademo -a claude-code   # or skip the prompt (Claude Code)
```

One command, either form. **In the agent picker, choose the agent you actually use** (Claude Code, Codex, Cursor, OpenCode, Windsurf, ...) - the "universal" option installs to `.agents/skills/`, a shared location some agents (including Claude Code today) don't scan, so the skill silently never shows up.

**Then start it** - the installer finishes quietly, so this is the step people miss:

```bash
cd your-app          # the project you want a video of
claude               # or your agent of choice
> make a demo video of this app
```

On first run the skill provisions the pipeline for you - clones this repo into `ultrademo-workspace/`, runs `npm ci` (lockfile-exact) and `playwright install`, creates `.env`, and verifies your environment - then scouts your app, drafts a scene-by-scene script for your sign-off, captures, and renders.

**Skill not showing up?** (`/ultrademo` unknown, or your agent doesn't list it): it almost certainly landed in `.agents/skills/` from the "universal" picker choice. Re-run the install with your agent named explicitly (`npx skills add ZestCo/ultrademo -a claude-code`), or move the `ultrademo` and `ultrademo-rerun` folders into `.claude/skills/` yourself.

Built and tested with Claude Code; any agent that reads `AGENTS.md` can follow the same playbook. Gemini CLI looks for `GEMINI.md` by default, so set its `contextFileName` to `AGENTS.md` (or copy the file).

**Or set up the workspace yourself** (no skill CLI, or you just want the pipeline):

```bash
git clone https://github.com/ZestCo/ultrademo ultrademo-workspace && cd ultrademo-workspace
npm ci
npx playwright install chromium
npm run doctor                 # verifies your environment
cp .env.example .env           # add OPENROUTER_API_KEY (or ELEVENLABS_API_KEY) for narration
```

With the folder open in Claude Code (or another AGENTS.md-aware agent), just ask for a demo video. Prefer to drive it by hand? See **Manually** below.

**Updating:** `git pull` in the workspace picks up pipeline and skill improvements (the skill checks for this itself and offers the pull when the clone falls behind); run `npm ci` after if dependencies changed. If you installed the skill standalone via the skills CLI, `npx skills update` refreshes the installed skill copy to match.

**Manually:** copy `capture/flow-template.mjs` to `projects/<app>-<topic>-<date-time>/flow.mjs`, edit the scenes, then:

```bash
npm run capture -- <project>         # loads projects/<project>/flow.mjs
npm run tts -- <project>
npm run render -- <project>          # projects/<project>/out/<project>.mp4 (finalized)
npm run render -- <project> --vertical   # 9:16 cut (best for mobile-responsive apps; crops desktop UIs)
npm run render -- <project> --gif        # animated GIF (960x540, 15fps - keep videos short for this)
npm run render -- <project> --no-captions  # finalized video without burned-in captions
npm run render -- <project> --stems      # editor-ready stems (clean video, narration.mp3, captions.srt) + the finalized video
npm run studio                       # scrubbable preview
```

## Narration via OpenRouter

This fork can voice narration through [OpenRouter](https://openrouter.ai)'s speech endpoint, using Google's Gemini TTS by default. One OpenRouter account pays for it, with no separate ElevenLabs subscription.

**Setup**

1. Create a key at [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys), and add credit to the account. A 30-second demo costs well under a cent.
2. Open `.env` in the workspace (the skill creates it from `.env.example` on first run, or run `cp .env.example .env`), and paste the key after `OPENROUTER_API_KEY=`.
3. Run `npm run doctor`. It checks that the key works, that the account has credit, that the model and the word-timing model exist, and that the voice can say a one-word test line. That test line costs a fraction of a cent.

From then on `npm run tts -- <project>` uses OpenRouter and prints `TTS: OpenRouter (<model>, voice <voice>)`.

**`.env` keys**

| Key | Default | What it does |
|---|---|---|
| `OPENROUTER_API_KEY` | - | Turns OpenRouter on. When it is set, it is used ahead of ElevenLabs, Piper and `say`. |
| `OPENROUTER_TTS_MODEL` | `google/gemini-3.1-flash-tts-preview` | Speech model. It must return raw PCM, as Gemini TTS does. |
| `OPENROUTER_TTS_VOICE` | `Gacrux` | The voice. |
| `OPENROUTER_TTS_STYLE` | (none) | Optional delivery direction in plain words, e.g. `Calm, friendly British narrator, unhurried.` |
| `OPENROUTER_TIMING_MODEL` | `fish-audio/transcribe-1` | Transcription model used for karaoke word timings. Any OpenRouter speech-to-text model that returns word timestamps works; `off` disables timings. |

If the `OPENROUTER_API_KEY=` line is there but empty, `npm run tts` stops and asks for the key. It does not fall back to the robotic placeholder voice. To use the free Piper or `say` voice instead, delete the line.

**Changing the voice**

Set `OPENROUTER_TTS_VOICE` in `.env` to another Gemini voice name. Zest has used `Gacrux` (mature, the default), `Charon` (drier and more informative), `Enceladus` (breathy and soft), `Puck` (upbeat) and `Iapetus` (clear). Google lists the full set under [Gemini TTS voice options](https://ai.google.dev/gemini-api/docs/speech-generation#voices). Then:

```bash
npm run doctor                      # confirms the new voice works
npm run tts -- <project>            # re-voices every line once (the voice is part of the cache key)
npm run render -- <project>
```

Use `OPENROUTER_TTS_STYLE` to adjust tone and accent. Keep the direction to a sentence or two, because long directions sometimes get read aloud. If a take runs far longer than its line, `tts` retries it and then stops with an error. Changing the model, voice or style re-voices all lines. Editing one narration line re-voices only that line, and unchanged lines come from the cache and are never re-billed.

**Errors.** A bad key, an account with no credit, an unknown model or voice, or an API failure that persists after retries stops `npm run tts`. The message names the failing scene and its line, for example:

```
TTS failed on line "s3-reports": Reports track how many tickets ...
  OpenRouter account is out of credit (402: ...) - top up at https://openrouter.ai/settings/credits
```

No audio file is written for a failed line. If the API returns silent audio, that counts as a failure. Fix the problem and run the same command again; lines voiced before the failure are already cached.

**Karaoke captions.** Word-highlight captions (`caption: {highlight: 'wipe'}` in the flow, or `--caption-highlight=wipe` on render) need per-word timings. With OpenRouter, `tts` gets them by transcribing each newly voiced line once with word timestamps (`OPENROUTER_TIMING_MODEL`, default `fish-audio/transcribe-1`, about $0.003 per 30 seconds), then mapping those timings onto the script's own words. If the transcriber mishears a word, the caption still shows the script's spelling. Lines voiced before this existed get timings on the next `tts` run without being re-voiced. If the timing pass fails, `tts` prints a warning and that line's captions stay static; the audio is unaffected. Set `OPENROUTER_TIMING_MODEL=off` to skip it.

**Keeping the fork current:** `git remote add upstream https://github.com/new-xp/ultrademo`, then `git fetch upstream && git merge upstream/main` and push. The OpenRouter changes are kept small (`tts/tts.mjs`, `scripts/doctor.mjs`, `.env.example`, the doctor script in `package.json`, this section, and the repo URL in the skill and install lines), so upstream updates should merge cleanly.

## Zest brand profile

Zest videos set `theme: 'zest-yt'` on the flow. `npm run render` then copies `brands/zest-yt/` into the project and adds:

- an opening logo sting (the petals fan open) with the sting audio, and a closing sting with the "A fresh perspective" tagline;
- branded title and closing cards in Montserrat on cream (`intro.kicker` sets the small label above the title);
- the Zest mark as a corner watermark on every scene, and Zest yellow for UI literals in captions.

Everything lives in `brands/zest-yt/`: `brand.json` (colours, font, sting timings, watermark), the logo layers, the font, `sting.mp3` (the chosen sting; `sting-options/` holds the alternatives) and `exports/` (the stings as standalone MP4s for other edits). A new brand is a new folder beside it with its own `brand.json`.

Helper scripts for tight narration timing: `node scripts/pre-tts.mjs <project>` writes a script-only storyboard so `npm run tts` can voice the lines before capture, `node scripts/phrases.mjs <project>` prints where each line's phrases fall, `node scripts/scene-times.mjs <project>` prints each scene's start time in the render, and `scripts/sync-check.py` builds a contact sheet of frames at given moments. Per-project `pronounce.json` (`{"IT": "I.T."}`) changes what the voice says without changing the captions.

## Batches and automatic QA

Record a whole list of videos unattended, then review them together:

```bash
npm run batch -- batch2                 # projects/_batches/batch2.json
npm run batch -- batch2 --from tts      # after narration edits: re-voice and re-render, no re-recording
npm run batch -- batch2 --only <project>
npm run qa -- <project> [--target 1:30] # QA one rendered video on its own
```

A batch file lists projects in order, with an optional target length and extra render flags:

```json
{"name": "batch2", "videos": [{"project": "edv-export-tickets-2026-10-09-1424", "target": "1:30"}, "edv-create-tag-2026-10-09-1424"]}
```

For each video the runner does `reset.mjs` (clears leftovers), `seed.mjs`, capture, tts, render, `reset.mjs` again (cleanup) and QA. A failed step is logged to `out/batch.log`, cleanup still runs, and the batch moves on. The report lands in `projects/_batches/reports/<batch>-<time>.md` (and `.json`).

QA (`out/qa.json`) checks the length against the target, that every line is voiced, karaoke word timings, clips running long past their narration, clips that froze mid-action, black frames, silent gaps over 4 seconds and audio levels. It also writes `out/qa-sheet.jpg`, one frame per scene in order, for the visual check: real names, secrets, wrong screens. Automatic QA never replaces watching the video before it goes out.

## What a flow can do

Still scenes (screenshot + Ken Burns zoom), clip scenes (real recordings of typing, dialogs, transitions - with demo-paced actions, a synthetic cursor overlay, and `skipWhile()` jump-cuts over spinners), and phone-framed mobile scenes.

Each video is a self-contained project folder - assets and outputs together, nothing scattered:

```
ultrademo-workspace/
├── .env                          # ELEVENLABS_API_KEY=... (optional, gitignored)
├── .claude/skills/ultrademo/     # the skill (active when this folder is open in Claude Code)
├── .profiles/                    # signed-in browser sessions from `npm run login` (gitignored)
├── capture/  tts/  render/  scripts/   # pipeline code (+ capture/flow-template.mjs)
└── projects/<app>-<topic>-<YYYY-MM-DD-HHMM>/     # ONE folder per video
    ├── flow.mjs                  # the shot list (source - keep in git)
    ├── reset.mjs                 # optional state-reset recipe for retakes
    ├── assets/                   # storyboard.json + captures/ + audio/ (gitignored)
    └── out/                      # finalized MP4, variants, stems/ (gitignored)
```

Project names follow `<app>-<feature-or-topic>-<date-time>`; retakes reuse the same project folder (that's what keeps the TTS cache warm). Preview any project with `npm run studio -- --public-dir projects/<name>/assets`.

## Formats: one capture, the outputs that earn it

The default deliverable is always the **finalized 16:9 MP4** - captions burned in, narration mixed, ready to publish. Everything else is an opt-in re-render of the same storyboard, so none of it costs a re-capture or re-bills narration:

| Output | Command | When it earns its place |
|---|---|---|
| Finalized MP4 (16:9) | `npm run render -- <project>` | always - the default, and still produced even when you ask for extras |
| Vertical 9:16 | `--vertical` | your app has a mobile view, or the action is concentrated enough to survive the crop; dense desktop UIs usually aren't worth it |
| GIF | `--gif` | READMEs, PRs, embeds - downscaled to 960x540/15fps; keep the target short (a 90s video ≈ 9 MB). GIFs are silent, so captions stay burned in by default to carry the narration; add `--no-captions` for a clean visual loop |
| No burned-in captions | `--no-captions` | you'll subtitle in your publishing platform instead |
| Editor stems | `--stems` | you finish in Premiere/Resolve/CapCut: clean video track + timeline-aligned `narration.mp3` + `captions.srt`, everything lining up on drop-in |

## Redaction: capture over real data, safely

Demo videos usually get shot against real apps with real data in them. Ultrademo's answer is **in-page redaction**: your flow ships a small script that blurs sensitive content live in the page - so it applies to stills *and* clips, survives scrolling and navigation, and never modifies your app or its data. Blur by pattern (emails, account numbers) or by selector (a customer-name column), and whitelist what should stay visible:

```js
redactScript: `(() => {
  const RE = /@yourcompany\.com|ACC-\d+/;           // patterns to blur
  const sweep = () => {
    for (const el of document.querySelectorAll('span,div,p,a,td')) {
      if (!el.dataset.redacted && el.children.length === 0 && RE.test(el.textContent)) {
        el.style.filter = 'blur(6px)';
        el.dataset.redacted = '1';
      }
    }
  };
  new MutationObserver(sweep).observe(document.body, {childList: true, subtree: true, characterData: true});
  sweep(); setInterval(sweep, 400);
})();`,
```

The skill offers redaction whenever you're capturing real data, and its final frame check also sweeps for visible secrets (URL-bar tokens, keys in forms) before anything is presented. And because everything runs on your machine, unredacted frames never leave it in the first place.

## Re-runs: your UI changed, your video shouldn't go stale

Every video is a stored, re-runnable project - that's the point of the project folder. When your app ships an update days or months later:

```bash
node projects/<project>/reset.mjs        # if the flow mutates app state
npm run capture -- <project>             # same flow, fresh footage
npm run tts -- <project>                 # unchanged lines are cached - a visual refresh re-bills nothing
npm run render -- <project>
```

Previous renders are automatically archived to `projects/<project>/out/archive/`, so every re-run leaves a before/after pair. If the update was cosmetic, that's the whole job. If it broke a selector, the skill re-scouts just the affected surface and patches the flow; if the feature itself changed, you edit the narration and only the edited lines re-synthesize. Reprompt, not reshoot.

In Claude Code, `/ultrademo-rerun` does all of this for you: it lists your projects, checks your saved login still works, reads your repo's diff since the last capture when the code is available, and reports what visibly changed scene by scene.

## Capturing production apps

Rules the skill enforces and manual users should follow: scout read-only; never save settings on camera; know which actions cost money before recording them (retakes multiply the cost); give stateful flows a reset recipe; redact anything you would not show a stranger (see above).

## Security

Scanned with [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector) - **0/100, SAFE** with the committed baseline (New XP's original; the Zest fork's additions are listed in [`SECURITY-SCAN.md`](SECURITY-SCAN.md) and its baseline needs regenerating for SkillSpector 2.x). Every finding was triaged; the false positives (all heuristic matches on legitimate browser-automation and `.env` key-setup code) are documented with justifications in [`.skillspector-baseline.yaml`](.skillspector-baseline.yaml). Full write-up: [`SECURITY-SCAN.md`](SECURITY-SCAN.md). Reproduce with `skillspector scan . --no-llm --baseline .skillspector-baseline.yaml`.

## License

Apache-2.0 (see `LICENSE`). Note: Ultrademo depends on [Remotion](https://remotion.dev), which has its own license - free for individuals and small companies, but larger companies need a Remotion company license. Check your eligibility at remotion.dev/license.

---

Built by [New XP](https://newxp.co) · https://ultrademo.net
