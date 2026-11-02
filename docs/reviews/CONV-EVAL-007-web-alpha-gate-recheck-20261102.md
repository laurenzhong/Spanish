# CONV-EVAL-007 Web Alpha gate recheck

Date: 2026-11-02

This is an incremental recheck against the revised Web Alpha gate. The target stayed fixed at:

- commit `27fa4774fd06e10af75b01a7f53fedb3afc95e92`
- deployment `7480426775`
- URL `https://spanish-7wbg556tt-zjk159357s-projects.vercel.app/`

The decision remains **open**. The gate is narrower and clearer, but same-pin authenticated Web evidence is still missing.

| ID | Criterion | Result | Evidence / reason |
| --- | --- | --- | --- |
| W1 | Same-pin root, manifest, and unauthenticated API boundary | Read-only pass | Alternate-network Jina Reader probe; `/api/v1/me` target body is `AUTH_REQUIRED`/401 behind the reader wrapper |
| W2 | Real OTP login and basic Lucía read/send/finish path | Missing | No stable browser runner or Preview Auth session secrets |
| W3 | Disposable-account 100-message history, first-request retry, refresh | Missing | Old run `41349410632` used a different pin |
| W4 | Disconnect/retry/cancel/error recovery and generation isolation | Missing | No same-pin authenticated browser run |
| W5 | Desktop/Mobile Web layout and no material overflow | Missing | Old mobile result is stale-pin evidence; local mock E2E is excluded |
| W6 | Session/conversation/messages/Storage cleanup and old-session invalidation | Partial backend only | 005 has Auth/export/delete/Storage evidence, but this recheck lacks same-pin browser session proof |
| W7 | No unresolved P1 security/privacy/data-integrity/auth blocker | No known open P1 | Does not replace missing Web evidence |

The runner audit found no self-hosted runner, no `PREVIEW_AUTH_SESSION_JSON`, `PREVIEW_SUPABASE_URL`, or `PREVIEW_SUPABASE_PUBLISHABLE_KEY`, and no formal browser workflow suitable for this check. Disabled temporary workflow `403842975` remains disabled; it was not restored and no workflow was dispatched.

Archive copies:

- Workspace: `D:\workspace\artifacts\conversation-evaluations\web-alpha-gate-recheck-20261102\`
- Desktop: `C:\Users\master\Desktop\Lucía聊天测试\web-alpha-gate-recheck-20261102\`

Accounting: `providerCalls=0`, `databaseWrites=0`, `authMutations=0`, `storageMutations=0`, `deploymentMutations=0`.

This recheck does not close 007 or overall usability. The next required change is an approved stable browser runner and disposable test-account path for the same latest pin.
