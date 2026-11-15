"""Build the handoff dataset from the attached ZIP, Commons photos, and AI fixtures.

The resulting data directory is self-contained. Images from the attached ZIP are
copied with their original synthetic labels. Commons images are copied only with
their page URL, creator, and license in sources.csv. Generated fixtures are marked
as generated_synthetic and are never presented as real photos.
"""
import argparse
import csv
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

from PIL import Image

from cases import save_cases
from dataset import ASSET_FIELDS, CATALOG, image_record, open_rgb, write_tables


MODEL_IDS = tuple(CATALOG)
COMMONS = {
    "a26a": ("samsung-galaxy-a26-5g", "Samsung Galaxy A26 5G 2025 (1).jpg", "Samsung Galaxy A26 5G 2025 (1).jpg", "Captainmorlypogi1959", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a26b": ("samsung-galaxy-a26-5g", "Samsung Galaxy A26 5G 2025.jpg", "Samsung Galaxy A26 5G 2025.jpg", "Captainmorlypogi1959", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a26d": ("samsung-galaxy-a26-5g", "Galaxy A26 5G (Back).jpg", "Galaxy A26 5G (Back).jpg", "เวียร์", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a36a": ("samsung-galaxy-a36-5g", "Samsung Galaxy A36 5G 2025.jpg", "Samsung Galaxy A36 5G 2025.jpg", "Captainmorlypogi1959", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a36b": ("samsung-galaxy-a36-5g", "Samsung Galaxy A36 5G 2025 (1).jpg", "Samsung Galaxy A36 5G 2025 (1).jpg", "Captainmorlypogi1959", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a56a": ("samsung-galaxy-a56-5g", "Samsung Galaxy A56 5G 2025.jpg", "Samsung Galaxy A56 5G 2025.jpg", "Captainmorlypogi1959", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a56b": ("samsung-galaxy-a56-5g", "Samsung Galaxy A56 5G 2025 (2).jpg", "Samsung Galaxy A56 5G 2025 (2).jpg", "Captainmorlypogi1959", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a56c": ("samsung-galaxy-a56-5g", "SmsnGlxA565gBack2026040500.jpg", "SmsnGlxA565gBack2026040500.jpg", "OnionBulb", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a56d": ("samsung-galaxy-a56-5g", "SmsnGlxA565gFront2026040500.jpg", "SmsnGlxA565gFront2026040500.jpg", "OnionBulb", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a25": ("unsupported", "Samsung Galaxy A25 5G 2024.jpg", "Samsung Galaxy A25 5G 2024.jpg", "Captainmorlypogi1959", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "a37": ("unsupported", "Samsung Galaxy A37 5G.jpg", "Samsung Galaxy A37 5G.jpg", "เวียร์", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    "crack1": ("unsupported", "MyPhone my27 front panel.jpg", "MyPhone my27 front panel.jpg", "JGBlue1509", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    "crack2": ("unsupported", "Cracked iPhone.jpg", "Cracked iPhone.jpg", "Ed6767", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "tablet": ("unsupported", "Broken Samsung Tablet - Cracked Screen.jpg", "Broken Samsung Tablet - Cracked Screen.jpg", "Wiki.cullin", "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
    "sony": ("unsupported", "2023 Słuchawki Sony WI-XB400 (3).jpg", "2023 Słuchawki Sony WI-XB400 (3).jpg", "Jacek Halicki", "CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    "mug": ("unsupported", "Coffee in a mug.jpg", "Coffee in a mug.jpg", "Kurt Kaiser", "CC0", "https://creativecommons.org/publicdomain/zero/1.0/"),
}


def hash_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def copy_bytes(root, raw, rel):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    return path


def attached_assets(stage, source_zip):
    assets = []
    sources = []
    with zipfile.ZipFile(source_zip) as archive:
        for model in MODEL_IDS:
            for scenario in ("match", "alias", "wrong", "discrepancy", "ambiguous"):
                name = f"data/images/labels/{model}/{scenario}.jpg"
                raw = archive.read(name)
                aid = f"synthetic-label-{model}-{scenario}"
                rel = f"images/attached/{model}/{scenario}.jpg"
                copy_bytes(stage, raw, rel)
                assets.append({
                    "asset_id": aid, "image_path": rel, "sha256": hash_bytes(raw),
                    "width": Image.open(stage / rel).width, "height": Image.open(stage / rel).height,
                    "origin": "generated_synthetic", "model_id": model,
                    "prompted_model_id": model, "subject": CATALOG[model]["name"],
                    "identity_basis": "label_only", "visible_model_evidence": "absent",
                    "angle": "flat_label", "condition": scenario, "quality": "clear",
                    "device_group_id": f"synthetic-label-{model}", "split": "test",
                    "parent_asset_id": "", "source_page": "", "source_image_url": "",
                    "source_title": "Attached ClaimShield sample label", "creator": "ClaimShield generator",
                    "usage_rights": "Project-generated test fixture",
                    "license_url": "", "changes": "Copied without modification",
                    "notes": "Image contains a visible SYNTHETIC SAMPLE LABEL disclaimer and is not a product photograph.",
                })
        for rel in ("data/images/unrelated/unrelated-1.jpg", "data/images/unrelated/unrelated-2.jpg", "data/images/unrelated/unrelated-3.jpg"):
            raw = archive.read(rel)
            name = Path(rel).name
            target = f"images/attached/unsupported/{name}"
            copy_bytes(stage, raw, target)
            assets.append({
                "asset_id": f"synthetic-unsupported-{Path(name).stem}", "image_path": target,
                "sha256": hash_bytes(raw), "width": Image.open(stage / target).width,
                "height": Image.open(stage / target).height, "origin": "generated_synthetic",
                "model_id": "unsupported", "prompted_model_id": "", "subject": "Unsupported/random subject",
                "identity_basis": "outside_catalog", "visible_model_evidence": "outside_catalog",
                "angle": "varied", "condition": "unrelated", "quality": "clear",
                "device_group_id": f"synthetic-unsupported-{Path(name).stem}", "split": "test",
                "parent_asset_id": "", "source_page": "", "source_image_url": "",
                "source_title": "Attached ClaimShield unsupported fixture", "creator": "ClaimShield generator",
                "usage_rights": "Project-generated test fixture", "license_url": "",
                "changes": "Copied without modification",
                "notes": "Unsupported subject for INVALID_DEVICE testing.",
            })
        for model in MODEL_IDS:
            name = f"data/images/boxes/{model}/box-only.jpg"
            raw = archive.read(name)
            target = f"images/attached/{model}/box-only.jpg"
            copy_bytes(stage, raw, target)
            assets.append({
                "asset_id": f"synthetic-box-{model}", "image_path": target, "sha256": hash_bytes(raw),
                "width": Image.open(stage / target).width, "height": Image.open(stage / target).height,
                "origin": "generated_synthetic", "model_id": model, "prompted_model_id": model,
                "subject": CATALOG[model]["name"], "identity_basis": "packaging_only",
                "visible_model_evidence": "absent", "angle": "front", "condition": "box_only",
                "quality": "clear", "device_group_id": f"synthetic-box-{model}", "split": "test",
                "parent_asset_id": "", "source_page": "", "source_image_url": "",
                "source_title": "Attached ClaimShield package-only fixture", "creator": "ClaimShield generator",
                "usage_rights": "Project-generated test fixture", "license_url": "",
                "changes": "Copied without modification",
                "notes": "Packaging cannot identify the pictured device.",
            })
    return assets, sources


def commons_assets(stage, commons_dir):
    assets, sources = [], []
    for key, info in COMMONS.items():
        model, title, source_title, creator, rights, license_url = info
        src = commons_dir / f"{key}.jpg"
        if not src.exists():
            continue
        raw = src.read_bytes()
        rel = f"images/commons/{key}.jpg"
        copy_bytes(stage, raw, rel)
        page = f"https://commons.wikimedia.org/wiki/File:{title.replace(' ', '_')}"
        assets.append({
            "asset_id": f"commons-{key}", "image_path": rel, "sha256": hash_bytes(raw),
            "width": Image.open(stage / rel).width, "height": Image.open(stage / rel).height,
            "origin": "real_open_license", "model_id": model, "prompted_model_id": "",
            "subject": CATALOG[model]["name"] if model in CATALOG else "Unsupported comparison subject",
            "identity_basis": "visual_reference", "visible_model_evidence": "absent",
            "angle": "varied", "condition": "normal" if model in MODEL_IDS else "varied",
            "quality": "clear", "device_group_id": f"commons-{key}", "split": "test",
            "parent_asset_id": "", "source_page": page,
            "source_image_url": (commons_dir / f"{key}.url").read_text(encoding="utf-8").strip()
            if (commons_dir / f"{key}.url").exists() else "",
            "source_title": source_title, "creator": creator, "usage_rights": rights,
            "license_url": license_url, "changes": "Copied from source file without pixel edits",
            "notes": "Visual reference only. Exact model identity still requires linked model evidence.",
        })
        sources.append({"asset_id": f"commons-{key}", "source_page": page, "source_image_url": assets[-1]["source_image_url"], "title": source_title, "creator": creator, "license": rights, "license_url": license_url})
    return assets, sources


def generated_assets(stage, generated_dir):
    assets = []
    names = [
        ["samsung-galaxy-a26-5g", "samsung-galaxy-a36-5g", "samsung-galaxy-a56-5g",
         "boat-rockerz-450", "boat-rockerz-550", "boat-rockerz-650"],
        ["samsung-galaxy-a26-5g", "samsung-galaxy-a36-5g", "samsung-galaxy-a56-5g",
         "boat-rockerz-450", "boat-rockerz-550", "boat-rockerz-650"],
    ]
    for sheet_index, filename in enumerate(("exec-a106d62d-54c0-42db-8803-10bf92006c23.png", "exec-ead0a396-32c2-4c4e-a6bf-6cc67ed6bc64.png"), 1):
        src = generated_dir / filename
        if not src.exists():
            continue
        with Image.open(src) as sheet:
            tile_width, tile_height = sheet.width // 3, sheet.height // 2
            for index, model in enumerate(names[sheet_index - 1]):
                col, row = index % 3, index // 3
                tile = sheet.crop((col * tile_width, row * tile_height, (col + 1) * tile_width, (row + 1) * tile_height)).convert("RGB")
                aid = f"ai-generated-sheet{sheet_index}-{index + 1}"
                rel = f"images/ai_generated/{aid}.jpg"
                tile_path = stage / rel
                tile_path.parent.mkdir(parents=True, exist_ok=True)
                tile.save(tile_path, quality=92)
                assets.append({
                    "asset_id": aid, "image_path": rel, "sha256": hash_bytes(tile_path.read_bytes()),
                    "width": tile.width, "height": tile.height, "origin": "ai_generated",
                    "model_id": model, "prompted_model_id": model, "subject": CATALOG[model]["name"],
                    "identity_basis": "visual_reference", "visible_model_evidence": "absent",
                    "angle": "varied", "condition": "damaged", "quality": "clear",
                    "device_group_id": aid, "split": "test", "parent_asset_id": "",
                    "source_page": "", "source_image_url": "", "source_title": "Generated AI fixture",
                    "creator": "OpenAI ImageGen", "usage_rights": "Project-generated test fixture",
                    "license_url": "", "changes": "Contact sheet cropped into a single-tile JPEG",
                    "notes": "AI-generated fixture. Never represent this as a real photograph or proof of damage.",
                })
    return assets


def build(source_zip, commons_dir, generated_dir, out):
    if out.exists():
        raise FileExistsError(f"Output already exists: {out}")
    out.mkdir(parents=True)
    (out / "data").mkdir()
    shutil.copy2(source_zip, out / "legacy-claimshield-image-dataset.zip")
    stage = out / "data"
    assets, sources = attached_assets(stage, source_zip)
    commons, commons_sources = commons_assets(stage, commons_dir)
    assets.extend(commons)
    sources.extend(commons_sources)
    assets.extend(generated_assets(stage, generated_dir))
    assets = write_tables(stage, "assets", ASSET_FIELDS, assets)
    write_tables(stage, "sources", ("asset_id", "source_page", "source_image_url", "title", "creator", "license", "license_url"), sources)
    save_cases(stage, assets, include_policy=True)
    return len(assets)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-zip", type=Path, required=True)
    parser.add_argument("--commons-dir", type=Path, required=True)
    parser.add_argument("--generated-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    print(f"Built {build(args.source_zip, args.commons_dir, args.generated_dir, args.out)} assets.")
