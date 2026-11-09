"""Convert the fp32 U-Net sketch model to float16 and verify equivalence.

Outputs:
  public/models/model.fp16.onnx   (~half the size, GPU-friendly)
  logs the byte sizes + a numeric output-diff report for confidence.

Run:  python scripts/convert_fp16.py
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
from onnxruntime.transformers import float16 as ort_fp16

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "models" / "model.onnx"
OUT = ROOT / "public" / "models" / "model.fp16.onnx"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    model = onnx.load(str(SRC))
    fp32_bytes = SRC.stat().st_size

    # keep_io_types=True keeps the [1,3,256,256] fp32 input and fp32 output
    # contract, so the app's pre/post-processing does not change at all.
    converted = ort_fp16.convert_float_to_float16(model, keep_io_types=True)
    onnx.save(converted, str(OUT))
    fp16_bytes = OUT.stat().st_size

    print(f"fp32 model: {fp32_bytes/1e6:.1f} MB  sha256={sha256(SRC)[:16]}…")
    print(f"fp16 model: {fp16_bytes/1e6:.1f} MB  sha256={sha256(OUT)}")
    print(f"reduction : {100 * (1 - fp16_bytes / fp32_bytes):.1f}%")

    # ---- numeric verification on a real-ish input ----
    import onnxruntime as ort

    rng = np.random.default_rng(7)
    # generate small then upscale to be photo-like (smooth-ish)
    k = 8
    x = rng.random((1, 3, 256 // k, 256 // k), dtype=np.float32).astype(np.float32)
    x = np.repeat(np.repeat(x, k, axis=2), k, axis=3)

    def run(path: str) -> np.ndarray:
        so = ort.SessionOptions()
        so.log_severity_level = 3  # silence the fp16 node-assignment warnings
        s = ort.InferenceSession(path, sess_options=so, providers=["CPUExecutionProvider"])
        (y,) = s.run(None, {s.get_inputs()[0].name: x})
        return y

    y32 = run(str(SRC))
    y16 = run(str(OUT))
    diff = np.abs(y32.astype(np.float32) - y16.astype(np.float32))
    print(
        "output diff: max={:.5f} mean={:.6f} p99={:.5f}".format(
            float(diff.max()), float(diff.mean()), float(np.percentile(diff, 99))
        )
    )
    print(f"fp32 out range [{y32.min():.3f}, {y32.max():.3f}] | fp16 out range [{y16.min():.3f}, {y16.max():.3f}]")
    ok = diff.max() < 0.05
    print("VERDICT:", "OK — visually equivalent" if ok else "TOO DIFFERENT — do not ship")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
