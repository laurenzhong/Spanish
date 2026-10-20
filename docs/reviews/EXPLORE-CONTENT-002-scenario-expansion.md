# EXPLORE-CONTENT-002：探索场景扩容审核记录

- 日期：2026-09-27
- 范围：`alpha.scenario-practice@4`
- Bundle：`content/bundles/scenario-practice-alpha-v4.json`
- 目的：在保留 v3 六个公共场景的前提下，补充交通、邮局和酒店三种不同生活语境
- 审核身份：`codex-ai-owner-authorized-review`
- 授权边界：项目所有者已授权 Codex 在个人 Alpha 阶段完成 AI 辅助的 `es-ES` 语言审核与 `zh-CN` 教学审核；以下记录不代表真人、母语者或教学专家签字

## 版本与不可变性

v4 完整携带 v3 的 6 个场景、15 条表达、9 个学习目标和 1 个沟通领域，并新增 3 个场景、9 条表达和 9 个学习目标。v2、v3 文件保持不变；v4 使用新的 Bundle 版本和新的稳定键，不覆盖已产生学习证据的历史版本。

## 新增场景

| 稳定键 | 场景 | 临时人物 | 交际重点 | 现实边界 |
| --- | --- | --- | --- | --- |
| `scenario.transport-ticket` | 交通沟通：买票与改签 | Óscar，虚构交通窗口工作人员 | 说明目的地、询问班次、提出改期 | 不提供真实车次、票价、购票或改签结果 |
| `scenario.post-office` | 邮局沟通：寄件与补充信息 | Clara，虚构邮局工作人员 | 说明寄件、询问时间、补充地址资料 | 不代表真实邮局、运单、时效或寄件结果 |
| `scenario.hotel-checkin` | 酒店沟通：入住与房间问题 | Diego，虚构酒店前台工作人员 | 说明预订、确认服务、请求处理问题 | 不代表真实酒店、预订、房间、价格或入住结果 |

每个场景均包含：

- 西语与中文开场；
- 3 个按位置排序的任务；
- 每个任务的成功意图、三级提示和至少一个自然变体；
- 一个在第 2 个用户回合后触发的条件变化；
- 信息变化、关系变化和陌生变体三类迁移要求；
- `fictionalContext: true`，以及描述、开场和条件中的现实边界说明。

## 审核结论

### `es-ES` 语言维度

已核对每条新增表达的语法、搭配、礼貌程度、地区/语域标记、变体、提示示例、条件变化和表达自然度。交通、邮局和酒店用语均保持在 A2–B1 的日常服务沟通范围；没有将练习内容写成已发生的现实交易或服务结果。

审核记录：每条新增 expression 与 scenario 均有一条 `approved`、`locale=es-ES`、`reviewerReference=codex-ai-owner-authorized-review` 的记录。

### `zh-CN` 教学维度

已核对中文标题、说明、沟通目标、成功标准、三级提示、自然替代和迁移任务。提示先给意图，再给关键词/句型骨架，最后给完整示范并明确可使用自然替代；没有把单一参考句当作唯一正确答案。

审核记录：每条新增 expression 与 scenario 均有一条 `approved`、`locale=zh-CN`、`reviewerReference=codex-ai-owner-authorized-review` 的记录；新增 learning goal 至少有一条同一审核身份的 approved 元数据/教学记录。

## 安全与范围检查

- 未加入医疗诊断、剂量、处方、急症判断或其他专业建议。
- 未写入真实地址、电话、订单号、房源、预约、车票、价格或可验证的线下安排。
- 临时人物只在当前练习中存在，不写入长期角色网络或关系记忆。
- 场景扩容只修改公共 Explore 目录、版本化内容包、分类投影和相关测试；未新增 CMS、媒体采集、评分或画像逻辑。
- Bundle 在导入前通过完整 Schema/语义校验；数据库导入按 `v1 → v2 → v3 → v4` 验证，重复导入 v4 返回 `unchanged`。

## 验证命令

```powershell
node node_modules/tsx/dist/cli.mjs scripts/validate-content.ts content/bundles/scenario-practice-alpha-v4.json
```

预期输出：`Valid content bundle: alpha.scenario-practice@4`。

