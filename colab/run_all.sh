#!/usr/bin/env bash
# ============================================================================
# Neuro-mastering pipeline — ONE-SHOT (Colab or local Linux with NVIDIA GPU)
# ----------------------------------------------------------------------------
# Chain:  input -> 48k wav
#         -> Apollo (restoration, per-channel, chunked / VRAM-safe)
#         -> split L/R
#         -> AudioSR (super-resolution, ~40s segments, ddim_steps=STEPS)
#         -> join segments (RMS-match + 150ms equal-power crossfade)
#         -> declick (remove interior clicks)
#         -> tail-pop guard (kill end transient BEFORE the limiter)
#         -> master: glue compression + loudness (target -14 LUFS / -1 dBTP)
#         -> upload final wav+mp3 to tmpfiles.org, print URLs
#
# Models are MONO, so everything is processed per-channel (L then R).
#
# Env knobs:
#   NAME   output base name           (default: track)
#   SRC    input audio file           (default: $ROOT/colab/input/track.wav,
#                                       else first file found in colab/input/)
#   STEPS  AudioSR ddim_steps         (default: 50;  100 = higher quality, ~2x time)
#   ROOT   repo checkout dir          (default: /content/nm on Colab, else this repo)
#
# On Colab the cell that runs this is just:
#   !git clone -q https://github.com/kymaman/neuro-mastering-colab.git /content/nm \
#     && NAME=mytrack STEPS=100 bash /content/nm/colab/run_all.sh
# (upload your audio to /content/nm/colab/input/track.wav first, or pass SRC=)
# ============================================================================
set -e

# locate repo root (works on Colab clone OR a local checkout)
if [ -z "${ROOT:-}" ]; then
  if   [ -d /content/nm ];  then ROOT=/content/nm
  else ROOT="$(cd "$(dirname "$0")/.." && pwd)"; fi
fi

NAME="${NAME:-track}"
if [ -z "${SRC:-}" ]; then
  if [ -f "$ROOT/colab/input/track.wav" ]; then SRC="$ROOT/colab/input/track.wav"
  else SRC="$(find "$ROOT/colab/input" -type f \( -iname '*.wav' -o -iname '*.mp3' -o -iname '*.flac' -o -iname '*.m4a' \) 2>/dev/null | head -1)"; fi
fi
STEPS="${STEPS:-50}"
[ -n "$SRC" ] || { echo "NO INPUT: put a file in $ROOT/colab/input/ or pass SRC=/path/to/file"; exit 1; }
OUT=/content/out/$NAME; [ -w /content ] || OUT="$ROOT/out/$NAME"
mkdir -p "$OUT/stereo"
FF=ffmpeg; FP=ffprobe
echo "RUN: NAME=$NAME  SRC=$SRC  STEPS=$STEPS  ROOT=$ROOT  OUT=$OUT"

# === optional Google Drive cache (Colab) — protects the result from VM loss ===
DRIVE=""
if [ -d /content/drive/MyDrive ]; then
  DRIVE=/content/drive/MyDrive/neuro-mastering
  mkdir -p "$DRIVE/hf" "$DRIVE/pipcache" "$DRIVE/masters"
  export HF_HOME="$DRIVE/hf"; export HUGGINGFACE_HUB_CACHE="$DRIVE/hf"; export PIP_CACHE_DIR="$DRIVE/pipcache"
  echo "DRIVE cache ON -> $DRIVE (weights+wheels cached, master saved to Drive)"
else
  echo "DRIVE not mounted -> result only via tmpfiles. To enable: run a drive.mount cell first."
fi

