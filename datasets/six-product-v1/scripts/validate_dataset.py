"""Validate manifest, hashes, labels, and closed-set catalog assumptions."""
import argparse
import hashlib
import json
from pathlib import Path

from dataset import CATALOG, CASE_FIELDS, ASSET_FIELDS, read_json


def validate(folder):
    assets = read_json(folder / "assets.json")
    cases = read_json(folder / "cases.json")
    errors = []
    asset_ids = set()
    hashes = set()
    for asset in assets:
        missing = set(ASSET_FIELDS) - set(asset)
        if missing:
            errors.append(f"{asset.get('asset_id')}: missing fields {sorted(missing)}")
        aid = asset.get("asset_id")
        if aid in asset_ids:
            errors.append(f"duplicate asset_id {aid}")
        asset_ids.add(aid)
        path = folder / asset["image_path"]
        if not path.exists():
            errors.append(f"missing image {asset['image_path']}")
        else:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest != asset["sha256"]:
                errors.append(f"hash mismatch {asset['image_path']}")
            if digest in hashes:
                errors.append(f"duplicate image bytes {asset['image_path']}")
            hashes.add(digest)
        model = asset["model_id"]
        if model not in {*CATALOG, "unsupported", "unknown"}:
            errors.append(f"outside catalog model {model}")
        if asset["origin"] in {"ai_generated", "generated_synthetic"} and asset["usage_rights"] == "real photo":
            errors.append(f"synthetic asset mislabelled as real {aid}")
    for case in cases:
        if set(CASE_FIELDS) - set(case):
            errors.append(f"{case.get('case_id')}: missing case fields")
        if case["asset_id"] and case["asset_id"] not in asset_ids:
            errors.append(f"{case['case_id']}: unknown asset")
        if case["selected_model_id"] not in CATALOG:
            errors.append(f"{case['case_id']}: selected model outside six-model catalog")
    if errors:
        raise AssertionError("\n".join(errors))
    return {"assets": len(assets), "cases": len(cases), "models": list(CATALOG)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.dataset), indent=2))
    except (AssertionError, OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"{exc}\n")
