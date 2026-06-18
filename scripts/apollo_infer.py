import os, sys, argparse, torch, torchaudio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huggingface_hub import hf_hub_download
from look2hear.models.apollo import Apollo

ap = argparse.ArgumentParser(description="Apollo restoration (direct loader, per-channel)")
ap.add_argument("--in_wav", required=True)
ap.add_argument("--out_wav", required=True)
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

audio, sr = torchaudio.load(args.in_wav)          # [C, N]
if sr != 44100:
    audio = torchaudio.functional.resample(audio, sr, 44100)
    sr = 44100
print(f"input {tuple(audio.shape)} @ {sr}Hz", flush=True)

outs = []
with torch.no_grad():
    for ch in range(audio.shape[0]):
        x = audio[ch:ch + 1].unsqueeze(0).cuda()  # [1,1,N]
        y = model(x).squeeze(0).cpu()             # [1,N]
        outs.append(y)
out = torch.cat(outs, dim=0)                       # [C, N]
os.makedirs(os.path.dirname(args.out_wav), exist_ok=True)
torchaudio.save(args.out_wav, out, sr)
print("WROTE", args.out_wav, tuple(out.shape), flush=True)
