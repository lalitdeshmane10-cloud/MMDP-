"""Create horizontally mirrored frame copies with links to their source annotations."""

import csv
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parent.parent / "datasets" / "vision_prepared"


def main():
    source_manifest = ROOT / "annotations.csv"
    destination = ROOT / "mirrored_horizontal"
    if destination.exists() and any(destination.iterdir()):
        raise SystemExit("mirrored_horizontal is not empty; preserve existing files before running again.")
    with source_manifest.open(encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file))
    destination.mkdir(parents=True, exist_ok=True)
    records = []
    for row in rows:
        source = ROOT / row["frame_path"]
        image = cv2.imread(str(source))
        if image is None:
            raise RuntimeError(f"Cannot read {source}")
        relative = Path(row["frame_path"])
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        mirrored = cv2.flip(image, 1)
        if not cv2.imwrite(str(target), mirrored, [cv2.IMWRITE_JPEG_QUALITY, 95]):
            raise RuntimeError(f"Cannot write {target}")
        records.append({
            "frame_path": target.relative_to(ROOT).as_posix(),
            "source_frame_path": row["frame_path"],
            "recording_id": row["recording_id"],
            "transform": "mirror_horizontal",
        })
    with (destination / "manifest.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["frame_path", "source_frame_path", "recording_id", "transform"])
        writer.writeheader()
        writer.writerows(records)
    print(f"Created {len(records)} mirrored frames in {destination}")


if __name__ == "__main__":
    main()
