"""Generate judge-ready charts from measured predictions.

Input CSV must have model_name, expected_status, predicted_status and
selected_model_id. A model row is never fabricated. Missing predictions are
reported as missing and are excluded from accuracy until the run is complete.
"""
import argparse
import csv
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def read_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    required = {"model_name", "expected_status", "predicted_status", "selected_model_id"}
    if not rows or not required.issubset(rows[0]):
        raise ValueError(f"CSV must contain {sorted(required)}")
    return rows


def metrics(rows):
    output = []
    by_model = defaultdict(list)
    for row in rows:
        by_model[row["model_name"]].append(row)
    for model, values in sorted(by_model.items()):
        valid = [row for row in values if row["predicted_status"]]
        correct = [row for row in valid if row["predicted_status"] == row["expected_status"]]
        output.append({
            "model_name": model, "cases": len(values), "predictions": len(valid),
            "coverage": len(valid) / len(values) if values else 0,
            "accuracy": len(correct) / len(valid) if valid else None,
        })
    return output


def build_graphs(rows, out):
    out.mkdir(parents=True, exist_ok=True)
    summary = metrics(rows)
    labels = [row["model_name"] for row in summary]
    accuracy = [row["accuracy"] * 100 if row["accuracy"] is not None else 0 for row in summary]
    coverage = [row["coverage"] * 100 for row in summary]
    width, height = 1400, 700
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    draw.text((40, 24), "Measured model accuracy and coverage", fill="#111827")
    for pane, values, title, color in (
        ((60, 90, 660, 640), accuracy, "Accuracy (%)", "#2563eb"),
        ((740, 90, 1340, 640), coverage, "Coverage (%)", "#0f766e"),
    ):
        left, top, right, bottom = pane
        draw.text((left, top), title, fill="#111827")
        draw.line((left, bottom, right, bottom), fill="#374151", width=2)
        draw.line((left, top + 30, left, bottom), fill="#374151", width=2)
        for tick in (0, 25, 50, 75, 100):
            y = bottom - (bottom - top - 50) * tick / 100
            draw.line((left, y, right, y), fill="#e5e7eb", width=1)
            draw.text((left - 35, y - 8), str(tick), fill="#4b5563")
        gap = (right - left) / max(1, len(values))
        for index, value in enumerate(values):
            x0 = left + 15 + index * gap
            x1 = left + gap - 15 + index * gap
            y = bottom - (bottom - top - 50) * value / 100
            draw.rectangle((x0, y, x1, bottom), fill=color)
            label = labels[index][:20]
            draw.text((x0, bottom + 8), label, fill="#111827")
            draw.text((x0, y - 20), f"{value:.1f}", fill="#111827")
    image.save(out / "model_accuracy_and_coverage.png")

    classes = sorted({row["expected_status"] for row in rows})
    matrix = {expected: Counter() for expected in classes}
    for row in rows:
        matrix[row["expected_status"]][row["predicted_status"] or "MISSING"] += 1
    predicted = sorted({item for counts in matrix.values() for item in counts})
    values = [[matrix[expected][actual] for actual in predicted] for expected in classes]
    cell = 120
    matrix_image = Image.new("RGB", (320 + cell * len(predicted), 160 + cell * len(classes)), "white")
    draw = ImageDraw.Draw(matrix_image)
    draw.text((20, 20), "Measured confusion matrix", fill="#111827")
    for x, label in enumerate(predicted):
        draw.text((300 + x * cell, 80), label[:16], fill="#111827")
    for y, label in enumerate(classes):
        draw.text((20, 160 + y * cell + 45), label[:20], fill="#111827")
        for x, value in enumerate(values[y]):
            shade = max(0, 245 - min(190, value * 35))
            box = (280 + x * cell, 140 + y * cell, 280 + (x + 1) * cell, 140 + (y + 1) * cell)
            draw.rectangle(box, fill=(shade, shade + 8, 255), outline="#9ca3af")
            draw.text((box[0] + 48, box[1] + 48), str(value), fill="#111827")
    matrix_image.save(out / "confusion_matrix.png")
    return summary


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        summary = build_graphs(read_rows(args.results), args.out)
        print(summary)
    except (OSError, ValueError) as exc:
        parser.exit(1, f"{exc}\n")