echo "=== install deps ==="
apt-get -qq install -y ffmpeg >/dev/null 2>&1 || true
[ -d /content/Apollo ] || git clone -q https://github.com/JusperLee/Apollo.git /content/Apollo 2>/dev/null || \
  { [ -d "$ROOT/Apollo" ] || git clone -q https://github.com/JusperLee/Apollo.git "$ROOT/Apollo"; }
APOLLO=/content/Apollo; [ -d "$APOLLO" ] || APOLLO="$ROOT/Apollo"
pip -q install soundfile librosa pyloudnorm huggingface_hub ml-collections omegaconf >/dev/null 2>&1 || true
# AudioSR 0.0.7 pins numpy<=1.23.5 (won't build on py3.12). Install WITHOUT its deps,
# bring runtime deps ourselves, pin numpy<2 LAST; sitecustomize.py restores np.float aliases.
pip -q install --no-deps audiosr==0.0.7 >/dev/null 2>&1 || true
pip -q install torchlibrosa unidecode progressbar2 ftfy einops phonemizer timm chardet >/dev/null 2>&1 || true
pip -q install -r "$APOLLO/requirements.txt" >/dev/null 2>&1 || true
pip -q install 'numpy<2' >/dev/null 2>&1 || true   # MUST be last — AudioSR breaks on numpy 2.x
export PYTHONPATH="$ROOT/colab:$PYTHONPATH"
python -c "import numpy as n; print('numpy', n.__version__, 'np.float ok' if hasattr(n,'float') else 'NO np.float')"
echo "GPU:"; nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || echo "(no GPU — Apollo/AudioSR need CUDA)"

echo "=== 0. input -> 48k wav ==="
$FF -y -hide_banner -i "$SRC" -ar 48000 "$OUT/${NAME}.wav" >/dev/null 2>&1
$FP -v error -show_entries format=duration -of default=nw=1:nokey=1 "$OUT/${NAME}.wav"

echo "=== 1. Apollo (per-channel, chunked) ==="
export PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:256
cd "$ROOT" && PYTHONPATH="$APOLLO" python scripts/apollo_infer_chunked.py \
  --in_wav "$OUT/${NAME}.wav" --out_wav "$OUT/${NAME}_apollo.wav" --chunk_s 20 --overlap_s 1.0

echo "=== 2. split L/R ==="
$FF -y -hide_banner -i "$OUT/${NAME}_apollo.wav" \
  -filter_complex "channelsplit=channel_layout=stereo[l][r]" \
  -map "[l]" "$OUT/stereo/L.wav" -map "[r]" "$OUT/stereo/R.wav" >/dev/null 2>&1

SEG=40; OV=2; HOP=$((SEG-OV))
asr_long(){  # $1=in_mono  $2=out_48k  $3=workdir
  local IN="$1" OUTW="$2" W="$3"; rm -rf "$W"; mkdir -p "$W"
  local DUR; DUR=$($FP -v error -show_entries format=duration -of default=nw=1:nokey=1 "$IN")
  local i=0 start=0 outs=()
  while awk -v s="$start" -v d="$DUR" 'BEGIN{exit !(s < d-0.05)}'; do
    $FF -y -hide_banner -ss "$start" -t "$SEG" -i "$IN" -ar 44100 "$W/seg_$i.wav" >/dev/null 2>&1
    audiosr -i "$W/seg_$i.wav" -s "$W/seg_${i}_out" --ddim_steps "$STEPS" 2>&1 | tail -1
    outs+=("$(find "$W/seg_${i}_out" -name '*AudioSR*48K.wav' | head -1)")
    echo "  seg $i @ ${start}s"; start=$((start+HOP)); i=$((i+1))
  done
  python "$ROOT/scripts/join_segments.py" --out "$OUTW" --hop_s "$HOP" --overlap_s "$OV" --xfade_ms 150 --match 1 "${outs[@]}"
}
echo "=== 3a. AudioSR LEFT ===";  asr_long "$OUT/stereo/L.wav" "$OUT/stereo/L_48k.wav" "$OUT/stereo/L_chunks"
echo "=== 3b. AudioSR RIGHT ==="; asr_long "$OUT/stereo/R.wav" "$OUT/stereo/R_48k.wav" "$OUT/stereo/R_chunks"

echo "=== 4. join -> stereo 48k master ==="
MASTER="$OUT/${NAME}_MASTER.wav"
$FF -y -hide_banner -i "$OUT/stereo/L_48k.wav" -i "$OUT/stereo/R_48k.wav" \
  -filter_complex "[0:a][1:a]join=inputs=2:channel_layout=stereo[a]" -map "[a]" -ar 48000 "$MASTER" >/dev/null 2>&1

echo "=== 4b. declick ==="
python "$ROOT/scripts/declick.py" "$MASTER" --apply "${MASTER%.wav}_clean.wav" || cp "$MASTER" "${MASTER%.wav}_clean.wav"
MASTER="${MASTER%.wav}_clean.wav"

echo "=== 4c. tail-pop guard (AFTER diffusion, BEFORE compression; only cuts if a pop exists) ==="
python "$ROOT/scripts/tail_guard.py" "$MASTER" --apply "${MASTER%.wav}_tg.wav" && MASTER="${MASTER%.wav}_tg.wav" || echo "tail_guard skipped (err)"

echo "=== 5. master: glue compression + loudness (-14 LUFS / -1 dBTP) ==="
FINAL="$OUT/${NAME}_FINAL.wav"
$FF -y -hide_banner -i "$MASTER" \
  -af "acompressor=threshold=-20dB:ratio=2:attack=25:release=250:makeup=1.5:knee=6,loudnorm=I=-14:TP=-1.0:LRA=11" \
  -ar 48000 -c:a pcm_s24le "$FINAL" >/dev/null 2>&1
$FF -y -hide_banner -i "$FINAL" -b:a 320k "$OUT/${NAME}_FINAL.mp3" >/dev/null 2>&1
FI=$($FF -hide_banner -i "$FINAL" -af ebur128 -f null - 2>&1 | grep -EiA6 "Integrated loudness" | grep -Ei "I:" | tail -1 | grep -Eo -- "-?[0-9.]+" | head -1)
echo "FINAL_I=$FI LUFS"

echo "=== UPLOAD (tmpfiles.org; 0x0.st disabled, catbox blocks Colab IP) ==="
WURL=$(curl -s -F "file=@$FINAL" https://tmpfiles.org/api/v1/upload || true)
MURL=$(curl -s -F "file=@$OUT/${NAME}_FINAL.mp3" https://tmpfiles.org/api/v1/upload || true)
echo "RESULT_WAV: $WURL"
echo "RESULT_MP3: $MURL"
echo "NOTE: open the URL and insert /dl/ to direct-download -> tmpfiles.org/dl/<id>/<file>"

if [ -n "$DRIVE" ]; then
  cp "$FINAL" "$DRIVE/masters/${NAME}_mastered.wav" 2>/dev/null || true
  cp "$OUT/${NAME}_FINAL.mp3" "$DRIVE/masters/${NAME}_mastered.mp3" 2>/dev/null || true
  echo "SAVED_TO_DRIVE: $DRIVE/masters/${NAME}_mastered.wav (+ .mp3)"
fi
echo "=== ALL DONE ==="
