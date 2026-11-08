"""Put backend/scraper/ on sys.path so tests import the pipeline scripts as top-level modules."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
