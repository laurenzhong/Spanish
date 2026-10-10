# 媒体存储缺口的接口契约（`artwork-storage` / `podcast-source-resolver`）

任务来源：`MERGE-001` 合并后 `main` 上 `tsc --noEmit` 仍有 11 个报错，全部由**被 import 但从未提交的两个模块**引起。本卡只把调用方的确切契约写清，实现由封面迁移的负责会话完成；本会话未代写实现（涉及 Supabase bucket 与官方 RSS 规则，属该工作流的语义）。

## 现状（已核实）

- `src/modules/media/storage/artwork-storage.ts` **在本仓库任何分支与任何提交中都不存在**（`git log --all --diff-filter=A` 无记录）。
- `src/modules/media/storage/podcast-source-resolver.ts` 同样从未提交。
- 引用它们的是已提交代码：`acquired-podcast-publisher.ts`、`acquired-video-publisher.ts`（`9155878` 引入）与 `scripts/backfill-media-word-timings.ts`。
- 因此 `main` 的 typecheck 目前是红的：`backfill` 7 条 + 两个 publisher 各 2 条。

## 契约 A：`@/src/modules/media/storage/artwork-storage`

调用方需要两个导出：

```ts
/** 已发表的封面快照：发布门禁与回退都依赖它不可变。 */
export type ArtworkSnapshot = Readonly<{
  // 由实现决定字段，但必须包含持久化后的可公开读取 URL 与内容哈希，
  // 以便 publishAcquiredPodcast/publishAcquiredVideo 的 artworkOverride 能记录来源。
}>;

export type MediaArtworkStorage = Readonly<{
  snapshot(input: Readonly<{
    stableKey: string;
    revision: number;
    artwork: unknown; // 候选草稿里的 artwork 字段
  }>): Promise<ArtworkSnapshot>;
}>;

/** 未配置凭据时返回 null，让 publisher 走 "Durable artwork storage is not configured." 的 fail-closed 分支。 */
export function createSupabaseMediaArtworkStorage(): MediaArtworkStorage | null;
```

调用点行为（已提交代码，不要改语义）：

- `acquired-podcast-publisher.ts:87-89`、`acquired-video-publisher.ts:105-107`：
  草稿带 `artwork` 但未注入 `artworkStorage` 时**抛冲突错误**（fail-closed）；
  注入时把 `await artworkStorage.snapshot({ stableKey, revision, artwork })` 的结果作为 `artworkOverride` 交给仓库层。
- `runtime-registry.ts` 当前**未**注入该依赖（`contentWorkflowPublishers` 只传 repository），因此接线上不会因为缺少凭据而在启动时失败。

## 契约 B：`@/src/modules/media/storage/podcast-source-resolver`

调用方需要两个导出：

```ts
/** 发布方官方源对给定 host 与 content-type 是否可接受（白名单规则集中在这里）。 */
export function acceptsPodcastAudioContentType(hostname: string, contentType: string): boolean;

/** 当前 URL 失效时，用发布方官方 RSS/代理解析出可用的音频 URL；无法解析返回 null。 */
export function resolveOfficialPodcastSource(
  input: Readonly<{ sourceName: string; title: string; currentUrl: string }>,
  options: Readonly<{ isAllowedSourceHost: (hostname: string) => boolean }>,
): Promise<URL | null>;
```

调用点行为（`scripts/backfill-media-word-timings.ts:12,93,304`）：

- 第 93 行用 `acceptsPodcastAudioContentType(hostname, contentType)` **过滤**可接受的 content-type 集合（`audio/mpeg`、`audio/mp3`、`application/octet-stream`）。
- 第 304 行：`provider_key === "bunny-storage"` 时**不调用**解析器；否则用 `sourceName/title/currentUrl` 求官方源，结果只在与 `isAllowedSourceHost` 一致时才替换存储 URL，任何异常都保留已验证的存储资产。
- 同一回退语义在 `app/api/v1/media/[stableKey]/stream/route.ts` 里已有**内联实现**（合并时取本分支版本，含 `resolveOfficialFallback`），可作为行为参考：解析失败必须 fail-closed，不得放宽 host 白名单。

## 完成标准

1. 两个模块按上述契约实现并提交（含各自单测：解析失败返回 `null`、host 不在白名单时不返回结果、`acceptsPodcastAudioContentType` 的边界）。
2. `pnpm typecheck` 从 11 条降为 0；`pnpm lint` 通过。
3. 若选择删掉调用方而不是实现模块，必须在同一提交里同时删掉两处 publisher 依赖与脚本用法，并说明封面覆盖能力被撤回（不得只让类型通过而静默丢掉封面持久化）。

## 复现

```powershell
git switch main && git pull
pnpm install
pnpm exec tsc --noEmit        # 期望当前为 11 条错误
```
