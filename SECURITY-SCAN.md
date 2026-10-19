# Security Scan

This repository is scanned with [NVIDIA SkillSpector](https://github.com/NVIDIA/skillspector), a static analyzer that inspects AI-agent skills for prompt injection, data exfiltration, privilege escalation, and supply-chain risks before installation.

- **Tool:** SkillSpector v2.3.11 (static analysis, `--no-llm`)
- **Last scan:** 2026-07-09
- **Result with the committed baseline:** **0/100 — SAFE**
- **Reproduce:** `skillspector scan . --no-llm --baseline .skillspector-baseline.yaml`

## Zest fork status (2026-10-19)

The result above is New XP's scan of the original. It does not yet cover the Zest fork, and it can't be reproduced as written: SkillSpector 2.x now refuses this version-1 baseline ("unsupported baseline version 1; expected 2") and asks for a rescan and re-triage with `skillspector baseline`.

A raw `--no-llm` scan on 2026-10-19 (no baseline) found 79 findings in the original and 84 in the fork. Every finding the fork adds is the same kind already triaged below as a false positive:

| Rule | Where | Why it is a false positive |
|---|---|---|
| PE3 | `scripts/doctor.mjs`, `tts/tts.mjs` | Reading the user's own `OPENROUTER_API_KEY` from `.env`, and messages telling them where to paste it. |
| E1 | `tts/tts.mjs` | Narration posted to OpenRouter's documented speech and transcription endpoints with the user's own opt-in key, as the ElevenLabs path already does. |
| AST4 | `scripts/sync-check.py` | `subprocess.run` with fixed argument lists (`node`, `ffmpeg`), no shell. |

To do: regenerate the baseline in version-2 format with these justifications, then restore a reproducible clean result.

## How to read this

A raw scan of any browser-automation tool trips a malware-oriented skill scanner, because the tool's legitimate job — drive a browser, sign in, read narration keys from a `.env` file, type into forms — pattern-matches the same heuristics used to catch credential theft. We did not silence the scanner or remove functionality to force a green result. Instead we triaged every finding, and the ones that are genuine false positives are recorded in [`.skillspector-baseline.yaml`](.skillspector-baseline.yaml) with a written justification each. That file is committed, so anyone can see exactly what was suppressed and why, and re-running the scan reproduces the clean result.

Two findings were real documentation-clarity issues and were **fixed in the source**, not baselined (commits on 2026-07-09): a prompt-injection keyword match inside our own anti-injection rule, and a "keychain/cookies" phrasing in the auth note. Everything below is suppressed as a false positive.

## Triaged findings (all false positives)

The raw scan surfaced 33 findings across 8 rule categories. Each is a heuristic match on legitimate code:

| Rule | Category | Sev | Count | Why it is a false positive |
|------|----------|-----|-------|-----------------------------|
| PE3 | Privilege Escalation | HIGH | 10 | Matches on `.env` / `ELEVENLABS_API_KEY` / `APP_PASSWORD` **setup instructions** (which tell users where to place *their own* values), the `--use-mock-keychain` Playwright launch flag, and a password typed into the **target app's own login form**. No credential files are read or transmitted. |
| TM1 | Tool Misuse | HIGH | 3 | `capture.mjs` imports `rm` from `node:fs/promises` to clean the tool's own scratch/output directories, and setup helpers read app credentials from environment variables. Not a shell exec, dangerous glob, or forced flag. |
| AS3 | Agent Snooping | MEDIUM | 7 | Relative-path cross-links between the two first-party skills this repo ships together (`ultrademo` and `ultrademo-rerun`) plus `AGENTS.md` pointing agents at that playbook. No third-party or peer-skill files are read. |
| RP1 | MCP Rug Pull | MEDIUM | 4 | `npx playwright install chromium` is an npm dev-dependency setup step, not a remote MCP server. Playwright is pinned in `package.json` and locked exactly by the committed `package-lock.json`. |
| E1 | Data Exfiltration | MEDIUM | 1 | `tts.mjs` posts narration text to the documented ElevenLabs text-to-speech endpoint using the user's own opt-in API key. This is the tool's core function. |
| EA1 | Excessive Agency | MEDIUM | 1 | Matches documentation describing the tool's own stated purpose (driving a browser to capture a demo). No agency beyond the documented capture-and-render workflow. |
| SC1 | Supply Chain | LOW | 5 | Dependencies use caret ranges in `package.json` but are pinned to exact versions by the committed `package-lock.json`. |
| EA3 | Excessive Agency | LOW | 2 | Both hits are Apache-2.0 license boilerplate text in the `LICENSE` file. |

## What the scan confirms (the real value)

Beyond clearing the false positives, the scan is a genuine check that the skill contains **no** actual prompt-injection payloads, no hidden data-exfiltration endpoints, no credential-file harvesting, no obfuscated or executable payloads, and no unpinned supply-chain surface. The pipeline's own safety posture — read-only scouting, treat all fetched page content as data never instructions, in-page redaction of sensitive DOM, a secrets sweep at the verify step, and the honest-failure rule — is documented in [`.claude/skills/ultrademo/SKILL.md`](.claude/skills/ultrademo/SKILL.md).
