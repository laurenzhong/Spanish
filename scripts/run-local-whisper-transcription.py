"""One-time local Whisper transcription for the approved calibration manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SUPPORTED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".webm", ".ogg"}
SAMPLE_ID_PATTERN = re.compile(r"^audio\.[a-f0-9]{16}$")
MAX_SAMPLES = 20


class CalibrationInputError(Exception):
    pass


def main() -> int:
    args = parse_args()
    try:
        manifest = read_json(args.manifest)
        authorization = read_json(args.authorization)
        validate_gate(manifest, authorization)
        files = scan_audio_root(Path(args.audio_root))
        by_hash = {item["sha256"]: item for item in files}
        for entry in manifest["entries"]:
            if entry["sha256"] not in by_hash:
                raise CalibrationInputError("A manifest audio hash was not found in the audio root.")

        existing = read_existing_snapshot(Path(args.output))
        run_id = existing.get("runId") if existing else make_run_id()
        samples: dict[str, dict[str, Any]] = {
            item["sampleId"]: item
            for item in (existing or {}).get("samples", [])
        }

        try:
            from faster_whisper import WhisperModel
        except ImportError as error:
            raise CalibrationInputError(
                "faster-whisper is not installed in the selected Python environment."
            ) from error

        model = WhisperModel(
            args.model,
            device="cpu",
            compute_type="int8",
            cpu_threads=max(1, os.cpu_count() or 1),
        )

        for entry in manifest["entries"]:
            sample_id = entry["sampleId"]
            previous = samples.get(sample_id)
            if previous and previous.get("status") == "completed":
                continue
            if previous and previous.get("status") == "failed" and not args.retry_failed:
                continue

            file_info = by_hash[entry["sha256"]]
            started = time.perf_counter()
            try:
                segments, _info = model.transcribe(
                    str(file_info["path"]),
                    language="es",
                    beam_size=5,
                    vad_filter=True,
                    condition_on_previous_text=False,
                )
                transcript = " ".join(
                    segment.text.strip() for segment in segments if segment.text.strip()
                ).strip()
                if not transcript:
                    raise RuntimeError("empty-transcript")
                samples[sample_id] = {
                    "sampleId": sample_id,
                    "status": "completed",
                    "transcript": transcript,
                    "modelVersion": f"faster-whisper-{args.model}",
                    "language": "es-ES",
                    "latencyMs": max(0, round((time.perf_counter() - started) * 1000)),
                }
            except Exception:
                samples[sample_id] = {
                    "sampleId": sample_id,
                    "status": "failed",
                    "errorCode": "provider-unavailable",
                }
            write_snapshot(Path(args.output), run_id, args.model, manifest, samples)

        status = (
            "completed"
            if all(samples.get(entry["sampleId"], {}).get("status") == "completed" for entry in manifest["entries"])
            else "partial-failure"
        )
        write_snapshot(Path(args.output), run_id, args.model, manifest, samples, status)
        completed = sum(1 for item in samples.values() if item.get("status") == "completed")
        failed = sum(1 for item in samples.values() if item.get("status") == "failed")
        print(json.dumps({"status": status, "runId": run_id, "completed": completed, "failed": failed}))
        return 0 if status == "completed" else 1
    except CalibrationInputError as error:
        print(str(error), file=os.sys.stderr)
        return 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--authorization", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--retry-failed", action="store_true")
    return parser.parse_args()


def read_json(file_path: str) -> Any:
    try:
        return json.loads(Path(file_path).read_text(encoding="utf-8"))
    except Exception as error:
        raise CalibrationInputError("A calibration input JSON file is unreadable.") from error


def validate_gate(manifest: Any, authorization: Any) -> None:
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != "1.0" or manifest.get("dryRun") is not True:
        raise CalibrationInputError("Calibration manifest is invalid.")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or not entries or len(entries) > MAX_SAMPLES:
        raise CalibrationInputError("Calibration manifest sample count is invalid.")
    if not isinstance(authorization, dict) or authorization.get("schemaVersion") != "1.0":
        raise CalibrationInputError("Calibration authorization is invalid.")
    if authorization.get("sourceLicense", {}).get("status") != "confirmed":
        raise CalibrationInputError("Source license is not confirmed.")
    if authorization.get("thirdPartyProcessing", {}).get("status") != "confirmed":
        raise CalibrationInputError("Third-party processing is not confirmed.")
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict) or not SAMPLE_ID_PATTERN.match(str(entry.get("sampleId", ""))):
            raise CalibrationInputError("Calibration manifest sample ID is invalid.")
        if entry.get("authorizationStatus") != "confirmed":
            raise CalibrationInputError("A calibration sample is not authorized.")
        digest = entry.get("sha256")
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest) or digest in seen:
            raise CalibrationInputError("Calibration manifest audio hashes are invalid.")
        if not isinstance(entry.get("sizeBytes"), int) or entry["sizeBytes"] <= 0:
            raise CalibrationInputError("Calibration manifest audio size is invalid.")
        seen.add(digest)


def scan_audio_root(root: Path) -> list[dict[str, Any]]:
    if not root.is_dir():
        raise CalibrationInputError("The audio root is not a directory.")
    files: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name.endswith(".downloading"):
            continue
        extension = path.suffix.lower()
        if extension not in SUPPORTED_EXTENSIONS:
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in seen:
            raise CalibrationInputError("Duplicate audio content was found in the audio root.")
        seen.add(digest)
        files.append({"path": path, "sha256": digest})
    return files


def read_existing_snapshot(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    value = read_json(str(path))
    if not isinstance(value, dict) or value.get("schemaVersion") != "1.0" or value.get("provider") != "local-whisper":
        raise CalibrationInputError("The existing local transcript output is invalid.")
    return value


def make_run_id() -> str:
    return "local-whisper-v1-" + datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(":", "-").replace("+00:00", "Z")


def write_snapshot(
    path: Path,
    run_id: str,
    model: str,
    manifest: dict[str, Any],
    samples: dict[str, dict[str, Any]],
    status: str = "partial-failure",
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": "1.0",
        "provider": "local-whisper",
        "runId": run_id,
        "modelVersion": f"faster-whisper-{model}",
        "status": status,
        "samples": [samples[entry["sampleId"]] for entry in manifest["entries"] if entry["sampleId"] in samples],
    }
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    os.replace(temporary_path, path)


if __name__ == "__main__":
    raise SystemExit(main())
