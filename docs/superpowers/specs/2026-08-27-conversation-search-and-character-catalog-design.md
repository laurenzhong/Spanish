# Conversation Search and Character Catalog Design

> 2026-09-26 说明：本文描述搜索与目录的交互契约；角色是否可进入生产由 [ADR-0009](../../adr/0009-character-runtime-and-conversation-boundary.md) 与 [`CONV-ROLE-001`](../../plans/2026-09-26-character-runtime-and-conversation-closure-implementation-plan.md) 决定。本文中“三个目录条目”的历史假设不代表三个角色都已发布；当前个人 Alpha 只正式开放已发布的 Lucía，Mateo/Inés 的 `draft`/`coming-soon` 状态必须在服务端和 UI 同时生效。

## Scope

This slice adds searchable conversation history and makes the existing Lucía,
Mateo, and Inés character bibles available from the web conversation workspace.
It does not add a new service, real-time voice calls, social discovery, or a
second memory store.

## User experience

- The contact rail has a real search field labelled `搜索对话`.
- Search is submitted with Enter or the search button and debounced while typing.
- Results show character name, role, a short matching message excerpt, and time.
- Selecting a result navigates to `/chat/{characterKey}?message={messageId}`.
- The target thread scrolls to and briefly highlights the matching message.
- Empty, loading, unavailable, and unauthenticated states are explicit.
- The same search control remains keyboard accessible on mobile through the
  conversation header/rail surface without changing the product navigation.

## Data and API

`ConversationRepository` gains `searchMessages(userId, query, limit)`.
The Drizzle implementation searches only the authenticated user's messages,
escapes SQL LIKE wildcards, orders newest first, and caps results at 50.

`GET /api/v1/conversations/search?q=...` returns:

```json
{
  "data": {
    "query": "café",
    "results": [
      {
        "messageId": "uuid",
        "characterKey": "lucia",
        "characterName": "Lucía Martín",
        "role": "character",
        "text": "...café...",
        "createdAt": "2026-08-27T00:00:00.000Z"
      }
    ]
  }
}
```

The route uses the existing auth verification and returns no message content
for another user. Query text is never logged.

## Character catalog

A single conversation catalog maps the three published API character keys to
display metadata and reply context snapshots. The route validates a key against
this catalog before reading history or starting a stream. The provider receives
the selected character snapshot, while relationship memories remain scoped to
that character and user.

The contact rail renders all catalog entries. Lucía remains pinned first;
Mateo and Inés are selectable only when their character API records are
available. Unknown keys return the existing 404 boundary.

## Highlight and failure handling

The thread reads `message` from the URL after hydration, scrolls the matching
element into the message container, and applies a temporary `data-highlighted`
state. Missing IDs are ignored. Search failures do not affect sending or
history hydration. Provider failures retain the current deterministic fallback
and existing `done` persistence rule.

## Testing

- Repository/API tests cover escaped queries, ownership, result limits, empty
  queries, and auth failures.
- Component tests cover search states and URL result links.
- E2E covers searching a known phrase, navigating to the matching message,
  selecting Mateo/Inés, and confirming the selected character in the header.
- Existing stream, cancellation, retry, privacy, and `done` persistence tests
  remain unchanged.
