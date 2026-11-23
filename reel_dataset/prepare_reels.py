import csv
import json
import math
import re
import subprocess
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "reel_dataset" / "downloads"
OUTPUT = ROOT / "datasets" / "reels_test"
# Examples are video timestamps in seconds. Repeated overlays can share a template.
CLIPS = [
    ("sairat", "1.08.30", "parth_flute", (18, 195, 445, 251), [
        (2, "ga dha dha dha dha dha", "dha 2 and 3 underlined"),
        (4, "dha ni dha dha dha", "dha 4 and 5 underlined"),
        (12, "ga dha dha dha dha ni ni", "dha 2 and 3 underlined"),
        (14, "ni re sa ni ni", ""),
        (16, "ga ga ga sa sa", ""),
        (20, "sa re ga re sa re ga re sa ni...", ""),
        (26, "sa re ga re sa re ga re sa ni dha.", ""),
        (42, "ni re sa ni ni dha.....", ""),
    ]),
    ("krishna_theme", "1.20.23", "harshvdave", (85, 150, 389, 190), [
        (0, "PNSNSN PNSNSN PNSN", ""),
        (9, "NRGRGR NRGRGR NRGR", "N has a lower dot"),
        (12, "PNṠ PNṠ NṠ", ""),
        (17, "NṘĠ NṘĠ ṘĠ", ""),
        (22, "ṖṀ'Ṙ ṀĠṘ ṠNṠ.......", ""),
        (26, "NN Ṡ–NṘ ṠN Ṡ N P M'M'", ""),
        (33, "M'DP P M'R–M'-G-", ""),
        (37, "NN Ṡ —Ṡ ṘṠN", ""),
        (40, "Ṡ - N P M'M", ""),
        (43, "M'D -PP M'R M'-G", ""),
        (45, "P M'R GRS", ""),
    ]),
    ("mera_naam_tu", "1.20.34", "shivam_thefluteguy", (60, 625, 420, 654), [
        (2, "Ga Re Ga Re Ga Pa Ni", ""),
        (4, "SaNiSaNi.. Pa Ga", ""),
        (8, "Ga Re Ga Re Ga Pa Dha Pa Ma(T)", ""),
        (17, "Ga Re Sa Re Ga Re Sa Ni Dha", ""),
    ]),
    ("omg_tune", "1.20.35", "shivam_thefluteguy", (64, 582, 420, 656), [
        (2, "Sa Re Pa Pa Dha Ma Ga Re", ""),
        (5, "Ga Re Ga Ma Ga Ga", ""),
        (8, "Sa Re Pa Dha Sa’ Ni(K) / Dha Pa Ma Ga Re", ""),
        (13, "Sa Ni Re Re Ma Ga Re Sa Ni", ""),
        (17, "Re Sa Sa Ni Dha Ni Dha Pa", ""),
        (20, "Sa Ni Re Re Pa Ma Ga / Re Sa Ni Re Sa Sa", ""),
    ]),
]
WESTERN = "C C# D D# E F F# G G# A A# B".split()
SWARAS = "Sa|komal Re|Re|komal Ga|Ga|Ma|tivra Ma|Pa|komal Dha|Dha|komal Ni|Ni".split("|")


def infer_tonic(clip, frames):
    """Rank possible Sa pitch classes using the audio and visible phrase vocabulary."""
    by_phrase = {}
    for frame in frames:
        if frame["overlay_phrase"] and frame.get("midi_note") not in ("", None):
            by_phrase.setdefault(frame["overlay_phrase"], []).append(int(frame["midi_note"]))
    scores = np.zeros(12)
    short = dict(zip("SRGMPDN", (0, 2, 4, 5, 7, 9, 11)))
    long = dict(zip(("sa", "re", "ga", "ma", "pa", "dha", "ni", "ma(t)", "ni(k)"),
                    (0, 2, 4, 5, 7, 9, 11, 6, 10)))
    for phrase, notes in by_phrase.items():
        if clip == "krishna_theme":
            text = phrase.translate(str.maketrans("ṠṘĠṀṖ", "SRGMP"))
            expected = {6 if token == "M'" else short[token]
                        for token in re.findall("M'|[SRGMPDN]", text)}
        else:
            expected = {long[token] for token in re.findall(
                r"sa|re|ga|ma\(t\)|ma|pa|dha|ni\(k\)|ni", phrase.lower())}
        for tonic in range(12):
            scores[tonic] += np.isin((np.asarray(notes) - tonic) % 12, list(expected)).mean()
    if not by_phrase:
        return None, None
    ranked = np.argsort(scores)[::-1]
    tonic = int(ranked[0])
    return tonic, {
        "pitch_class": WESTERN[tonic],
        "mean_phrase_agreement": round(float(scores[tonic] / len(by_phrase)), 3),
        "runner_up_agreement": round(float(scores[ranked[1]] / len(by_phrase)), 3),
    }


def label_pitch_classes(rows, tonic):
    for row in rows:
        midi = row.get("midi_note")
        row["estimated_swara"] = SWARAS[(int(midi) - tonic) % 12] if midi not in ("", None) else ""
        row["inferred_sa_pitch_class"] = WESTERN[tonic]


def mask(frame, crop):
    x1, y1, x2, y2 = crop
    b, g, r = cv2.split(frame[y1:y2, x1:x2])
    # Keep white and yellow lettering, including the Krishna phrase highlights.
    return cv2.dilate((np.minimum(g, r) >= 155).astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)


