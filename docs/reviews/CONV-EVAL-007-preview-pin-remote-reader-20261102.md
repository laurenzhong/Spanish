# CONV-EVAL-007 latest Preview pin remote-reader probe

Date: 2026-11-02

The latest Preview target remained fixed throughout this slice:

- commit `27fa4774fd06e10af75b01a7f53fedb3afc95e92`
- deployment `7480426775`
- URL `https://spanish-7wbg556tt-zjk159357s-projects.vercel.app/`

Because direct access from the workstation is still blocked at the Preview network path, the same target was read through the stable alternate-network Jina Reader path (`https://r.jina.ai/`). The probe was GET-only and captured no account or session data.

Observed responses:

- `/` was reachable and returned the public Sueño root through the reader.
- `/manifest.webmanifest` was reachable and returned the Sueño PWA manifest.
- `/api/v1/me` reached the application and returned the app's unauthenticated `AUTH_REQUIRED` response. The reader wrapper itself reports HTTP 200 while embedding the target's HTTP 401 body; this is recorded in `api-v1-me.json` and is not counted as an authenticated success.

Archive copies:

- Workspace: `D:\workspace\artifacts\conversation-evaluations\preview-pin-remote-reader-20261102\`
- Desktop: `C:\Users\master\Desktop\Lucía聊天测试\preview-pin-remote-reader-20261102\`
- Workspace/Desktop file SHA-256 comparison: all 8 files equal.
- `result-summary.json`: `9735B93A873AD0A...` (full hash is in the archive command output and file manifest).

Accounting: `providerCalls=0`, `databaseWrites=0`, `authMutations=0`, `storageMutations=0`, `deploymentMutations=0`.

This proves alternate-network reachability and the unauthenticated API boundary for the same latest pin. Jina Reader is a GET/read-only proxy and cannot carry a browser cookie jar or complete the page's OTP flow. Therefore this slice does not prove real login-state Web behavior, long history, retry/refresh/recovery, desktop/mobile layout, Storage cleanup, old-session invalidation, or overall usability; CONV-EVAL-007 remains open.
