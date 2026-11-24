import sys
from pathlib import Path

# Allow ``from backend import api`` when pytest is invoked from the repo root
# or from backend/ alike.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
