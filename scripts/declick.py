#!/usr/bin/env python
# Auto-detect & remove transient pops/spikes (sounds "like a cable was yanked out").
# KEY: compare each window-peak to its LOCAL neighbourhood (rolling median), not
# the global median. A pop in a quiet/fading section is ~100-300x the local level
# but only ~3x the global median, so global thresholds miss it. Musical transients
# (snare/kick) are only ~2-3x their local level and are left ALONE.
#
# Origin example: Apollo emits a huge end-spike (peak ~7.8) on the last ~25ms of a
# fading outro; it survives AudioSR/join as an isolated 0.9 spike over ~0.003 music.
#
# Repair: linear-interpolate across the spike span; if it sits at the very start/end,
# also apply a short edge fade so the track ends cleanly.
#
# Usage:  detect: python declick.py IN.wav      fix: python declick.py IN.wav --apply OUT.wav
import argparse, numpy as np, soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("inp")
ap.add_argument("--apply", default=None)
ap.add_argument("--k", type=float, default=8.0, help="spike thr = k x LOCAL median window-peak")
ap.add_argument("--ctx_ms", type=float, default=300.0, help="local context half-width")
ap.add_argument("--floor", type=float, default=0.02, help="ignore spikes below this abs amplitude")
ap.add_argument("--edge_s", type=float, default=0.5)
ap.add_argument("--edge_fade_ms", type=float, default=6.0)
a = ap.parse_args()

x, sr = sf.read(a.inp, dtype="float64")
X = x if x.ndim == 2 else x[:, None]
N = X.shape[0]
env = np.abs(X).max(axis=1)                          # per-channel max envelope

win = max(1, int(0.010 * sr))
wp = np.array([env[i:i + win].max() for i in range(0, N, win)])
nb = max(1, int(a.ctx_ms / 1000.0 * sr / win))       # context in windows
# rolling local median (exclude-ish self by using a wide window)
loc = np.empty(len(wp))
for j in range(len(wp)):
    lo = max(0, j - nb); hi = min(len(wp), j + nb + 1)
    loc[j] = np.median(wp[lo:hi]) + 1e-9

ratio = wp / loc
hot = np.where((ratio > a.k) & (wp > a.floor))[0]
edge_n = int(a.edge_s * sr)

def span_at(c):
    pk = env[c]; lim = max(0.25 * pk, a.floor)
    lo = c
    while lo > 0 and env[lo - 1] > lim: lo -= 1
    hi = c
    while hi < N - 1 and env[hi + 1] > lim: hi += 1
    return lo, hi

events, seen = [], set()
for hwin in hot:
    c0 = hwin * win
    c = c0 + int(np.argmax(env[c0:c0 + win]))
    lo, hi = span_at(c)
    if (lo // win) in seen: continue
    seen.add(lo // win)
    events.append(dict(c=c, lo=lo, hi=hi, pk=float(env[c]),
                       span_ms=(hi - lo + 1) / sr * 1000.0, ratio=float(ratio[hwin]),
                       edge=(c < edge_n or c > N - edge_n)))

print(f"file {a.inp} sr={sr} dur={N/sr:.3f}s")
print(f"spike events (>{a.k}x local): {len(events)}")
for e in events:
    print(f"  @ {e['c']/sr:8.3f}s  {'EDGE' if e['edge'] else 'interior':8} "
          f"span={e['span_ms']:5.1f}ms peak={e['pk']:.3f} local-ratio={e['ratio']:.0f}x")

if a.apply:
    y = X.copy()
    pad2 = int(0.002 * sr)
    end_from = None; start_to = None
    for e in events:
        if e["c"] > N - edge_n:
            # END pop: fade from its onset to the track end (kills spike + shoulder)
            end_from = e["lo"] - pad2 if end_from is None else min(end_from, e["lo"] - pad2)
        elif e["c"] < edge_n:
            start_to = e["hi"] + pad2 if start_to is None else max(start_to, e["hi"] + pad2)
        else:
            # interior click: linear-interpolate across the span
            lo2 = max(1, e["lo"] - 1); hi2 = min(N - 2, e["hi"] + 1)
            for ch in range(y.shape[1]):
                y[lo2:hi2 + 1, ch] = np.linspace(y[lo2 - 1, ch], y[hi2 + 1, ch], hi2 + 1 - lo2)
    fade_n = max(1, int(0.005 * sr))                 # 5ms micro-fade into the cut
    if end_from is not None:
        cut = max(fade_n + 1, end_from)
        y[cut:, :] = 0.0                              # zero everything from the pop onset
        y[cut - fade_n:cut, :] *= np.linspace(1, 0, fade_n)[:, None]
    if start_to is not None:
        cut = min(N - fade_n - 1, max(1, start_to))
        y[:cut, :] = 0.0
        y[cut:cut + fade_n, :] *= np.linspace(0, 1, fade_n)[:, None]
    out = y[:, 0] if x.ndim == 1 else y
    sf.write(a.apply, out.astype(np.float32), sr)
    print(f"WROTE {a.apply}  (events={len(events)}"
          f"{', end-fade@%.3fs'%(end_from/sr) if end_from is not None else ''}"
          f"{', start-fade' if start_to is not None else ''})")
