import os

# Must be set BEFORE importing paddle or paddleocr
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_enable_mkldnn_bfloat16"] = "0"
os.environ["PADDLE_DISABLE_MKLDNN"] = "1"

import sys
import json
import traceback
import platform
from pathlib import Path

import numpy as np
import paddle
import paddleocr
from paddleocr import PaddleOCR


# ── helpers ──────────────────────────────────────────────────────────────────

def to_python(obj):
    """Recursively convert NumPy scalars / arrays to plain Python types."""
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (list, tuple)):
        return [to_python(v) for v in obj]
    if isinstance(obj, dict):
        return {k: to_python(v) for k, v in obj.items()}
    return obj


def parse_result(results):
    """
    Parse a PaddleOCR 3.x predict() result into clean dicts.

    PaddleOCR 3.x returns a list of result objects (one per image).
    Each result object exposes:
        result["rec_texts"]   – list[str]
        result["rec_scores"]  – list[float]
        result["rec_polys"]   – list[ndarray of shape (4,2)]  ← quad boxes
    All three lists are parallel (same length).
    """
    lines = []

    for page in results:          # one entry per input image
        # ── pull the three parallel arrays ──────────────────────────────────
        try:
            texts  = page["rec_texts"]
            scores = page["rec_scores"]
            polys  = page["rec_polys"]
        except (KeyError, TypeError):
            # Fallback: try attribute access (some builds expose as attrs)
            texts  = getattr(page, "rec_texts",  None)
            scores = getattr(page, "rec_scores", None)
            polys  = getattr(page, "rec_polys",  None)

        if texts is None:
            raise ValueError(
                f"Cannot find rec_texts in result. "
                f"Available keys/attrs: {_describe(page)}"
            )

        for text, score, poly in zip(texts, scores, polys):
            lines.append({
                "text":       str(text),
                "confidence": round(float(score), 4),
                "box":        to_python(poly),   # [[x,y],[x,y],[x,y],[x,y]]
            })

    return lines


def _describe(obj):
    """Best-effort description of an unknown result object for error messages."""
    if hasattr(obj, "keys"):
        return list(obj.keys())
    return dir(obj)


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    print("Python:", platform.python_version())
    print("PaddlePaddle:", paddle.__version__)
    print("PaddleOCR:", paddleocr.__version__)
    print()

    if len(sys.argv) != 2:
        print("Usage: python test_ocr.py <image_path>")
        return 2

    image_path = Path(sys.argv[1])
    if not image_path.is_file():
        print(f"Image not found: {image_path}")
        return 1

    print(f"Image: {image_path}")
    print("Initializing PaddleOCR...")

    try:
        ocr = PaddleOCR(
            lang="en",
            device="cpu",
            enable_mkldnn=False,
        )

        print("Running OCR...")
        results = ocr.predict(str(image_path))

        lines = parse_result(results)

        output = {
            "success": True,
            "text": lines,
        }

        print("\n" + json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    except Exception as e:
        output = {
            "success": False,
            "error":   f"{type(e).__name__}: {e}",
        }
        print("\n" + json.dumps(output, indent=2))
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())