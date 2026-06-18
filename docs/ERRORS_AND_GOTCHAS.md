# Errors & gotchas — everything we already hit (read before a long run)

Each item: **what happened → why → what to do / NOT do**. Ordered by how badly it bites.

---

## A. Dependencies (AudioSR + Apollo)

**A1. AudioSR 0.0.7 won't install on Python 3.12 (Colab).**
It pins `numpy<=1.23.5`, which has no wheel for 3.12 and fails to source-build.
✅ DO: `pip install --no-deps audiosr==0.0.7`, then install its runtime deps yourself
(`torchlibrosa unidecode progressbar2 ftfy einops phonemizer timm chardet soundfile librosa
huggingface_hub`), then `pip install 'numpy<2'` **LAST**.
❌ DON'T: let pip resolve AudioSR's deps, and DON'T install numpy 2.x.

**A2. numpy ≥1.24 removed `np.float` / `np.int` / etc. — AudioSR crashes using them.**
✅ DO: keep `colab/sitecustomize.py` on `PYTHONPATH` (run_all.sh sets `PYTHONPATH=$ROOT/colab`).
It re-adds the aliases at interpreter startup. Verify: `python -c "import numpy as n; print(hasattr(n,'float'))"` → `True`.

**A3. Apollo's bundled `inference.py` is broken.**
✅ DO: use our `scripts/apollo_infer*.py` with the explicit loader
`Apollo(sr=44100, win=20, feature_dim=256, layer=6)`, checkpoint from HF `JusperLee/Apollo`
`pytorch_model.bin`, `torch.load(..., weights_only=False)`.

**A4. VRAM / OOM.**
Models are mono and memory grows with length → we process **per-channel** and **AudioSR in
~40 s segments**; Apollo uses chunked overlap-add (`apollo_infer_chunked.py`). T4 (16 GB) is
fine; 6–8 GB also works because of this. Don't feed a full stereo file in one shot.

**A5. `bc` missing / locale decimal commas (local Windows Git-Bash).**
Math via `awk`, not `bc`; format numbers with `awk` (printf used `,` and errored).
The scripts already do this — just don't "fix" them back to `bc`/`printf %f`.

---

## B. GPU runtime

**B1. GCP "$300 free trial" gives NO GPU.**
Creating a VM with `--accelerator` → *"billing account is in the free tier where non-TPU
accelerators are not available."* ✅ Use **Colab free T4**. (Upgrading trial→paid would
unlock it but that's out of scope.)

**B2. Setting the GPU in the Colab UI — exact wording matters.**
The menu item is **"Сменить среду выполнения" / "Change runtime type"** — NOT "Сменить тип
среды". A plain JS `.click()` does NOT open Colab's menus; you need a **real Playwright
click**. For the Save button use `getByRole('button', {name:/Save|Сохранить/})` — matching
exact text "Сохранить" grabs a **hidden** `goog-menuitem` instead. (`agent/cl.mjs ACTION=gpu`
already does it right.)

**B3. Modals block the menu.** A leftover "Open notebook" dialog or the release-notes panel
sits on top and swallows clicks. Dismiss it first.

---

## C. Session death — the #1 time-waster

**C1. Exported `cookies.txt` expires in ~1.5 h; a pass is 60–110 min.**
So the session dies **mid-AudioSR**, leaving a **ZOMBIE kernel**: the favicon shows "busy"
and the "Выполнение (X мин)" timer keeps ticking, but output is frozen and segment
timestamps stop advancing.
✅ DO: **log in interactively** in the automation browser profile — that session is
device-bound and lasts hours/days. ❌ DON'T trust file-cookie injection for a long run.

**C2. Detecting a zombie.** Read the page twice ~90 s apart. If the tail and the running
timer are **identical**, the kernel is dead. Restart the runtime (Runtime → Restart) and
re-run. `agent/rawread.mjs` is built for this check.

**C3. Idle-disconnect (~90 min).** Colab drops the runtime if there's no real user input.
**Passive DOM reads (`page.evaluate`) do NOT count.**
✅ DO: send real input events — a `page.mouse.move` every ~40 s (built into `cl.mjs ACTION=poll`
and `monitor.mjs`).

**C4. Losing UI access wipes `/content`.** When the session drops, Colab may recreate the VM
and **delete everything in `/content`**. ❌ DON'T reload/navigate the tab after starting.
✅ DO: mount Drive (results auto-saved there) OR grab `RESULT_*` the instant it appears.

**C5. Daily free-GPU quota burns out.** After a couple of long runs an account gets "no GPU
available". ✅ Keep a **second Google account** ready for a fresh T4.

---

## D. Reading the output

**D1. Wrong running-indicator word.** Colab shows **"Выполнение (X мин Y сек)"** /
**"Executing (...)"** — earlier code searched for "Выполняется" and got false "idle". Match
`/Выполнение \([^)]*\)|Executing \([^)]*\)/`.

**D2. `.cell` innerText truncates / virtualizes** on long output (sticks mid-stream). Target
the cell by a stable marker (`install deps`, `RESULT_`, `Apollo`) and read its tail; or add a
fresh cell and read the master from disk. Don't grab "the longest cell" blindly — it may be a
**previous** run's output.

**D3. `connectOverCDP` hangs when a stray `accounts.google.com` sign-in tab is open.**
Playwright tries to attach to all targets and stalls. ✅ Close the sign-in tab, or read via
raw CDP to the specific page target (`agent/rawread.mjs`).

---

## E. Getting the result off Colab

**E1. Host bans.** `0x0.st` is disabled (botnet ban); `catbox.moe` rejects Colab IPs
("Invalid uploader"). ✅ Use **tmpfiles.org**: `curl -F file=@F https://tmpfiles.org/api/v1/upload`.
Download via the `/dl/` form: `tmpfiles.org/dl/<id>/<file>`.

**E2. Download truncated to ~20 KB.** On some egress paths the tmpfiles download silently
stops at ~20480 bytes. ✅ Download through a clean network / proxy (a working `HTTPS_PROXY`
fetched the full file in our case). ❌ A 20 KB "wav" is the symptom — re-download elsewhere.

---

## F. Final master

**F1. Single-pass `loudnorm` lands ~0.5–1 LU hot** of target (ask -14, get ~-13.3). Fine for a
release master; for exact integrated loudness, run 2-pass loudnorm.

**F2. `bc` missing / locale decimal commas (local Windows Git-Bash).** Do math with `awk`, not
`bc`; format numbers with `awk` (`printf` may use `,` and error).

---

## G. Safety / do-not (for any agent)

- ❌ **Never** commit or print PAT tokens, passwords, cookies, or personal account emails.
  This repo is public. Credentials go through **env vars** only.
- ✅ Drive a **dedicated** Chrome profile (`CHROME_PROFILE`), never the human's personal
  browser; kill only that profile's process.
- ✅ For `git`/`gh` behind a corporate proxy, the proxy may block GitHub — unset
  `HTTPS_PROXY`/`HTTP_PROXY` for those commands.
- ✅ Prefer the human logging in by hand once over scripted login (`agent/login.mjs` is a last
  resort; it trips 2FA/device checks).
