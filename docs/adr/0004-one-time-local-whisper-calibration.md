# ADR-0004: One-Time Local Whisper Calibration

- Date: 2026-08-22
- Status: Accepted

## Context

The approved five-file calibration batch cannot use the configured OpenAI Platform
credential. MiniMax-M3 is a text model and does not provide the MP3 speech-to-text
operation required by this batch. The five audio files are user-owned and may be
processed locally, while the existing MiniMax annotation step remains text-only.

The Alpha scope normally defers offline ASR. This decision is a narrow exception for
the current five-file calibration and does not add offline ASR to the product or to
future user recordings.

## Decision

1. Use an isolated Python `faster-whisper` runner with the `small` model on the local
   Windows machine for the five manifest entries only.
2. Match files by SHA-256 against the existing manifest before decoding. Do not send
   audio bytes, file names or paths to MiniMax or any cloud STT provider.
3. Write a resumable external transcript snapshot, then pass only its transcript text
   and `speechSignal: null` to the existing MiniMax annotation provider.
4. Keep transcript and annotation results outside Git and the database. Do not write
   evidence, mastery, confidence, profiles or long-term audio assets.
5. Record the local provider and model version in the external result so human review
   can distinguish local transcription from the earlier OpenAI attempt.

## Consequences

- The batch has no per-audio OpenAI STT charge and keeps the audio on the local machine.
- Model download and CPU execution consume local storage and time; Spanish transcript
  quality still requires human review.
- The existing application provider boundary remains unchanged for product flows; the
  local path is a one-time calibration tool only.
- A future production offline ASR feature requires a new design, retention review and
  platform testing rather than reusing this exception implicitly.
