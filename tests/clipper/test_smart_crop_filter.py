"""Regression test for clipper smart-crop FFmpeg expression comma escaping.

Bug 1 (2026-05-13): get_smart_crop_filter built a crop expression with
literal unescaped commas inside max(...) / min(...). FFmpeg's filtergraph
parser treats unescaped commas as filter-chain separators, so the expression
fragmented at the first comma and the next fragment got interpreted as a
filter name, producing:

    No such filter: 'min(iw-ih*9/16'

...and exit code 8 from clipper-worker. The fix is to escape every comma
inside the expression with a single backslash so FFmpeg's parser keeps
the expression intact.

This test pins the invariant at the string-construction level so a future
edit to the f-string can't regress the escape. No FFmpeg invocation here;
end-to-end was verified manually against the live Ep 68 source in the same
session that introduced the fix.

Runs anywhere Python 3 is available — uses stdlib unittest and stubs the
clipper-worker's runtime deps (fastapi/pydantic/anthropic/boto3/httpx)
so importing main.py doesn't require those packages installed.

Run:
    python3 -m unittest tests/clipper/test_smart_crop_filter.py
"""
import importlib.util
import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


# --- Stub heavy runtime deps so main.py imports cleanly outside the worker ---

def _stub_module(name, attrs=None):
    if name in sys.modules:
        return
    mod = types.ModuleType(name)
    for k, v in (attrs or {}).items():
        setattr(mod, k, v)
    sys.modules[name] = mod


class _StubFastAPI:
    def __init__(self, *a, **kw):
        pass

    def _decorator(self, *a, **kw):
        return lambda f: f

    get = post = put = delete = _decorator


class _StubBaseModel:
    def __init_subclass__(cls, *a, **kw):
        pass

    def __init__(self, *a, **kw):
        pass


_stub_module("httpx")
_stub_module("anthropic", {"Anthropic": lambda *a, **kw: object()})
_stub_module("boto3", {"client": lambda *a, **kw: object()})
_stub_module("fastapi", {
    "FastAPI": _StubFastAPI,
    "HTTPException": type("HTTPException", (Exception,), {}),
})
_stub_module("pydantic", {
    "BaseModel": _StubBaseModel,
    "validator": lambda *a, **kw: (lambda f: f),
})


# --- Satisfy main.py's required env vars (it raises at import without them) ---

os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub-for-test")
os.environ.setdefault("ANTHROPIC_API_KEY", "stub-for-test")


# --- Load src/clipper/main.py without requiring it on the import path ---

_MAIN_PATH = Path(__file__).resolve().parents[2] / "src" / "clipper" / "main.py"
_spec = importlib.util.spec_from_file_location("clipper_main", _MAIN_PATH)
clipper_main = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(clipper_main)


class TestSmartCropFilter(unittest.TestCase):
    """Pin the comma-escape invariant introduced for Bug 1 (2026-05-13)."""

    def test_no_face_returns_center_crop_no_commas(self):
        """When no face is detected, the center-crop fallback has no commas
        at all — so there's nothing to escape and the parser handles it fine."""
        with patch.object(clipper_main, "detect_face_position", return_value=None):
            result = clipper_main.get_smart_crop_filter("/dev/null")
        self.assertEqual(result, "crop=ih*9/16:ih:(iw-ih*9/16)/2:0")
        self.assertNotIn(",", result)

    def test_face_detected_returns_escaped_commas(self):
        """When a face is detected, every comma inside max(...)/min(...) must
        be backslash-escaped. The Ep 68 fire was exactly this case with
        face_x_ratio=0.4546."""
        with patch.object(
            clipper_main, "detect_face_position", return_value=(0.4546, 0.5)
        ):
            result = clipper_main.get_smart_crop_filter("/dev/null")

        # The face_x_ratio is interpolated with 4 decimal places
        self.assertIn("0.4546", result)

        # Both inner commas must carry an escape backslash
        self.assertIn("max(0\\, min(", result)
        self.assertIn("ih*9/16\\, ", result)

        # And the bare unescaped equivalents must NOT appear — those are the
        # exact substrings that fragmented the filtergraph on Ep 68.
        self.assertNotIn("max(0, ", result)
        self.assertNotIn("ih*9/16, ", result)

    def test_face_detected_edge_ratios(self):
        """Escape invariant holds for any face_x_ratio in [0.0, 1.0]."""
        for ratio in (0.0, 0.5, 1.0):
            with self.subTest(face_x_ratio=ratio):
                with patch.object(
                    clipper_main, "detect_face_position", return_value=(ratio, 0.5)
                ):
                    result = clipper_main.get_smart_crop_filter("/dev/null")
                self.assertIn(f"{ratio:.4f}", result)
                self.assertIn("\\,", result)
                self.assertNotIn("max(0, ", result)
                self.assertNotIn("ih*9/16, ", result)


if __name__ == "__main__":
    unittest.main()
