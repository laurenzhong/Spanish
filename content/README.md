# 版本化内容源

正式内容从 ALPHA-006 开始放入本目录。建议每次导入使用一个完整、可审计的 Content Bundle：

```text
content/
  bundles/
    alpha-core-v1.json
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
