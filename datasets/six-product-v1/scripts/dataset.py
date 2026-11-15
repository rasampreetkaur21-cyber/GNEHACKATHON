"""Shared manifest and photo helpers."""
import csv
import hashlib
import json
import shutil
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageOps

CATALOG_PATH = Path(__file__).resolve().parents[1] / "catalog.json"
CATALOG = {row["model_id"]: row for row in json.loads(CATALOG_PATH.read_text(encoding="utf-8"))}

ASSET_FIELDS = (
    "asset_id", "image_path", "sha256", "width", "height", "origin", "model_id",
    "prompted_model_id", "subject", "identity_basis", "visible_model_evidence",
    "angle", "condition", "quality", "device_group_id", "split", "parent_asset_id",
    "source_page", "source_image_url", "source_title", "creator", "usage_rights",
    "license_url", "changes", "notes",
)
CASE_FIELDS = (
    "case_id", "asset_id", "image_path", "selected_model_id", "identity_relation",
    "expected_status", "reason_code", "reason", "next_action", "evaluation_mode",
    "evidence_quality", "observed_relation", "authenticity_signal", "split",
)
QUALITY_REASONS = {
    "blurry": "RETAKE_BLUR",
    "dark": "RETAKE_DARK",
    "cropped": "RETAKE_CROP",
    "occluded": "RETAKE_OCCLUSION",
    "glare": "RETAKE_GLARE",
    "low_resolution": "RETAKE_RESOLUTION",
}
QUALITY = {"clear", *QUALITY_REASONS}


def write_tables(folder, stem, fields, rows):
    rows = [{field: row.get(field, "") for field in fields} for row in rows]
    (folder / f"{stem}.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with (folder / f"{stem}.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fields)
        writer.writeheader()
        writer.writerows(rows)
    return rows


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inside(root, relpath):
    relative = Path(relpath)
    if not relpath or relative.is_absolute() or relative.drive:
        raise ValueError(f"Use a relative path inside {root}: {relpath!r}")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"Path leaves {root}: {relpath}")
    return path


@contextmanager
def new_batch(destination):
    destination = destination.resolve()
    if destination.exists():
        raise FileExistsError(f"Choose a new output directory: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".claimshield-", dir=destination.parent) as temp:
        stage = Path(temp) / "batch"
        stage.mkdir()
        yield stage
        if destination.exists():
            raise FileExistsError(destination)
        stage.rename(destination)


def open_rgb(path):
    with Image.open(path) as source:
        if source.format not in {"JPEG", "PNG", "WEBP"} or getattr(source, "is_animated", False):
            raise ValueError(f"Use a still JPG, PNG or WebP: {path}")
        return ImageOps.exif_transpose(source).convert("RGB")


def image_record(root, asset_id, image, fields, jpeg_quality=93):
    filename = hashlib.sha256(asset_id.encode()).hexdigest()[:24] + ".jpg"
    path = root / "images" / filename
    path.parent.mkdir(exist_ok=True)
    # A fresh image container drops EXIF, GPS and other ancillary source metadata.
    with path.open("xb") as stream:
        image.save(stream, format="JPEG", quality=jpeg_quality, optimize=True)
    return {
        **fields, "asset_id": asset_id, "image_path": path.relative_to(root).as_posix(),
        "sha256": sha256(path), "width": image.width, "height": image.height,
    }


def copy_images(source, destination, assets):
    for asset in assets:
        path = asset["image_path"]
        source_file = inside(source, path)
        if sha256(source_file) != asset["sha256"]:
            raise ValueError(f"Source image hash mismatch: {path}")
        target = inside(destination, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source_file, target)
