#!/usr/bin/env python
# Join overlapping AudioSR segments of ONE channel into a single mono wav.
# Standard method (chosen by owner): "v5" = level-match + short 150 ms equal-power crossfade.
#   AudioSR normalizes each segment independently -> hard level jumps at seams.
#   We RMS-match each segment to the already-placed signal in the overlap zone,
#   then apply only a short equal-power crossfade to kill the click. Seamless.
#
# Usage:
#   python join_segments.py --out OUT.wav --hop_s 38 --overlap_s 2 SEG0.wav SEG1.wav ...
import argparse, numpy as np, soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--hop_s", type=float, default=38.0)
ap.add_argument("--overlap_s", type=float, default=2.0)
ap.add_argument("--xfade_ms", type=float, default=150.0)   # v5 short crossfade
ap.add_argument("--match", type=int, default=1)            # 1 = RMS level-match (v5)
ap.add_argument("segs", nargs="+")
a = ap.parse_args()

segs, SR = [], None
for p in a.segs:
    x, sr = sf.read(p, dtype="float64")
    if x.ndim > 1:
        x = x.mean(axis=1)
    SR = SR or sr
    assert sr == SR, f"sr mismatch {p}"
    segs.append(x)

ov = int(a.overlap_s * SR)
cf = max(1, int(a.xfade_ms / 1000.0 * SR))
starts = [int(round(i * a.hop_s * SR)) for i in range(len(segs))]
total = starts[-1] + len(segs[-1])
out = np.zeros(total)
out[starts[0]:starts[0] + len(segs[0])] = segs[0]
end = starts[0] + len(segs[0])
for i in range(1, len(segs)):
    seg = segs[i].copy()
    s = starts[i]
    n_ov = min(ov, len(seg), end - s)
    if a.match and n_ov > 4:
        aa = out[s:s + n_ov]; bb = seg[:n_ov]
        ra = np.sqrt(np.mean(aa * aa) + 1e-12); rb = np.sqrt(np.mean(bb * bb) + 1e-12)
        seg = seg * (ra / rb)
    c = min(cf, n_ov)
    t = np.linspace(0, 1, c, endpoint=False)
    fa, fb = np.cos(t * np.pi / 2), np.sin(t * np.pi / 2)   # equal power
    out[s:s + c] = out[s:s + c] * fa + seg[:c] * fb
    out[s + c:s + len(seg)] = seg[c:]
    end = s + len(seg)
out = out[:end]
peak = np.max(np.abs(out))
if peak > 0.999:
    out = out * (0.999 / peak)
sf.write(a.out, out.astype(np.float32), SR)
print(f"WROTE {a.out} {len(out)/SR:.2f}s peak={peak:.3f} (v5: match={a.match} xfade={a.xfade_ms}ms)")
