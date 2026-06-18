# Driving Colab headless (for an AI agent, via Chrome + CDP)

Use this only if **no human can click Run**. It drives a dedicated Chrome over the Chrome
DevTools Protocol with Playwright. If a human is available, `docs/COLAB.md` is far more
reliable — read `docs/ERRORS_AND_GOTCHAS.md` §C first either way.

## Why a dedicated Chrome profile
- Colab needs a real, authenticated browser session. A dedicated `--user-data-dir` keeps the
  human's personal browser untouched and lets you log in once and reuse it.
- Pick a debug `PORT` that doesn't collide with any other automation on the machine.

## One-time setup
```bash
cd agent
npm install                      # installs playwright
# launch the dedicated Chrome with CDP and open Colab:
PORT=9333 ACTION=boot node cl.mjs
```
Then **log in to Google by hand in that Chrome window** (the one that just opened). This
device-bound session survives the whole run — do not skip this. (`COOKIES=` file injection
exists but expires mid-run; avoid it.)

## Sequence (the order that works)
```bash
# 1. fresh notebook → capture its id
PORT=9333 node newnb.mjs                      # prints NEW NBID

# 2. set GPU = T4
PORT=9333 NBID=<id> ACTION=gpu node cl.mjs

# 3. quick dep check (~1 min) — fail fast before the long run
PORT=9333 NBID=<id> ACTION=cmd WAITSEC=90 \
  LABEL="test_asr" \
  CMD='!git clone -q https://github.com/kymaman/neuro-mastering-colab.git /content/nm; bash /content/nm/colab/test_asr.sh' \
  node cl.mjs
# look for ASR_OK

# 4. get the track into /content/nm/colab/input/ (headless = host it somewhere and wget;
#    files.upload() needs a human, so for a pure-headless agent use a URL):
PORT=9333 NBID=<id> ACTION=cmd WAITSEC=30 LABEL="fetch track" \
  CMD='!mkdir -p /content/nm/colab/input && wget -qO /content/nm/colab/input/track.wav "https://YOUR_HOST/track.wav" && ls -la /content/nm/colab/input' \
  node cl.mjs
#    (or pass SRC=/content/whatever to run_all.sh in step 5 if the file is elsewhere)

# 5. start the full pipeline (one-line cell — Monaco mangles multi-line paste)
PORT=9333 NBID=<id> ACTION=cmd WAITSEC=20 \
  LABEL="run_all STEPS=50" \
  CMD='!NAME=mytrack STEPS=50 bash /content/nm/colab/run_all.sh' \
  node cl.mjs

# 6. monitor until done (keepalive built in). MARK stops the loop.
PORT=9333 NBID=<id> MARK="ALL DONE" POLLMIN=130 node monitor.mjs
```
Then download the `RESULT_*` URL (via `/dl/`, through a clean egress) — that `*_FINAL.wav`
is the finished master.

## Hard rules while it runs (from real failures)
- **Keepalive**: every poll iteration does a real `page.mouse.move`. Don't replace it with a
  pure DOM read — Colab idle-disconnects (~90 min) and you get a zombie.
- **Don't reload/navigate** the notebook tab after start — losing UI access wipes `/content`.
- **Detect zombies**: if `monitor.mjs` shows the same tail + frozen "Выполнение" timer across
  two cycles, the kernel is dead → restart runtime, re-run. Use `rawread.mjs` if
  `connectOverCDP` itself hangs (stray sign-in tab).
- **One-line cells only**: `cl.mjs ACTION=cmd` uses `insertText`; multi-line code gets
  auto-indented/garbled by Monaco. Chain with `;` and `&&` on a single line.
- **Result is server-side**: the pipeline runs on Google's VM, so a brief CDP/proxy blip does
  not abort it — but the runtime only stays alive while the authenticated tab is connected and
  active (hence keepalive + durable login).

## Files in `agent/`
| file | purpose |
|---|---|
| `cl.mjs` | boot Chrome / set GPU / run a cell / poll / read state (`ACTION=`) |
| `newnb.mjs` | create a fresh notebook, print its NBID |
| `monitor.mjs` | read-only progress watch + keepalive, stop on `MARK` |
| `rawread.mjs` | raw-CDP read of the Colab tab (bypasses connectOverCDP hang) |
| `login.mjs` | scripted Google login (LAST RESORT; env `EMAIL`/`PW`, prefer manual) |

All paths/ids/credentials come from **env vars** — nothing personal is baked in.
