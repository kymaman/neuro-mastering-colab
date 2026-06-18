#!/usr/bin/env bash
# Quick validation that the AudioSR CLI works (numpy fix applied) BEFORE the long run.
# Run this first on a fresh runtime — it fails in ~1 min if deps are wrong,
# instead of dying 40 min into the real pass.
set -e
ROOT="${ROOT:-/content/nm}"; [ -d "$ROOT" ] || ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$(find "$ROOT/colab/input" -type f 2>/dev/null | head -1)}"
pip -q install --no-deps audiosr==0.0.7 >/dev/null 2>&1 || true
pip -q install torchlibrosa unidecode progressbar2 ftfy einops phonemizer timm chardet soundfile librosa huggingface_hub >/dev/null 2>&1 || true
pip -q install 'numpy<2' >/dev/null 2>&1 || true
export PYTHONPATH="$ROOT/colab:$PYTHONPATH"
python -c "import numpy as n; print('numpy', n.__version__, 'np.float', hasattr(n,'float'))"
echo "--- audiosr --help ---"; audiosr --help 2>&1 | tail -4 || echo "HELP FAILED"
[ -n "$SRC" ] || { echo "no input file in $ROOT/colab/input — skipping audio test"; exit 0; }
mkdir -p /content/asrtest 2>/dev/null || mkdir -p "$ROOT/asrtest"
TD=/content/asrtest; [ -d "$TD" ] || TD="$ROOT/asrtest"
ffmpeg -y -hide_banner -ss 10 -t 6 -i "$SRC" -ac 1 -ar 44100 "$TD/seg.wav" >/dev/null 2>&1
echo "--- AudioSR on 6s mono clip (ddim 25) ---"
audiosr -i "$TD/seg.wav" -s "$TD/out" --ddim_steps 25 2>&1 | tail -6
O=$(find "$TD/out" -name '*AudioSR*48K.wav' 2>/dev/null | head -1)
if [ -n "$O" ]; then echo "ASR_OK: $O"; ffprobe -v error -show_entries stream=sample_rate,channels -of default=nw=1 "$O"; else echo "ASR_FAIL: no 48K output"; fi
