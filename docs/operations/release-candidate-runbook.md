# 发布候选门禁运行手册

发布候选必须同时通过代码质量、桌面核心路径、数据库/RLS、内容与隐私门禁，并由产品本人明确确认。自动化报告只能输出 `eligible` 或 `blocked`，不能自动发布、启动阶段 8 或改变内容状态。

## 生成报告

报告由 CI 或本地受控运行写成 JSON，再执行：

```powershell
pnpm release:check -- --input .tmp/release-candidate-report.json
```

必填检查为 `lint`、`typecheck`、`unit`、`e2eDesktop`、`build`、`databaseRls`、`contentPrivacy`，每项必须为 `passed`。报告还必须包含 `openP0`、`openP1` 和 `productConfirmed`。

示例：

```json
{
  "checks": {
    "lint": { "status": "passed" },
    "typecheck": { "status": "passed" },
    "unit": { "status": "passed" },
    "e2eDesktop": { "status": "passed" },
    "build": { "status": "passed" },
    "databaseRls": { "status": "passed" },
    "contentPrivacy": { "status": "passed" }
  },
  "openP0": 0,
  "openP1": 0,
  "productConfirmed": false
}
```

## 阻断规则

缺失、失败、阻塞或未运行的必填检查均阻断；任何未关闭的 P0/P1 缺陷阻断；没有产品本人确认也阻断。报告中的 detail 只写稳定错误码、数量、耗时和内部任务 ID，不写令牌、正文、完整对话、录音或签名 URL。

iPhone Safari/PWA 和 Flutter 当前作为延期验证记录，不能被伪造为通过，也不因延期状态单独阻断电脑端候选。真实设备具备后须单独执行并更新记录。

门禁通过不等于内容自动发布。正式内容仍需来源权利、双维度审核、版本/hash、数据库事务和显式发布操作；阶段 8 仍需产品本人另行确认后启动。
