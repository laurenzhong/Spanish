# 人物修订发布运行手册

## 范围

本手册覆盖一件事：**修改人物圣经并让新修订上线**。ADR 0014 之后，这条路只有三步——导入草稿 → 发布修订 → 指针已在发布事务内翻转；**用户状态零迁移**。

适用对象是 `content/characters/<key>.json`：

| 文件 | 当前文件内版本 | 线上指针 |
|---|---|---|
| `content/characters/lucia.json` | `lucia@2` | `lucia@2`（已发布） |
| `content/characters/mateo.json` | `mateo@1` | `mateo@1`（已发布） |
| `content/characters/ines.json` | `ines@1` | `ines@1`（已发布） |

本手册**不覆盖**：新角色的首次立项、`scripts/roll-character-version.ts`（历史纠正用，见文末）、切片 4 的双写收敛（尚未开始）。

## 0. 为什么必须发新修订，不能原地改

设计规定**已发布人物同版本修改被拒绝**（`docs/superpowers/specs/2026-08-24-lucia-character-bible-design.md:72`）。这不是脚手架洁癖，因为运行时的解析链是：

```
conversations.identity_id → character_identities (stable_key)
                          → character_identities.current_character_id → characters 修订行
```

`characters` 每一行是**一个修订**（`stable_key` + `character_version`）。历史消息上的 `messages.character_id` 记录"这条消息由哪一版生成"，如果原地改写已发布行，这条审计链就会指向一个内容已经变了的行——**旧对话的证据会跟着新内容一起变**。

所以正确做法永远是：新版本号 + 一条 `changeLog` 说明为什么取代上一版。发布门禁会检查这件事，漏了就直接拒绝（见第 1 步）。

真正的收益在用户状态侧：身份 `character_identities` 是不动的，**指针翻转一次，会话、消息、偏好、关系、记忆、主动消息去重状态全部自动指向新修订**——读路径一律"按身份查、再经指针取当前修订"，所以没有任何一行用户状态需要被改写。这正是 ADR 0014 要买的东西：2026-10-12 那次 v1→v2 被迫迁移 99 行用户状态、改 6 处硬编码 `characterVersion: 1`，从切片 2/3 起不再需要。

> 一处已知的残留（不影响迁移，但要知道）：少数写路径的 `onConflictDoNothing`/`onConflictDoUpdate` 仍以旧的 `(user_id, character_id)` 唯一索引为冲突目标。指针移到新修订后该目标不再匹配，理论上存在"两个并发请求各插一行"的窗口；切片 2 的预读把窗口压得很窄，切片 4 的 `(user_id, identity_id)` 唯一索引才会彻底关掉它。

## 1. 编辑 `content/characters/<key>.json`

两处必改：

1. **`version` 加一**：`2 → 3`。
2. **追加一条 `changeLog` 记录**，字段是 `{version, supersedesVersion, changeReason}`，必须与本次发布严格对应：

```json
"changeLog": [
  { "version": 2, "supersedesVersion": 1, "changeReason": "……上一版的原因，保留不动……" },
  {
    "version": 3,
    "supersedesVersion": 2,
    "changeReason": "为 personality.responseStyle 增加一条'不问用户已经回答过的问题'，起因是 2026-10-13 观察到连续两轮重复追问同一个周末安排。其余内容不变。"
  }
]
```

门禁会逐字段核对（`src/modules/characters/domain/canon-checker.ts` 的 `revisionIssues`）：候选 `version` 必须**大于**当前版本，且 `changeLog` 里必须存在一条 `version === 候选版本 && supersedesVersion === 当前版本` 的记录，否则报 `change-reason-required`。`changeReason` 长度 2–1000 字符，是给人看的审计文本，要写清"改了什么 + 为什么"。

`stableKey` 不允许在修订之间变化（`stable-key-mismatch`）。已向该用户揭示过的核心身份事实被改写也会被拒（`revealed-fact-conflict`），这类改动需要先做显式冲突处理，不属于本手册范围。

> `status` 字段填什么不影响结果：发布流程会把候选按 `published` 送进门禁。草稿内容仍按草稿保存。

## 2. `pnpm character:import`

```powershell
pnpm character:import content/characters/lucia.json
```

输出形如 `imported: lucia@3 (<character-row-uuid>)`。

