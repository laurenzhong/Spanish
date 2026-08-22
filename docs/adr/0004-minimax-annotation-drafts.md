# ADR-0004: MiniMax Annotation Drafts Without Audio Upload

- Status: accepted for personal Alpha
- Date: 2026-08-22

## Context

MiniMax-M3's official Anthropic-compatible documentation lists text, image,
video, tool use and thinking blocks, but does not list audio input. The local
speech path already produces aggregate signal observations without retaining
the recording. The project needs an inexpensive way to prepare annotation
work for human review without treating a language model as a pronunciation
grader.

## Decision

Add a server-only MiniMax annotation-draft provider that sends only:

- the learner transcript;
- locale, content version, attempt ID and generation ID; and
- aggregate `SpeechSignalObservation` metadata.

The provider sends no audio bytes, file names or MIME types. Its output is a
strictly structured `draft` with tentative observations and reviewer
questions. Every observation requires human review. The result contains
explicit safety flags showing that it does not write evidence or update
`mastery` or `confidence`.

The API key is read only from the server environment (`MINIMAX_API_KEY`) or an
explicit server-side factory option. The provider is opt-in and no default
application path calls the real API.

## Consequences

- MiniMax can help organize transcript and signal metadata for review at low
  cost, but cannot replace audio-capable pronunciation assessment or a native
  speaker.
- Raw教材 audio remains local and is not uploaded by this path.
- Provider drafts must be reviewed before they can inform any future replay
  annotation; this task does not write `evidence_events` or skill snapshots.
- The current API terms and privacy policy permit use of input/output to
  provide, maintain, develop and improve services and describe global data
  processing. Third-party textbook audio therefore remains out of scope unless
  the user has explicit processing permission.

