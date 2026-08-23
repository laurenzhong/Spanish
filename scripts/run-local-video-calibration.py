"""Create a local, diagnostic-only transcript and speech-signal report for one video."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path
from typing import Any


FRAME_MS = 20
MINIMUM_PAUSE_MS = 120
MINIMUM_DURATION_MS = 100
MINIMUM_RMS = 0.01


class CalibrationInputError(Exception):
    pass


def main() -> int:
    args = parse_args()
    video_path = Path(args.video)
    reference_path = Path(args.reference)
    output_path = Path(args.output)
    if not video_path.is_file():
        raise CalibrationInputError("The local video file is not readable.")
    if not reference_path.is_file():
        raise CalibrationInputError("The confirmed transcript file is not readable.")

    reference_text = reference_path.read_text(encoding="utf-8").strip()
    if not reference_text:
        raise CalibrationInputError("The confirmed transcript is empty.")

    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise CalibrationInputError(
            "faster-whisper is not installed in the selected Python environment."
        ) from error

    started = time.perf_counter()
    model = WhisperModel(
        args.model,
        device="cpu",
        compute_type="int8",
        cpu_threads=max(1, args.cpu_threads),
    )
    segments, info = model.transcribe(
        str(video_path),
        language="es",
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    segment_values = [
        {
            "startMs": round(segment.start * 1000),
            "endMs": round(segment.end * 1000),
            "text": segment.text.strip(),
        }
        for segment in segments
        if segment.text.strip()
    ]
    transcript = " ".join(segment["text"] for segment in segment_values).strip()
    if not transcript:
        raise CalibrationInputError("The local transcription is empty.")

    signal = analyze_audio_signal(video_path)
    payload = {
        "schemaVersion": "local-video-calibration-v1",
        "source": {
            "type": "user-recorded-video",
            "fileName": video_path.name,
            "sha256": hashlib.sha256(video_path.read_bytes()).hexdigest(),
            "audioUploaded": False,
            "audioRetained": False,
        },
        "transcription": {
            "provider": "local",
            "modelVersion": f"faster-whisper-{args.model}",
            "language": info.language,
            "languageProbability": round(float(info.language_probability), 3),
            "durationMs": round(float(info.duration) * 1000),
            "segmentCount": len(segment_values),
            "segments": segment_values,
            "transcript": transcript,
            "latencyMs": round((time.perf_counter() - started) * 1000),
        },
        "review": {
            "transcriptReview": "confirmed",
            "confirmedTranscript": reference_text,
            "reviewNotes": "用户提供了人工确认文本；本地 Whisper 结果仅用于差异观察。",
        },
        "speechSignal": signal,
        "disposition": "diagnostic-only",
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": "completed",
        "output": str(output_path),
        "segments": len(segment_values),
        "durationMs": payload["transcription"]["durationMs"],
        "speechSignalQuality": signal["quality"],
    }, ensure_ascii=False))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--cpu-threads", type=int, default=4)
    return parser.parse_args([argument for argument in sys.argv[1:] if argument != "--"])


def analyze_audio_signal(video_path: Path) -> dict[str, Any]:
    try:
        import av
        import numpy as np
    except ImportError as error:
        raise CalibrationInputError("PyAV and numpy are required for local signal analysis.") from error

    try:
        container = av.open(str(video_path))
        audio_stream = next(stream for stream in container.streams if stream.type == "audio")
        resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=16000)
        chunks: list[Any] = []
        for frame in container.decode(audio_stream):
            resampled = resampler.resample(frame)
            frames = resampled if isinstance(resampled, list) else [resampled]
            for item in frames:
                chunks.append(item.to_ndarray())
        flushed = resampler.resample(None)
        frames = flushed if isinstance(flushed, list) else [flushed]
        for item in frames:
            chunks.append(item.to_ndarray())
        container.close()
    except Exception as error:
        raise CalibrationInputError("The video audio track could not be decoded locally.") from error

    if not chunks:
        raise CalibrationInputError("The video has no decodable audio frames.")
    samples = np.concatenate([chunk.reshape(-1) for chunk in chunks]).astype(np.float32) / 32768.0
    duration_ms = len(samples) / 16000 * 1000
    frame_length = max(1, round(16000 * FRAME_MS / 1000))
    rms_values = []
    for offset in range(0, len(samples), frame_length):
        frame = samples[offset:offset + frame_length]
        rms_values.append(float(np.sqrt(np.mean(np.square(frame)))))
    peak_rms = max(rms_values, default=0.0)
    if duration_ms < MINIMUM_DURATION_MS or not math.isfinite(peak_rms) or peak_rms < MINIMUM_RMS:
        return insufficient_signal(duration_ms)

    threshold = max(MINIMUM_RMS, peak_rms * 0.12)
    voiced = [rms >= threshold for rms in rms_values]
    voiced_count = sum(voiced)
    first = next((index for index, value in enumerate(voiced) if value), -1)
    last = next((index for index in range(len(voiced) - 1, -1, -1) if voiced[index]), -1)
    if voiced_count < 3 or first < 0 or last < first:
        return insufficient_signal(duration_ms)
    span = voiced[first:last + 1]
    pause_count = count_pauses(span)
    return {
        "quality": "usable",
        "durationMs": round(duration_ms, 3),
        "voicedRatio": round(voiced_count / len(voiced), 3),
        "pauseCount": pause_count,
        "pauseRatio": round(sum(not value for value in span) / len(span), 3),
        "analyzer": "local-signal",
        "algorithmVersion": "local-signal-v1",
        "retentionPolicy": "ephemeral",
    }


def count_pauses(frames: list[bool]) -> int:
    minimum_pause_frames = max(1, math.ceil(MINIMUM_PAUSE_MS / FRAME_MS))
    pauses = 0
    silent_frames = 0
    for is_voiced in frames:
        if not is_voiced:
            silent_frames += 1
            continue
        if silent_frames >= minimum_pause_frames:
            pauses += 1
        silent_frames = 0
    if silent_frames >= minimum_pause_frames:
        pauses += 1
    return pauses


def insufficient_signal(duration_ms: float) -> dict[str, Any]:
    return {
        "quality": "insufficient",
        "durationMs": round(duration_ms, 3),
        "voicedRatio": None,
        "pauseCount": None,
        "pauseRatio": None,
        "analyzer": "local-signal",
        "algorithmVersion": "local-signal-v1",
        "retentionPolicy": "ephemeral",
    }


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CalibrationInputError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
