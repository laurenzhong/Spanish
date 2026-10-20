/** All synthesized product read-aloud uses the voice selected in TTS-AUDITION-001. */
export const READ_ALOUD_POLICY = {
  provider: "minimax", model: "speech-2.8-turbo", voiceId: "Spanish_SereneWoman",
  languageTag: "es-ES", synthesisSpeed: 1, sampleRate: 32_000, bitrate: 128_000,
  maxChunkCharacters: 1_000,
  maxAudioBytes: 4 * 1024 * 1024,
} as const;
