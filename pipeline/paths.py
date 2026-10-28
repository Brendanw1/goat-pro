"""Local data locations. Override with env vars when the mart lives elsewhere."""
import os
from pathlib import Path

VT_ROOT = Path(os.environ.get("VT_ROOT", Path.home() / "Projects" / "vt_baseball"))
MART_DIR = Path(os.environ.get("SAVANT_MART", VT_ROOT / "savant_mart"))
