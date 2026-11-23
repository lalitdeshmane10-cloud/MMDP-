import argparse
import csv
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description="Download permitted Instagram reels from a CSV file.")
    parser.add_argument("csv_file", type=Path, help="CSV with a url column")
    parser.add_argument("--output", type=Path, default=ROOT / "downloads", help="Output directory")
    args = parser.parse_args()

    try:
        with args.csv_file.open(encoding="utf-8-sig", newline="") as source:
            reader = csv.DictReader(source)
            if not reader.fieldnames or "url" not in reader.fieldnames:
                parser.error("CSV must have a url column")
            rows = list(reader)
    except OSError as error:
        parser.error(str(error))

    args.output.mkdir(parents=True, exist_ok=True)
    manifest_path = args.output / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    except (OSError, json.JSONDecodeError) as error:
        parser.error(f"Cannot read manifest: {error}")

    failures = 0
    for row_number, row in enumerate(rows, start=2):
        url = (row.get("url") or "").strip()
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in {"instagram.com", "www.instagram.com"} or not parsed.path.startswith(("/reel/", "/reels/")):
            print(f"Row {row_number}: invalid Instagram reel URL", file=sys.stderr)
            failures += 1
            continue

        reel_id = parsed.path.strip("/").split("/")[1] if len(parsed.path.strip("/").split("/")) > 1 else ""
        if not reel_id or not all(c.isascii() and (c.isalnum() or c in "_-") for c in reel_id):
            print(f"Row {row_number}: invalid reel identifier", file=sys.stderr)
            failures += 1
            continue
        canonical_url = f"https://www.instagram.com/reel/{reel_id}/"
        key = hashlib.sha256(canonical_url.encode()).hexdigest()[:16]
        existing = manifest.get(key, {})
        if existing.get("status") == "downloaded" and (args.output / existing.get("file", "")).is_file():
            print(f"Row {row_number}: already downloaded {reel_id}")
            continue

        command = [
            sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-progress",
            "--format", "best[vcodec!=none][acodec!=none]",
            "--format-sort", "res:480",
            "--output", str(args.output.resolve() / f"{key}.%(ext)s"),
            "--print", "after_move:filepath", "--", canonical_url,
        ]
        print(f"Row {row_number}: downloading {reel_id}", flush=True)
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
        lines = result.stdout.strip().splitlines()
        downloaded = Path(lines[-1]) if lines else None
        entry = {"url": canonical_url, "source_row": row, "status": "failed"}
        if result.returncode == 0 and downloaded and downloaded.is_file():
            entry.update(status="downloaded", file=downloaded.name)
        else:
            failures += 1
            entry["error"] = result.stderr.strip() or "Downloader did not return a file."
            print(entry["error"], file=sys.stderr)
        manifest[key] = entry
        temporary = manifest_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(manifest_path)

    print(f"Finished with {failures} failed row(s). Manifest: {manifest_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
