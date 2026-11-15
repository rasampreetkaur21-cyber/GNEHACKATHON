"""Create labelled quality variants in a separate dataset directory."""
import argparse
from pathlib import Path

from PIL import ImageEnhance, ImageFilter

from cases import save_cases
from dataset import (
    ASSET_FIELDS, copy_images, image_record, inside, new_batch, open_rgb,
    read_json, write_tables,
)


def quality_variants(image):
    width, height = image.size
    small = image.copy()
    small.thumbnail((64, 64))
    return {
        "blurry": image.filter(ImageFilter.GaussianBlur(max(12, min(width, height) * 0.045))),
        "dark": ImageEnhance.Brightness(image).enhance(0.065),
        "cropped": image.crop((0, 0, max(1, width // 5), max(1, height // 5))),
        "low_resolution": small,
    }


def augment(source, destination, split):
    originals = read_json(source / "assets.json")
    eligible = [
        asset for asset in originals
        if asset["origin"] == "camera_photo" and asset["quality"] == "clear"
        and asset["split"] == split and not asset["parent_asset_id"]
    ]
    if not eligible:
        raise ValueError(f"No clear camera originals in split {split!r}.")
    assets = list(originals)
    seen = {asset["asset_id"] for asset in assets}
    seen_hashes = {asset["sha256"] for asset in assets}
    with new_batch(destination) as folder:
        copy_images(source, folder, originals)
        for parent in eligible:
            image = open_rgb(inside(source, parent["image_path"]))
            for quality, variant in quality_variants(image).items():
                asset_id = f"{parent['asset_id']}-aug-{quality}"
                if asset_id in seen:
                    continue
                asset = image_record(folder, asset_id, variant, {
                    **parent, "origin": "quality_augmentation", "quality": quality,
                    "parent_asset_id": parent["asset_id"], "visible_model_evidence": "absent",
                    "changes": f"{parent['changes']}; added {quality} quality stress test",
                    "notes": "Parent carries subject truth. Quality label is a transformation target.",
                })
                if asset["sha256"] in seen_hashes:
                    (folder / asset["image_path"]).unlink()
                    continue
                seen.add(asset_id)
                seen_hashes.add(asset["sha256"])
                assets.append(asset)
        assets = write_tables(folder, "assets", ASSET_FIELDS, assets)
        save_cases(folder, assets, include_policy=(source / "cases.json").exists() and any(
            row["evaluation_mode"] == "policy_fixture" for row in read_json(source / "cases.json")
        ))
    return len(assets) - len(originals)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--split", default="train", choices=["train", "demo"])
    args = parser.parse_args()
    try:
        print(f"Created {augment(args.dataset, args.out, args.split)} quality variants.")
    except (OSError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
