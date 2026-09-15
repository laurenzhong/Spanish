import type { SpeechToTextProvider } from "../stt";

/** Internal media boundary; it intentionally reuses the validated STT contract. */
export type MediaTranscriptionProvider = SpeechToTextProvider;
export { FakeSpeechToTextProvider as FakeMediaTranscriptionProvider } from "../stt/fake-transcription";
export { SpeechToTextError as MediaTranscriptionProviderError } from "../stt/transcription";

