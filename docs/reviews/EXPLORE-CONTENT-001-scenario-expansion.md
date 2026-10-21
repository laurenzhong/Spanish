# EXPLORE-CONTENT-001：探索场景目录扩充审核记录

- 日期：2026-09-26
- 范围：个人 Alpha 的探索页公共场景目录
- 内容版本：`alpha.scenario-practice@3`
- 审核身份：`codex-ai-owner-authorized-review`
- 适用边界：仅供项目所有者本人使用；审核者是 Codex AI，不是真人、母语者或教学专家签字

## 变更

在保留 `alpha.scenario-practice@2` 历史版本不变的前提下，创建后继 bundle `alpha.scenario-practice@3`。新版本保留原有三个场景，并新增三个可开始的公开练习：

- `scenario.restaurant-takeaway`：餐厅沟通：打包与替换
- `scenario.campus-student-card`：校园办事：领取学生卡
- `scenario.rental-viewing`：租房沟通：预约看房

新增场景继续复用已审核的西语核心表达和学习目标，但各自拥有独立的临时人物、开场、条件变化、任务成功标准、三级提示和迁移要求。租房场景明确标注为完全虚构，不代表真实房源、地点或预约；其他场景同样只描述虚构练习窗口，不承诺现实服务。

## 双维度复核

每个新场景都记录两条 `approved` review：

1. `es-ES`：复核西语表达、语域、自然度、变式、提示和条件变化。
2. `zh-CN`：复核中文教学说明、任务目标、迁移提示和虚构边界。

所有记录均使用 `codex-ai-owner-authorized-review`，时间为 `2026-09-26T00:00:00.000Z`。新增内容未自动写入学习证据、画像或关系记忆；Explore 只在服务端发布状态通过后投影。

## 验证

```powershell
pnpm content:validate -- content/bundles/scenario-practice-alpha-v2.json
pnpm content:validate -- content/bundles/scenario-practice-alpha-v3.json
```

两份 bundle 均通过完整 Schema、引用、版权/状态和审核门禁。运行时切换到 v3；v2 保留为不可变历史来源。
数据库回归还按 `v1 → v2 → v3` 顺序验证了幂等导入与后继 bundle 的前向推进。
