# 版本化内容源

正式内容从 ALPHA-006 开始放入本目录。建议每次导入使用一个完整、可审计的 Content Bundle：

```text
content/
  bundles/
    alpha-core-v1.json
    readlang-public-v1.json
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

本目录不得提交未经许可的外刊全文、付费内容、真实审核者隐私信息或供应商凭据。

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
