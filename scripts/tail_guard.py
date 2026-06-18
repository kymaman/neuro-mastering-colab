#!/usr/bin/env python
# Tail-pop guard — catches a "pop" right at the very end of the track.
#
# Why separate from declick.py: declick compares a peak to the LOCAL median (±300ms). If the
# track fades out at the end (e.g. -13->-25 dB over 200ms) and a transient spikes in the last
# ~30ms, against the still-loud fade it's only ~4x the local level — the k=8 threshold misses
# it. And the limiter would then push that residual spike up to ~-1.4 dBFS.
#
# Guard idea: in a normal ending the last ms are the QUIETEST (natural decay or a hard stop
# into silence). A "pop" makes the very tail LOUDER than the region just before it. We compare
# the peak of the last tail_ms to a reference window (end-ref_hi_ms .. end-ref_lo_ms). If the
# tail is clearly louder than the reference, it's an end transient -> fade the last ms to zero.
#
# Run:  detect: python tail_guard.py IN.wav
#       fix:    python tail_guard.py IN.wav --apply OUT.wav
import argparse, numpy as np, soundfile as sf

ap = argparse.ArgumentParser()
ap.add_argument("inp")
ap.add_argument("--apply", default=None)
ap.add_argument("--tail_ms", type=float, default=70.0, help="window of the very tail")
ap.add_argument("--ref_lo_ms", type=float, default=80.0, help="reference: from end-ref_lo (near edge)")
ap.add_argument("--ref_hi_ms", type=float, default=500.0, help="reference: to end-ref_hi (far edge)")
ap.add_argument("--ratio", type=float, default=1.4, help="tail is a pop if peak > ratio*reference")
ap.add_argument("--floor", type=float, default=0.02, help="ignore tails quieter than this (silence is fine)")
ap.add_argument("--fade_ms", type=float, default=12.0, help="micro-fade into the cut point")
a = ap.parse_args()

x, sr = sf.read(a.inp, dtype="float64")
X = x if x.ndim == 2 else x[:, None]
N = X.shape[0]
env = np.abs(X).max(axis=1)

n_tail = min(N, int(a.tail_ms / 1000.0 * sr))
n_rlo  = int(a.ref_lo_ms / 1000.0 * sr)
n_rhi  = int(a.ref_hi_ms / 1000.0 * sr)

tail_pk = float(env[N - n_tail:].max())
ref_seg = env[max(0, N - n_rhi):max(0, N - n_rlo)]
ref_pk  = float(ref_seg.max()) if ref_seg.size else 0.0

is_pop = (tail_pk > a.floor) and (tail_pk > a.ratio * (ref_pk + 1e-9))
print(f"file {a.inp} sr={sr} dur={N/sr:.3f}s")
print(f"tail_peak(last {a.tail_ms:.0f}ms)={tail_pk:.4f} ({20*np.log10(tail_pk+1e-12):.1f}dB)  "
      f"ref_peak={ref_pk:.4f} ({20*np.log10(ref_pk+1e-12):.1f}dB)  ratio={tail_pk/(ref_pk+1e-9):.2f}")
print("TAIL_POP: YES" if is_pop else "TAIL_POP: no")

if a.apply:
    y = X.copy()
    if is_pop:
        # peak of the pop inside the tail window, then walk BACK from the peak to the natural level (onset)
        peak_idx = (N - n_tail) + int(np.argmax(env[N - n_tail:]))
        thr = max(a.floor, ref_pk)
        cut = peak_idx
        while cut > 1 and env[cut - 1] > thr:
            cut -= 1
        cut = max(1, cut - int(0.002 * sr))            # 2ms padding back to the onset
        fade_n = max(1, min(cut - 1, int(a.fade_ms / 1000.0 * sr)))
        y[cut:, :] = 0.0
        y[cut - fade_n:cut, :] *= np.linspace(1, 0, fade_n)[:, None]
        print(f"FIXED: faded tail from {cut/sr:.3f}s to end ({(N-cut)/sr*1000:.0f}ms zeroed, {a.fade_ms:.0f}ms fade)")
    else:
        print("no change")
    out = y[:, 0] if x.ndim == 1 else y
    sf.write(a.apply, out.astype(np.float32), sr)
    print(f"WROTE {a.apply}")
