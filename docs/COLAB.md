# Run on Google Colab (manual, recommended)

This is the easy path: a human (or an agent with a browser) clicks Run. ~60–110 min.

## 0. Prereqs
- A Google account. (Colab free tier gives a **T4 GPU** — enough.)
- Your audio file.

## 1. Open a notebook
Either:
- Click the **Open in Colab** badge in the repo `README.md`, **or**
- Go to <https://colab.research.google.com/#create=true> → a fresh notebook.

A fresh notebook is fine — all code is pulled from this repo by the cell below.

## 2. Set the runtime to GPU
Menu **Runtime → Change runtime type → T4 GPU → Save**.
(Russian UI: **Среда выполнения → Сменить среду выполнения → Графический процессор T4 → Сохранить**.)

> ⚠️ Do NOT try to use a GCP VM with a "$300 free trial" — the free tier blocks GPUs.
> Use Colab's free T4.

## 3. (optional but smart) Mount Google Drive
Caches model weights between runs and saves the final master to Drive (survives a VM reset):
```python
from google.colab import drive; drive.mount('/content/drive')
```
Click through the consent prompt. Then `run_all.sh` auto-detects the mount.

## 4. Upload your track
In the file panel, upload your audio to `/content/nm/colab/input/track.wav`
(after the clone in step 5), **or** upload anywhere and pass its path via `SRC=` below.
Simplest: run step 5's clone first, then drag your file into `colab/input/`.

## 5. Run the pipeline — ONE cell
```python
!git clone -q https://github.com/kymaman/neuro-mastering-colab.git /content/nm
# upload your file to /content/nm/colab/input/  (any name), then:
!NAME=mytrack STEPS=50 bash /content/nm/colab/run_all.sh
```
- `STEPS=50` for the default; `STEPS=100` for higher quality (~2× time).
- `NAME=` is just the output base name.
- To point at a specific file: add `SRC=/content/whatever.mp3`.

**Tip:** before the long run, sanity-check deps in ~1 min:
```python
!bash /content/nm/colab/test_asr.sh
```
It should print `ASR_OK:` and a 48000 sample-rate. If it fails, see ERRORS_AND_GOTCHAS.md.

## 6. Wait and collect
Watch the cell output. When done you'll see:
```
RESULT_WAV: {"data":{"url":"https://tmpfiles.org/XXXX"}}
RESULT_MP3: {"data":{"url":"https://tmpfiles.org/YYYY"}}
=== ALL DONE ===
```
To download: open the URL and insert `/dl/` →
`https://tmpfiles.org/dl/XXXX/track_FINAL.wav`.

> ⚠️ Some networks truncate the tmpfiles download to ~20 KB. If your file is tiny, you're
> being truncated — download through a different/clean network or a proxy. (Details in
> ERRORS_AND_GOTCHAS.md.) If you mounted Drive, the full master is also in
> `MyDrive/neuro-mastering/masters/`.

That `*_FINAL.wav` (compression + −14 LUFS) is your release-ready master.
