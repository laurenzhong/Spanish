# 版本化内容源

正式内容从 ALPHA-006 开始放入本目录。建议每次导入使用一个完整、可审计的 Content Bundle：

```text
content/
  bundles/
    alpha-core-v2.json
    scenario-practice-alpha-v4.json
    readlang-public-v1.json
```

当前探索场景目录运行时读取 `alpha.scenario-practice@4`（文件为
`content/bundles/scenario-practice-alpha-v4.json`）。`v2` 和 `v3` 保留为不可变历史
bundle；新增场景必须创建更高的 bundle 版本，不能在原版本上追加内容。

```powershell
pnpm content:validate -- content/bundles/scenario-practice-alpha-v4.json
pnpm content:import -- content/bundles/scenario-practice-alpha-v4.json
```

内容文件必须符合 `contracts/schemas/v1/content-bundle.schema.json`，并通过服务端语义校验：

```powershell
pnpm content:validate -- content/bundles/alpha-core-v1.json
```

在明确配置本地或测试数据库后执行幂等导入：

```powershell
pnpm content:import -- content/bundles/alpha-core-v1.json
```

同一 bundle 稳定 ID 与版本、相同内容会返回 `unchanged`；相同 ID 与版本但内容不同会拒绝。新版本必须显式增加 bundle 版本以及发生变化的版本化实体版本。导入不会自动批准或发布内容。

当前仅供项目所有者本人使用的产品阶段，正式表达和场景由代理平台 DSH 分别完成 `es-ES` 语言审核与 `zh-CN` 教学审核；新记录使用 `dsh-ai-owner-authorized-review`，并明确说明 AI 身份和 2026-09-12 的所有者授权。2026-10-10 平台从 Codex 迁移到 DSH 之前写入的 `codex-ai-owner-authorized-review`、`codex-ai-temporary-review` 记录属于追加式审计证据，保持原值，发布门禁同时接受两种身份。生成内容仍先进入草稿，审核是独立步骤。产品开始面向其他真实用户前必须新增 ADR 重审外部审核门槛。

后继 bundle 可以在内容字段和子项完全一致时单向推进既有实体状态；不能降级、恢复已归档内容或用相同实体版本改写内容。已发布 expression/scenario 必须同时具有上述两个 locale 的 approved review。

本目录不得提交未经许可的外刊全文、付费内容、真实审核者隐私信息或供应商凭据。

## 常用词汇表（glossary）

`glossary/es-zh-common-v1.json` 是阅读器查词与 `/read/vocabulary` 学习词表共用的已审核常用词表。文首 `review` 记录当前所有者授权下的 AI 审核：`es-ES` 词条与 `zh-CN` 教学说明均由代理平台以 AI 身份完成，新记录使用 `dsh-ai-owner-authorized-review:<actor>`（本文件为 `dsh-ai-owner-authorized-review:vocabulary-study-list`）。历史 `codex-ai-owner-authorized-review` 记录是追加式审计证据，保持原值、不改写；任何身份都不代表真人、母语者或教学专家签署。

新增或修改词条时必须保持：

- 每个条目都有 `headword`、`partOfSpeech`、`cefr`、至少一条带 `meaning` 和 `usage` 的中文释义、`collocations`、`examples` 与 `reviewStatus: "reviewed"`。
- `forms` 只登记用于语料匹配的归一化词形（小写、去重音、不含标点），同一词形不能同时指向两个不同条目；有歧义的高频词形（例如动词与名词同形）只保留一个归属。
- 词条修改属于内容变更，必须在此记录审核状态，并在发布前通过 `tests/unit/common-glossary.test.ts` 与 `/read/vocabulary` 相关回归。

Content Bundle 也可以包含 `articles`。文章版本、来源、段落和资产会在一次事务中导入；文章必须提供规范化 `contentHash`，正文只允许清洗后的纯文本。草稿文章可用于开发验证，但只有来源、版权和审核字段完整的已批准版本才能公开发布。阅读文章与口语证据、掌握度和可信度完全隔离。

## 已授权公共文章

`readlang-public-v1.json` 收录从 `C:\Users\master\Desktop\output\articles.jsonl` 导出的 100 篇西语文章。该导出由项目所有者确认拥有再发布授权；每篇文章都保留 Readlang 原始 URL、作者（如可用）、归属信息、授权证据和审核记录。文章以 `licensed` / `cleared` / `published` 状态进入 Public Texts，不把正文复制到用户私有阅读来源表。

如需从同一格式重新生成 bundle：

```powershell
pnpm exec tsx scripts/import-readlang-public.ts C:\Users\master\Desktop\output\articles.jsonl
pnpm content:validate -- content/bundles/readlang-public-v1.json
pnpm content:import -- content/bundles/readlang-public-v1.json
```

重复执行数据库导入会返回 `unchanged`；同一 bundle 版本内容发生变化时会被导入器拒绝。
