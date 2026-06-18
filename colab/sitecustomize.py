# Auto-imported by Python at startup when this dir is on PYTHONPATH.
# Restores numpy aliases removed in numpy>=1.24 so AudioSR 0.0.7 (which expects
# numpy<=1.23.5) runs on Colab's numpy 1.26 / Python 3.12 without source-building 1.23.5.
import numpy as _np
for _k, _a in [("float", "float64"), ("int", "int_"), ("complex", "complex128"),
               ("bool", "bool_"), ("object", "object_"), ("str", "str_"), ("long", "int_")]:
    if not hasattr(_np, _k):
        try:
            setattr(_np, _k, getattr(_np, _a))
        except Exception:
            pass
