# CONV-EVAL-007 authenticated Web Alpha recheck via local Chrome CDP

Date: 2026-11-02

Target remained fixed at commit `27fa4774fd06e10af75b01a7f53fedb3afc95e92`, deployment `7480426775`, URL `https://spanish-7wbg556tt-zjk159357s-projects.vercel.app/`. Playwright attached to the user's explicitly launched isolated Chrome profile through `localhost:9222`. OTP, cookies, tokens, and message bodies were not archived.

Results:

- `/api/v1/me` returned HTTP 200 with an authenticated `v1` response; `/learn` and `/chat/lucia` stayed on the Preview without login redirect.
- Lucía conversation loaded and survived a page refresh. Desktop 1440px and Mobile 375px both had `documentWidth === viewportWidth`, with no horizontal overflow and no observed page errors.
- One authorized Spanish test message was sent. The stream did not complete; the UI showed the non-scoring incomplete-response state and `重新发送`. One UI retry was attempted and the page still showed the stopped/incomplete state. No complete assistant response or learning score was produced.
- With composer text present, `POST /api/v1/conversations/lucia/expression-assist` returned HTTP 503; the UI showed `暂时无法生成西语表达，保留了你的输入，请重试。`
- The message `朗读` action issued `POST /api/v1/tts` and returned HTTP 503; no audio element was created.
- The authorized test message was deleted through the page's own delete flow. A post-cleanup authenticated read of `/api/v1/conversations/lucia` returned HTTP 200 with one remaining message (the pre-existing Lucía opening message). No account-wide deletion, logout-all, or Storage mutation was performed.

The user reports that the corresponding local service translation and read-aloud functions work. That is a useful differential clue, but local behavior is not Preview evidence and does not override the Preview 503 results.

This slice passes authenticated entry, refresh, and Desktop/Mobile layout only. It does not close 007: complete send/finish, recovery success, 100-message history, old-session invalidation, and same-pin Storage cleanup remain unproven; Preview translation and TTS are concrete failures.

Accounting: one authorized test send and one retry attempt; one expression-assist request; one TTS request; one message deletion. Exact provider billing and database row counts are not exposed by the browser contract. No deployment mutation occurred.

Archive copies:

- Workspace: `D:\workspace\artifacts\conversation-evaluations\web-alpha-auth-cdp-20261102\`
- Desktop: `C:\Users\master\Desktop\Lucía聊天测试\web-alpha-auth-cdp-20261102\`
