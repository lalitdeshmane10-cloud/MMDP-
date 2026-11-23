"""Build recording-level splits and a compact frame review queue."""

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "datasets" / "vision_evaluation"
REVIEW_FIELDS = [
    "dataset", "frame_path", "recording_id", "player_id", "split", "timestamp_ms",
    "prompted_swara", "estimated_swara", "verified_swara", "usable",
    "hole_1", "hole_2", "hole_3", "hole_4", "hole_5", "hole_6", "review_notes",
]


def load(path):
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def write(path, fields, rows):
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    if OUTPUT.exists() and any(OUTPUT.iterdir()):
        raise SystemExit("Output directory is not empty; preserve existing reviews before rerunning.")
    own = load(ROOT / "datasets/vision_prepared/annotations.csv")
    reels = load(ROOT / "datasets/reels_data/annotations.csv")
    assignments = {}
    review = []
    for row in own:
        assignments[row["recording_id"]] = ("own_recordings", "own_player", "train")
        review.append({**row, "dataset": "vision_prepared", "player_id": "own_player", "split": "train"})

    last_selected = {}
    for row in reels:
        recording = row["recording_id"]
        assignment = ("reels", row["player_id"], row["split"])
        if row["split"] != "test":
            raise ValueError(f"Unexpected reel split for {recording}: {row['split']}")
        if recording in assignments and assignments[recording] != assignment:
            raise ValueError(f"Conflicting assignment for {recording}")
        assignments[recording] = assignment
        timestamp = float(row["timestamp_ms"])
        if timestamp - last_selected.get(recording, -3000) < 3000:
            continue
        last_selected[recording] = timestamp
        review.append({**row, "dataset": "reels_data"})

    player_splits = {}
    for _, player, split in assignments.values():
        player_splits.setdefault(player, set()).add(split)
    if any(len(splits) > 1 for splits in player_splits.values()):
        raise ValueError("A player appears in multiple splits")
    OUTPUT.mkdir(parents=True)
    split_rows = [
        {"recording_id": recording, "dataset": dataset, "player_id": player, "split": split}
        for recording, (dataset, player, split) in sorted(assignments.items())
    ]
    write(OUTPUT / "splits.csv", ["recording_id", "dataset", "player_id", "split"], split_rows)
    write(OUTPUT / "review.csv", REVIEW_FIELDS, [
        {key: row.get(key, "") for key in REVIEW_FIELDS} for row in review
    ])
    print(f"Saved {len(split_rows)} recording assignments and {len(review)} review frames to {OUTPUT}")


if __name__ == "__main__":
    main()
