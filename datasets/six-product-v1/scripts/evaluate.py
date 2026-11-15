"""Export image-only requests or compare app predictions against the manifest."""
import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from dataset import read_json


def image_cases(folder):
    return {
        hashlib.sha256(row["case_id"].encode()).hexdigest()[:24]: row
        for row in read_json(folder / "cases.json") if row["evaluation_mode"] == "image"
    }


def requests(folder):
    return [
        {"request_id": key, "selected_model_id": row["selected_model_id"], "image_path": row["image_path"]}
        for key, row in image_cases(folder).items()
    ]


def report(folder, predictions):
    cases = image_cases(folder)
    submitted = {}
    for row in predictions:
        key = row["request_id"]
        if key not in cases or key in submitted:
            raise ValueError(f"Unknown or duplicate request_id: {key}")
        submitted[key] = row["status"]
    counts = Counter()
    outcomes = {}
    missing = []
    for key, case in cases.items():
        expected = case["expected_status"]
        result = outcomes.setdefault(expected, {"expected": 0, "matched": 0, "missing": 0})
        result["expected"] += 1
        actual = submitted.get(key)
        if actual is None:
            result["missing"] += 1
            missing.append(key)
        elif actual == expected:
            result["matched"] += 1
        counts[expected, actual or "MISSING"] += 1
    return {
        "total_requests": len(cases), "predictions_received": len(submitted),
        "by_expected_status": outcomes,
        "confusion": [{"expected": a, "predicted": b, "n": n} for (a, b), n in sorted(counts.items())],
        "missing_request_ids": missing,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["requests", "score"])
    parser.add_argument("dataset", type=Path)
    parser.add_argument("file", type=Path, help="New requests JSON or existing predictions JSON")
    args = parser.parse_args()
    try:
        if args.command == "requests":
            with args.file.open("x", encoding="utf-8") as stream:
                json.dump(requests(args.dataset), stream, indent=2)
        else:
            print(json.dumps(report(args.dataset, read_json(args.file)), indent=2))
    except (KeyError, OSError, ValueError, TypeError) as exc:
        parser.exit(1, f"{exc}\n")