**导入只创建修订行，不创建也不移动身份指针**（`src/modules/characters/application/import-character-bible.ts`）。原因：`character_identities.current_character_id` 是 `NOT NULL`，导入期创建的身份只能指向一个尚未发布的草稿——正是 ADR 0014 禁止的状态。身份统一在**发布**时按 `stable_key` upsert。

如果同一个 `stable_key@version` 已经存在但内容不同，导入会抛 `CharacterImportConflictError`（`Character lucia@3 already exists with different content.`）。**这是正确的拒绝，不是 bug**：一个修订行一经落库就不允许被另一次导入静默改写。处置方式是**再发一个新版本**（`version` 继续加一），而不是想办法覆盖旧行。

内容与已落库行完全一致时返回 `unchanged`，可以安全重跑。

## 3. `pnpm character:publish`

```powershell
pnpm character:publish content/characters/lucia.json --current=<被取代的那一版 json>
```

### 3.1 `--current` 指的是"上一版"，不是新版本

这一点最容易搞错：

- `--current=<path>` 传的是**被本次发布取代的那一版**（`supersedesVersion` 指向的那一版）。
- 参数按位置与源文件一一对应：多角色批量发布时，第 N 个 `--current=` 对应第 N 个源文件（`scripts/publish-character.ts`）。位置错配不会有友好提示，只会在门禁比对时报错，因此多角色发布时请逐个核对顺序。
- **不传 `--current`** 等于告诉门禁"没有上一版"，而门禁规定 `null` 只接受 version 1（`initial-version-must-be-one`），所以 version > 1 的发布**必须**传，否则直接被拒。这条以前是写死 `null` 的真实缺陷，已随 v1→v2 修复。

`content/characters/` 下**只保留当前在编的版本**，所以发布前要先把上一版**复制**到仓库**外面**的临时文件（不要动工作树里的文件）。发布 `lucia@3` 时上一版就是现在工作树里的 `lucia@2`：

```powershell
# ① 复制当前在编的 lucia@2 作为"上一版"（工作树里可能还有未提交的编辑，以文件为准）
Copy-Item content/characters/lucia.json $env:TEMP\lucia-v2.json

# ② 确认取到的确实是 v2、且 changeLog 里 v2 的 supersedesVersion=1
$prev = Get-Content $env:TEMP\lucia-v2.json -Raw | ConvertFrom-Json
"version=$($prev.version) supersedes=$(($prev.changeLog | Where-Object version -eq 2).supersedesVersion)"   # 期望 version=2 supersedes=1

# ③ 编辑 content/characters/lucia.json：version 改成 3，追加 changeLog {3, 2, "原因"}

# ④ 发布
pnpm character:publish content/characters/lucia.json --current=$env:TEMP\lucia-v2.json
```

发布前请自查：`--current` 指向的文件里 `version` 必须等于新文件里 `changeLog` 的 `supersedesVersion`。取错版本会被门禁的修订比对拒绝，不会静默写坏数据。

### 3.1.1 取"更早几版"时的一个已验证的坑

`--current` 不只是个版本号——门禁会拿它**逐字段比对**候选（`contentFingerprint`、`activeFactMap`、`changedCoreIdentityPaths`），所以它必须真的是*被取代的那一版内容*。而 `content/characters/lucia.json` 的 git 历史里**没有**与线上 `lucia@1` 内容一致的版本：

| 提交 | 文件里的 version | `responseStyle` 条数 |
|---|---|---|
| `c46bea8` | v1 | **3**（= 线上 `lucia@1` 的内容） |
| `2397055` | v1 | 5 ← 同一个 v1 被**原地改过** |
| `fd281e4` | v2 | 5 |

也就是说 v1 的文件内容在发布之后又被原地修改，正是第 0 节要禁止的做法。今天要发 `lucia@3` 不受影响（上一版就是当前文件），但**将来若要基于 `lucia@1` 发版**，不能随手挑一个历史提交：先按下面这条只读查询确认线上那一版的权威内容，再从历史提交里找出与它一致的那一份（例：`responseStyle` 应为 3 条）。

```sql
SELECT character_version AS version, status,
       jsonb_array_length(coalesce(profile->'personality'->'responseStyle', '[]'::jsonb)) AS style_rules
FROM characters WHERE stable_key = 'lucia' ORDER BY character_version;
```

如果找不到与线上修订一致的文件，**不要**拿近似版本凑合：门禁的"变化了什么"会基于错误基线，可能误放行或误拒。

### 3.2 指针就在同一次发布事务里翻转

