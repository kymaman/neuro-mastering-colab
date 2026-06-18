# Run on your own computer (no Colab)

The full pipeline (Apollo + AudioSR) needs an **NVIDIA GPU**. If you don't have one, use the
free Colab T4 instead — see [`COLAB.md`](COLAB.md).

## Full pipeline locally (needs NVIDIA GPU + CUDA)

Requirements:
- Linux (or WSL2). Native Windows is painful for AudioSR — use WSL2.
- NVIDIA GPU. **8 GB works** thanks to chunking; 6 GB is borderline. 16 GB+ is comfortable.
- Python 3.10–3.12, `ffmpeg`, `git`, a recent PyTorch with CUDA.

Steps:
```bash
git clone https://github.com/kymaman/neuro-mastering-colab.git
cd neuro-mastering-colab
# put your file here:
cp /path/to/your/song.mp3 colab/input/track.wav   # any audio; name it track.wav
# (the script can also take SRC=/abs/path and any format)

# create a venv with CUDA torch first (example):
python -m venv .venv && source .venv/bin/activate
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# run — ROOT defaults to the repo dir when /content doesn't exist
NAME=mytrack STEPS=50 bash colab/run_all.sh
```
The script installs the rest of the deps itself (Apollo, AudioSR with the numpy pin, etc.).
Output: `out/mytrack/mytrack_FINAL.wav` (+ `.mp3`) — glue compression + −14 LUFS, ready to
release. It still tries to upload to tmpfiles; the local files are the real output.

> If AudioSR errors about `np.float` / numpy: that's the known pin — `colab/sitecustomize.py`
> fixes it as long as `colab/` is on `PYTHONPATH` (run_all.sh sets this). See
> ERRORS_AND_GOTCHAS.md §A.

> CPU-only will technically import but is unusably slow / may not run the diffusion. Don't.

> `STEPS=50` is the default (the public setting); `STEPS=100` is slower / higher quality.
