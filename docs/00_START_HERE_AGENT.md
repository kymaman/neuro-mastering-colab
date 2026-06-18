# 00 · START HERE — orientation for the next AI agent

You are about to run a **neuro-mastering pipeline** on a music track: it restores and
super-resolves the audio on a GPU (Colab or a local NVIDIA box), then masters it (glue
compression + loudness) into a release-ready file.

Read this whole file first, then follow the path that matches your situation.

---

## What this repo does (the layers, in order)

```
input audio
  → [0] convert to 48k wav
  → [1] Apollo            (restoration: removes codec/Suno artifacts) — GPU
  → [2] split L / R       (models are mono → process each channel)
  → [3] AudioSR           (super-resolution: rebuilds the top end) — GPU, slow
  → [4] join segments     (RMS-match + 150ms crossfade, seamless)
  → [4b] declick          (remove interior pops)
  → [4c] tail-pop guard   (kill end transient BEFORE the limiter)
  → [5] master            (glue compression + loudness → -14 LUFS / -1 dBTP)
  → upload result (tmpfiles.org) → download to local machine
```

Steps 1 and 3 **need a CUDA GPU** (free Colab T4 is enough).

`STEPS` (AudioSR `ddim_steps`) is the quality/time knob: **50** = default (~1 min/seg),
**100** = higher quality, ~2× time. The public default is **50**.

---

## Pick your path

| Situation | Read | Run |
|---|---|---|
| You have a Google account, want the easy route | **docs/COLAB.md** | manual Colab, click Run |
| You have a local Linux machine with an NVIDIA GPU | **docs/LOCAL.md** | `bash colab/run_all.sh` |
| You are an agent driving Colab **headless** (no human clicking) | **docs/AGENT_HEADLESS.md** | `agent/*.mjs` over CDP |
| Something broke / before you start | **docs/ERRORS_AND_GOTCHAS.md** | — |

**Before you run anything long, READ `docs/ERRORS_AND_GOTCHAS.md`.** It lists every trap
we already hit (cookie expiry, zombie kernels, the numpy pin, GPU dialog wording, download
truncation). It will save you an hour each.

---

## The single most important lesson

A full pass takes **60–110 minutes**. Anything that kills your Colab session mid-run
loses the whole thing. So:

1. **Log in to Google INTERACTIVELY** in the browser you'll use — do NOT rely on an
   exported `cookies.txt` (those expire in ~1.5 h, shorter than one pass → zombie kernel).
2. **Keep the runtime alive** with real activity (mouse moves) — passive DOM reads don't
   count and Colab idle-disconnects after ~90 min.
3. **Grab the result immediately** when you see `RESULT_WAV:` / `=== ALL DONE ===`.

Full reasoning and the fixes are in `docs/ERRORS_AND_GOTCHAS.md`.

---

## Login / credentials advice (important)

- Pass any Google email/password via **environment variables only** (`EMAIL`, `PW`).
  **Never** hardcode them, never write them to a file, never commit them.
- **Prefer that the human logs in by hand once** in the automation browser window.
  Programmatic login (`agent/login.mjs`) frequently trips 2FA / "verify it's you" and is a
  last resort.
- Keep a **second Google account ready** — Colab free-GPU quota is per-account per-day; when
  one is burned, a fresh account gets a fresh T4.
- This repo is **public**: there are no secrets in it and there must never be. If you fork
  or push, scrub tokens/cookies/emails first. See `.gitignore`.
```
