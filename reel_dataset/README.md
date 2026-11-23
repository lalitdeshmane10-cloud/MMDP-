# Reel dataset downloader

Create a UTF-8 CSV with a `url` column containing one Instagram reel link per row. Additional columns, such as player, flute, or annotation notes, are preserved in the manifest. See `reels.example.csv`.

Install the downloader if needed and run from the project root:

```powershell
python -m pip install -U yt-dlp
python reel_dataset/download.py path/to/reels.csv
```

Videos are saved under `reel_dataset/downloads/` by default. Use `--output path/to/folder` to change that directory. Each downloaded file retains its audio and video, including visible text. `manifest.json` records the source URL, CSV fields, filename, and any download error. Re-running skips completed files and retries failures. The command returns a nonzero exit code when any row fails.

The downloader selects a single file containing audio and video, preferring a short edge at or below 480 pixels. If only larger versions are available, it can select a larger file. Existing downloads are skipped, so use a new output directory to download them again with this preference. Availability depends on Instagram and the source video. Private or inaccessible reels may fail. The downloader does not extract or verify on-screen Sargam, synchronize annotations, or create train/test splits. Review and annotate those separately before training.
