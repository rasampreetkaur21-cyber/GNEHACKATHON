"""Import manually labelled local camera photos without modifying originals."""
import argparse
import csv
import re
from pathlib import Path

from cases import save_cases
from dataset import (
    ASSET_FIELDS, CATALOG, QUALITY, image_record, inside, new_batch, open_rgb,
    sha256, write_tables,
)

INTAKE_FIELDS = (
    "file", "subject_model_id", "subject", "device_group_id", "split", "angle",
    "condition", "quality", "identity_basis", "visible_model_evidence",
    "source_page", "creator", "usage_rights", "license_url", "notes",
)


def import_photos(source, labels, destination):
    with labels.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not set(INTAKE_FIELDS).issubset(reader.fieldnames or ()):
            raise ValueError("Use the headers in templates/photo_intake.csv.")
        inputs = [
            {key: (row.get(key) or "").strip() for key in INTAKE_FIELDS}
            for row in reader if any(row.values())
        ]
    if not inputs:
        raise ValueError("Add at least one labelled image to the intake CSV.")

    group_labels = {}
    seen_hashes = set()
    normalized_hashes = set()
    assets = []
    with new_batch(destination) as folder:
        for row in inputs:
            model = row["subject_model_id"]
            visibility = row["visible_model_evidence"]
            group = row["device_group_id"]
            split = row["split"]
            if model not in {*CATALOG, "unsupported", "unknown"}:
                raise ValueError(f"Unknown model ID: {model}")
            if split not in {"train", "val", "test", "demo"} or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", group):
                raise ValueError("Set a valid device_group_id and split for every image.")
            if group_labels.setdefault(group, (model, split)) != (model, split):
                raise ValueError(f"Physical device group has conflicting model or split: {group}")
            if row["quality"] not in QUALITY or visibility not in {"device_linked", "outside_catalog", "absent"}:
                raise ValueError(f"Invalid quality or visible_model_evidence for {row['file']}")
            if visibility == "outside_catalog" and model != "unsupported":
                raise ValueError("outside_catalog requires subject_model_id=unsupported")
            if model == "unknown" and visibility != "absent":
                raise ValueError("An unknown model requires visible_model_evidence=absent")
            if visibility == "device_linked" and model not in CATALOG:
                raise ValueError("Use outside_catalog for an identified unsupported device.")
            for required in ("subject", "angle", "condition", "identity_basis", "creator", "usage_rights"):
                if not row[required]:
                    raise ValueError(f"Set {required} for {row['file']}")
            source_file = inside(source, row["file"])
            source_hash = sha256(source_file)
            if source_hash in seen_hashes:
                raise ValueError(f"Duplicate input bytes: {row['file']}")
            seen_hashes.add(source_hash)
            image = open_rgb(source_file)
            image.thumbnail((1920, 1920))
            record = image_record(folder, f"capture-{source_hash[:20]}", image, {
                **row, "origin": "camera_photo", "model_id": model,
                "changes": "EXIF orientation applied, downscaled as needed, re-encoded without metadata",
            })
            if record["sha256"] in normalized_hashes:
                raise ValueError(f"Duplicate image after normalization: {row['file']}")
            normalized_hashes.add(record["sha256"])
            assets.append(record)
        assets = write_tables(folder, "assets", ASSET_FIELDS, assets)
        save_cases(folder, assets)
    return assets


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--labels", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(f"Imported {len(import_photos(args.input, args.labels, args.out))} photos.")
    except (OSError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
