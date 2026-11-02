# CONV-EVAL-007 Preview provider configuration diagnosis

Date: 2026-11-02

This read-only diagnosis uses the authenticated Chrome CDP session against the same latest Preview pin:

- commit `27fa4774fd06e10af75b01a7f53fedb3afc95e92`
- deployment `7480426775`
- URL `https://spanish-7wbg556tt-zjk159357s-projects.vercel.app/`

The browser requested `/api/v1/providers/status` and `/api/v1/me/provider-preferences` without changing data. The provider status response reported MiniMax and OpenAI as `configured: false` and `status: unavailable` for the listed capabilities. Provider keys and secrets were not read or logged. Provider preferences were empty.

This matches the observed failures:

- `POST /api/v1/conversations/lucia/expression-assist` returned 503.
- `POST /api/v1/tts` returned 503 and produced no audio element.
- The route implementations map provider-not-configured/unavailable errors to 503; there is no browser speech fallback for read-aloud.

The user reports that the local service's translation and read-aloud work. The differential is therefore consistent with Preview runtime configuration, not a UI-only defect. GitHub environment secret names being present does not prove that Vercel Preview has the corresponding values; this diagnosis did not modify either system.

Accounting: read-only authenticated status calls only; `providerCalls=0`, `databaseWrites=0`, `authMutations=0`, `storageMutations=0`, `deploymentMutations=0`.

This diagnosis does not close 007. Preview provider configuration must be corrected and rechecked on a new, explicitly recorded deployment pin before translation, TTS, or completed conversation streaming can count as available.

Archive copies:

- Workspace: `D:\workspace\artifacts\conversation-evaluations\preview-provider-config-diagnosis-20261102\`
- Desktop: `C:\Users\master\Desktop\Lucía聊天测试\preview-provider-config-diagnosis-20261102\`