def templates(video, crop, entries):
    capture = cv2.VideoCapture(str(video))
    bank = []
    try:
        for second, phrase, notation in entries:
            capture.set(cv2.CAP_PROP_POS_MSEC, second * 1000)
            ok, frame = capture.read()
            if not ok:
                raise RuntimeError(f"Cannot read caption example at {second}s in {video}")
            bank.append((mask(frame, crop), phrase, notation))
    finally:
        capture.release()
    return bank


def caption(frame, crop, bank):
    observed = mask(frame, crop)
    scores = [2 * np.count_nonzero(observed & ref) / max(1, observed.sum() + ref.sum())
              for ref, _, _ in bank]
    best = int(np.argmax(scores))
    score = scores[best]
    if score < 0.64 or score - sorted(scores)[-2] < 0.045:
        return "", "", round(score, 3)
    return bank[best][1], bank[best][2], round(score, 3)


def pitch_fields(pitch, sa):
    if "hz" not in pitch:
        return {"audio_rms": round(pitch["rms"], 5), "audio_status": "no_reliable_pitch"}
    hz = pitch["hz"]
    position = 69 + 12 * math.log2(hz / 440)
    midi = round(position)
    fields = {
        "pitch_hz": round(hz, 3), "pitch_confidence": round(pitch["confidence"], 3),
        "audio_rms": round(pitch["rms"], 5), "midi_note": midi,
        "western_note": f"{WESTERN[midi % 12]}{midi // 12 - 1}",
        "western_cents": round(100 * (position - midi), 1), "audio_status": "pitch_candidate",
    }
    if sa:
        step = round(12 * math.log2(hz / sa))
        fields.update(estimated_swara=SWARAS[step % 12], swara_octave=step // 12, assumed_sa_hz=sa)
    return fields


def write_csv(path, rows):
    fields = list(dict.fromkeys(field for row in rows for field in row))
    with path.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Prepare the four uploaded reels as a test dataset.")
    parser.add_argument("--ffmpeg", required=True)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--sa", nargs=4, type=float, default=[0] * 4, metavar="HZ")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        parser.error("Use an empty output directory to protect existing annotations.")
    all_frames = []
    clips = []
    for (clip, suffix, player, crop, entries), sa in zip(CLIPS, args.sa):
        video, = SOURCE.glob(f"*{suffix} PM.mp4")
        audio_path = output / "audio" / f"{clip}.wav"
        audio_path.parent.mkdir(exist_ok=True)
        subprocess.run([args.ffmpeg, "-v", "error", "-i", str(video), "-map", "0:a:0",
                        "-af", "aresample=16000:first_pts=0", "-ac", "1", "-c:a", "pcm_s16le",
                        str(audio_path)], check=True)
        pitches = json.loads(subprocess.check_output(
            ["node", str(ROOT / "reel_dataset" / "track_audio.mjs"), str(audio_path)]))
        pitch_rows = [{"timestamp_ms": i * 10, **pitch_fields(pitch, sa)}
                      for i, pitch in enumerate(pitches)]
        bank = templates(video, crop, entries)
        capture = cv2.VideoCapture(str(video))
        directory = output / "frames" / clip
        directory.mkdir(parents=True)
        count = 0
        phrases = Counter()
        pitch_count = 0
        try:
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                time = capture.get(cv2.CAP_PROP_POS_MSEC)
                if count and time <= previous:
                    raise RuntimeError(f"Non-increasing timestamps in {video}")
                previous = time
                path = directory / f"frame_{count:05d}.jpg"
                if not cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, 92]):
                    raise RuntimeError(f"Cannot write {path}")
                phrase, notation, score = caption(frame, crop, bank)
                phrases[phrase] += 1
                idx = round(time / 10)
                audio = {**pitch_rows[idx]} if idx < len(pitch_rows) else {"audio_status": "outside_audio"}
                audio_time = audio.pop("timestamp_ms", "")
                pitch_count += audio["audio_status"] == "pitch_candidate"
                all_frames.append({
                    "frame_path": path.relative_to(output).as_posix(), "recording_id": clip,
                    "video_path": video.relative_to(ROOT).as_posix(), "timestamp_ms": round(time, 3),
                    "audio_timestamp_ms": audio_time, "player_id": player, "split": "test",
                    "overlay_phrase": phrase, "overlay_notation_notes": notation,
                    "overlay_match_score": score, **audio,
                    "verified_swara": "", "usable": "", "review_notes": "",
                    **{f"hole_{i}": "" for i in range(1, 7)},
                })
                count += 1
        finally:
            capture.release()
        if not count:
            raise RuntimeError(f"No frames decoded from {video}")
        inferred_sa = None
        if not sa:
            clip_frames = all_frames[-count:]
            tonic, inferred_sa = infer_tonic(clip, clip_frames)
            if tonic is not None:
                label_pitch_classes(clip_frames, tonic)
                label_pitch_classes(pitch_rows, tonic)
        write_csv(audio_path.with_suffix(".csv"), pitch_rows)
        clips.append({
            "recording_id": clip, "player_id": player, "source_video": video.relative_to(ROOT).as_posix(),
            "wav": audio_path.relative_to(output).as_posix(),
            "pitch_track": audio_path.with_suffix(".csv").relative_to(output).as_posix(),
            "frame_count": count, "pitch_candidate_frames": pitch_count,
            "overlay_matched_frames": count - phrases[""],
            "caption_crop_xyxy": list(crop), "assumed_sa_hz": sa or None,
            "inferred_sa": inferred_sa,
        })
        print(clips[-1], flush=True)
    write_csv(output / "annotations.csv", all_frames)
    (output / "manifest.json").write_text(json.dumps(clips, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
