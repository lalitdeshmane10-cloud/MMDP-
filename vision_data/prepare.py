"""Prepare timestamped, reviewable frames from recorded swara takes."""

import argparse
import csv
import json
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parent.parent
FIELDS = [
    "frame_path", "recording_id", "video_path", "label_path", "timestamp_ms",
    "prompted_swara", "verified_swara", "usable", "review_notes",
    "hole_1", "hole_2", "hole_3", "hole_4", "hole_5", "hole_6",
    "player_id", "flute_sa", "split",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--videos", type=Path, default=ROOT / "datasets" / "recording")
    parser.add_argument("--labels", type=Path, default=ROOT / "datasets" / "recording_labels")
    parser.add_argument("--output", type=Path, default=ROOT / "datasets" / "vision_prepared")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between sampled frames")
    args = parser.parse_args()
    if args.interval <= 0:
        parser.error("--interval must be positive")
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("Output directory is not empty. Choose a new --output directory to preserve any annotations.")

    labels = sorted(args.labels.glob("*.json"))
    if not labels:
        parser.error("No label files found")
    pairs = []
    for label_path in labels:
        data = json.loads(label_path.read_text(encoding="utf-8-sig"))
        # The saved video and JSON can both acquire a browser-generated (1) suffix.
        video_path = args.videos / (label_path.stem + ".webm")
        if not video_path.is_file():
            parser.error(f"No matching video for {label_path.name}: {video_path}")
        if not data.get("id") or not data.get("swara"):
            parser.error(f"Missing id or swara in {label_path}")
        pairs.append((label_path, video_path, data))
    if len({data["id"] for _, _, data in pairs}) != len(pairs):
        parser.error("Duplicate recording IDs in labels")

    args.output.mkdir(parents=True, exist_ok=True)
    rows = []
    for label_path, video_path, data in pairs:
        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise RuntimeError(f"Could not open {video_path}")
        frame_dir = args.output / "frames" / data["id"]
        frame_dir.mkdir(parents=True)
        next_time_ms = 0.0
        last_timestamp = -1.0
        count = 0
        try:
            while True:
                success, frame = capture.read()
                if not success:
                    break
                timestamp = capture.get(cv2.CAP_PROP_POS_MSEC)
                if timestamp < last_timestamp:
                    raise RuntimeError(f"Non-monotonic timestamps in {video_path}")
                last_timestamp = timestamp
                if timestamp < next_time_ms:
                    continue
                frame_path = frame_dir / f"frame_{count:05d}.jpg"
                if not cv2.imwrite(str(frame_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 95]):
                    raise RuntimeError(f"Could not write {frame_path}")
                rows.append({
                    "frame_path": frame_path.relative_to(args.output).as_posix(),
                    "recording_id": data["id"],
                    "video_path": str(video_path.resolve()),
                    "label_path": str(label_path.resolve()),
                    "timestamp_ms": round(timestamp, 3),
                    "prompted_swara": data["swara"],
                    "player_id": data.get("player_id", ""),
                    "flute_sa": data.get("flute_sa", ""),
                })
                count += 1
                next_time_ms = count * args.interval * 1000
        finally:
            capture.release()
        if count == 0:
            raise RuntimeError(f"No frames decoded from {video_path}")
        print(f"{data['swara']}: {count} frames from {video_path.name}")

    with (args.output / "annotations.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Prepared {len(rows)} frames in {args.output}")


if __name__ == "__main__":
    main()