发布路径 `publishCharacterBibles` → `repository.publish()` 在**同一个事务**内完成三件事（`src/modules/characters/repositories/drizzle-character-repository.ts`）：

1. 把修订行从 `draft`/`approved` 置为 `published`；
2. 写入 3 条 `content_reviews`（`es-ES` language、`zh-CN` pedagogy、`es-ES` canon，审核身份 `codex-ai-temporary-review:*`——历史审计记录保持原值）；
3. 按 `stable_key` upsert `character_identities`，把 `current_character_id` 置为刚发布的这一行。

第 3 步排在状态翻转**之后**，所以指针不可能落到未发布修订上；三步要么一起提交，要么一起回滚。**发布不写任何用户状态行**——这是 ADR 0014 的核心不变量，也有测试锁住。

输出：`published: lucia@3 (3 temporary reviews)`；如果这一版本来就已经是 `published`（重跑），输出 `unchanged:` 并且不重复插入审核记录。

## 4. 验证（只读）

发布完成后按顺序核对下面四项。全部是 `SELECT`，不改任何数据。

### 4.1 指针指向新修订

```sql
SELECT i.stable_key, c.character_version AS version, c.status
FROM character_identities i
JOIN characters c ON c.id = i.current_character_id
ORDER BY i.stable_key;
```

期望：`lucia -> lucia@3 (published)`。`status` 必须是 `published`——指针指向草稿是 ADR 明令禁止的状态。

### 4.2 用户状态行数不变

发布前先记下这组数字，发布后必须**逐项相同**（本机当前基线：会话 3、消息 93、偏好 3、主动消息候选 7、关系 3、记忆 0、共享权限 0、介绍提议 2，**合计 111 行**——介绍提议那一行在查询里只按 `source_identity_id` 计一次，两列都是 2。这些是**某个具体环境**的当前值，请以自己发布前实测为准）：

```sql
SELECT 'conversations' AS t, count(*) AS rows, count(identity_id) AS with_identity FROM conversations
UNION ALL SELECT 'messages',                     count(*), count(identity_id) FROM messages
UNION ALL SELECT 'conversation_preferences',     count(*), count(identity_id) FROM conversation_preferences
UNION ALL SELECT 'proactive_message_candidates', count(*), count(identity_id) FROM proactive_message_candidates
UNION ALL SELECT 'character_relationships',      count(*), count(identity_id) FROM character_relationships
UNION ALL SELECT 'relationship_memories',        count(*), count(identity_id) FROM relationship_memories
UNION ALL SELECT 'memory_sharing_permissions',   count(*), count(target_identity_id) FROM memory_sharing_permissions
UNION ALL SELECT 'character_introduction_offers', count(*), count(source_identity_id) FROM character_introduction_offers
ORDER BY t;
```

`count(*)` 与 `with_identity` 两列都必须与发布前一致；`with_identity` 掉下去说明出现了没有身份的孤儿行。

### 4.3 新修订的版本内容确实生效

```sql
SELECT character_version AS version, status,
       profile->'personality'->'responseStyle' AS response_style
FROM characters
WHERE stable_key = 'lucia'
ORDER BY character_version;
```

期望：新版本的 `response_style` 是编辑后的数组、`status = published`；旧版本仍在（历史查询还要靠它），内容不变。

### 4.4 运行时真的读到了新内容

行数一致只证明没写坏用户状态，还要证明**新内容进了 provider 上下文**。用一次性的只读脚本调 `resolveConversationCharacter`（照仓库惯例放在仓库根，跑完即删）：

```powershell
& node --use-env-proxy --conditions=react-server --import tsx/esm .tmp-check-character.ts
```

```ts
import "dotenv/config";
import { createDatabaseConnection } from "./src/shared/db/client";
import { createDrizzleCharacterRepository } from "./src/modules/characters/repositories";
import { resolveConversationCharacter } from "./src/modules/conversation/application/resolve-character-runtime";

const connection = createDatabaseConnection(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL!);
try {
  const resolved = await resolveConversationCharacter({
    characterKey: "lucia",
    characterVersion: 3, // 当前目录版本；陈旧客户端请求旧版本会得到 404，不会新建空会话
    repository: createDrizzleCharacterRepository(connection.db),
  });
  console.log(JSON.stringify({
    version: resolved.persisted?.version,
    responseStyle: resolved.catalog.snapshot.responseStyle,
  }, null, 2));
} finally {
  await connection.client.end();
}
```

