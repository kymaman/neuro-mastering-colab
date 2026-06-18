import os, sys, argparse, torch, torchaudio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huggingface_hub import hf_hub_download
from look2hear.models.apollo import Apollo

ap = argparse.ArgumentParser(description="Apollo restoration, per-channel, chunked overlap-add (VRAM-safe)")
ap.add_argument("--in_wav", required=True)
ap.add_argument("--out_wav", required=True)
ap.add_argument("--chunk_s", type=float, default=25.0)
ap.add_argument("--overlap_s", type=float, default=1.0)
args = ap.parse_args()

os.environ["CUDA_VISIBLE_DEVICES"] = "0"
print("loading Apollo (JusperLee/Apollo) ...", flush=True)
ckpt = hf_hub_download("JusperLee/Apollo", "pytorch_model.bin")
model = Apollo(sr=44100, win=20, feature_dim=256, layer=6)
state = torch.load(ckpt, map_location="cpu", weights_only=False)
if isinstance(state, dict) and "state_dict" in state:
    state = state["state_dict"]
model.load_state_dict(state, strict=True)
model = model.cuda().eval()

audio, sr = torchaudio.load(args.in_wav)              # [C, N]
if sr != 44100:
    audio = torchaudio.functional.resample(audio, sr, 44100); sr = 44100
C, N = audio.shape
chunk = int(args.chunk_s * sr)
ov = int(args.overlap_s * sr)
hop = chunk - ov
print(f"input {(C, N)} @ {sr}Hz | chunk={chunk} ov={ov} hop={hop}", flush=True)

def window(L):
    w = torch.ones(L)
    r = min(ov, L // 2)
    if r > 0:
        ramp = torch.linspace(0, 1, r + 1)[1:]
        w[:r] = ramp
        w[L - r:] = ramp.flip(0)
    return w

out = torch.zeros(C, N)
wsum = torch.zeros(N)
for ch in range(C):
    pos = 0
    while pos < N:
        end = min(pos + chunk, N)
        seg = audio[ch:ch+1, pos:end]                 # [1, L]
        with torch.no_grad():
            y = model(seg.unsqueeze(0).cuda()).squeeze(0).cpu()[0]   # [L]
        torch.cuda.empty_cache()
        L = end - pos
        y = y[:L]
        w = window(L)
        out[ch, pos:end] += y * w
        if ch == 0:
            wsum[pos:end] += w
        if end >= N:
            break
        pos += hop
        print(f"  ch{ch} {pos}/{N}", flush=True)

wsum[wsum == 0] = 1.0
out = out / wsum.unsqueeze(0)
os.makedirs(os.path.dirname(args.out_wav), exist_ok=True)
torchaudio.save(args.out_wav, out, sr)
print("WROTE", args.out_wav, tuple(out.shape), flush=True)
