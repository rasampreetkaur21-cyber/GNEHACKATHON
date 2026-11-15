from pathlib import Path
import sys, json
root=Path(__file__).resolve().parents[2]/"datasets"/"six-product-v1"
sys.path.insert(0,str(root/"scripts"))
from evaluate import requests
rows=requests(root/"data")
(root/"benchmark"/"requests.generated.json").write_text(json.dumps(rows,indent=2)+"\n",encoding="utf-8")
print(f"Generated {len(rows)} frozen image requests; no predicted labels or model metrics were fabricated.")