`responseStyle` 必须包含本次新增的规则。解析顺序是"库里的 `profile.personality.responseStyle` 优先，缺项回退静态目录快照"，合并后的结果就在 `resolved.catalog.snapshot` 里——这份输出正是 provider 侧看到的东西。（`resolved.persisted.profile.personality.responseStyle` 是库里的原始值，两者应当一致。）

### 4.5 不需要做的事（历史上是必需的）

- ❌ 不迁移 `conversations` / `messages` / `conversation_preferences` / `character_relationships` / `relationship_memories` / `proactive_message_candidates` / `character_introduction_offers` / `memory_sharing_permissions`。
- ❌ 不跑 `scripts/roll-character-version.ts`（它现在只用于历史纠正，不再是"每次升版必跑"）。
- ❌ 不改任何硬编码 `characterVersion: 1`（读路径按 `stable_key` 解析身份，路由只服务目录里的当前版本）。
- ❌ 不改 `character_canon_facts`（版本内容仍挂修订行 id，本来就属于那一版）。

## 5. 如果出问题

### 5.1 把指针指回上一版（一条 UPDATE）

这是本手册唯一允许的写操作，也是身份/修订分离买到的主要救急能力：**回滚不需要碰任何用户状态**，因为用户状态根本不在修订行上。

```sql
-- 先只读确认要指回去的修订行就是上一版的已发布行
SELECT c.id, c.character_version AS version, c.status
FROM characters c
WHERE c.stable_key = 'lucia' AND c.character_version = 2;

-- 确认无误后再执行（把 <identity-uuid> 与 <previous-revision-uuid> 换成上面的实际值）
UPDATE character_identities
SET current_character_id = '<previous-revision-uuid>', updated_at = now()
WHERE id = '<identity-uuid>';
```

要点：

- **不要删除刚发布的修订行**。它已经是审计证据（`messages.character_id` 可能指向它），保留为 `published`；指针离开它即可。
- 这条 UPDATE **绕过了发布事务里的"只能指向已发布修订"保证**，所以只允许人工在事故处置中执行，并且必须确认目标行 `status = published`。正常流程永远走第 3 步。
- 回滚后请在同一个 PR/任务记录里写清：什么时候、为什么、指回了哪一版。
- 正确修复路径仍然是**发一个新修订**（`version` 继续加一，`changeLog` 说明"撤销 v3 的某条规则"），而不是原地编辑 v3。

### 5.2 常见拒绝与定性

| 现象 | 定性 | 处置 |
|---|---|---|
| `CHARACTER_REVIEW_INVALID` | 门禁拒绝，稳定错误码不区分具体条目 | 检查：`status` 是否 `published`、`changeLog` 是否有对应记录、`version` 是否真的加了、是否误传/漏传 `--current` |
| 导入抛 `CharacterImportConflictError` | 同 `stable_key@version` 已存在且内容不同 | 正确拒绝；**再发一个新版本**，不要试图覆盖 |
| 发布输出 `unchanged` 而不是 `published` | 该修订本来已是 `published` | 说明先前已经发布过；核对指针是否已指向它，不要重复制造版本 |
| 指针指向了未发布修订 | 不允许的状态 | 按 5.1 指回上一版已发布修订，然后走正常发布 |
| 聊天出现 `CONTACT_REQUIRED` 403 | 联系人门禁：该用户与 Lucía 的关系不是 `active` | 自切片 2 起联系人仓库整体按身份查询，与修订版本解耦；若仍出现，属关系状态问题，不是发布问题 |

## 6. 日志与隐私

发布脚本只输出 `status: <stableKey>@<version> (<row-id>)`、审核条数和行 id，不含人物私密内容、数据库 URL、密钥或用户标识。`changeLog` 会落库、可被人工读取，因此**不要把用户私聊原文、真实姓名或可识别信息写进 `changeReason`**；用"观察到连续两轮重复追问"这类描述，而不是引用用户原话。

## 7. 相关文件

- 决策：`docs/adr/0014-character-identity-separate-from-revisions.md`
- 实施计划与切片状态：`docs/plans/2026-10-12-character-identity-implementation-plan.md`
- 圣经设计约束：`docs/superpowers/specs/2026-08-24-lucia-character-bible-design.md`
- 迁移与表结构：`docs/database.md`
- 运行时与发布门禁：`docs/architecture.md` 6.10
- 历史纠正脚本（**非日常**）：`scripts/roll-character-version.ts`
