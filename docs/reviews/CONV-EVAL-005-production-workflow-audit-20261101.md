## CONV-EVAL-005：生产主动调度 workflow 审计（2026-11-01）

本次审计只读取 GitHub Actions 的既有运行与日志，没有 dispatch 新运行、没有调用 MiniMax、没有写数据库，也没有修改生产配置。

### 已核实的运行证据

通过 `gh run list --workflow lucia-proactive-daily.yml --limit 20` 和逐条 `gh run view` 检查了最近 20 次调度：

- 19 次 `success`，1 次 `failure`，没有 `cancelled` 或仍在运行的记录。
- 成功运行 `41160884281`（2026-10-31 02:38 UTC）输出 `generated: 1`，实际写入了一条主动消息：`f1ddb94b-0ab6-4e9e-8710-4dc2947406f2`。
- 成功运行 `41212997984`（2026-10-31 15:03 UTC）输出 3 个 `weekly-limit` 抑制结果，`failed: 0`，说明轮询到期槽位后仍由服务端资格门禁抑制，而不是重复发送。
- 成功运行 `41143313517`（2026-10-30 23:15 UTC）输出空结果，说明本轮没有到期槽位。
- 失败运行 `41186421750`（2026-10-31 08:53 UTC）在 `Generate Lucía message` 步骤因 `character_identities` 查询失败退出，job 结论为 `failure`；工作流没有把失败吞掉。
- 历史失败运行 `39692576920`（2026-10-21）因 PostgreSQL statement timeout 退出，说明数据库级失败也能传播到 workflow 失败状态。
- 后续自然 schedule `41233450457`（2026-10-31 19:16 UTC）同样成功完成，`Generate Lucía message` 输出 `{"date":"2026-11-01","generated":0,"suppressed":0,"failed":0,"results":[]}`；本轮无到期槽位、无 provider 生成，未产生新的消息或 MiniMax 费用。

所有成功/失败运行的 job 都在 10 分钟限制内结束；最近一次运行的 `Generate Lucía message` 步骤约 12 秒。运行日志只保留了日期、计数、状态、原因和 message id，没有复制正文、令牌或连接串。

### 生产配置与当前工作树的边界

远端 `main` 的 workflow 使用 `actions/checkout` 固定 SHA `5b83aaab31a6fec983f817ac87857630476c2b6a`。核对时 `1f825c9` 是 proactive workflow 契约测试提交；真正的 proactive candidate 行锁/generation 修复提交为 `97627ab`（当前共享工作树 HEAD 为 `96d656c`，包含该提交在历史中），且 `97627ab` 不是 `origin/main=96afe34` 的祖先。因此上述运行证明的是该生产 pin 的调度、资格门禁和失败传播，不证明当前工作树中的 generation 校验已经部署。

远端 workflow 的结构仍核实为：每 15 分钟 schedule、支持 `workflow_dispatch`、`cancel-in-progress: false`、10 分钟 timeout、显式 `DATABASE_URL`/`LUCIA_PROACTIVE_USER_IDS`，且 job/step 均 `continue-on-error: false`。本次未触发手工 dispatch，故没有取消、并发重叠和当前代码版本的真实重试证据。

### 结论

这完成了 CONV-EVAL-005 的“生产调度 runner 有真实历史运行”证据切片：slot 轮询、真实 provider 生成、weekly-limit 抑制、无到期槽位和失败退出均有远端记录。它不能关闭 005，因为仍缺当前代码版本部署后的 workflow 生命周期、取消/重试/去重的完整证据、Auth 用户最终删除，以及真实 R01/R05 provider 跨路线语义和真实登录态。下一步应先把 `97627ab` 所在的关系/proactive 修复合并到明确的生产 pin，再在不重复收费的前提下观察至少一轮成功、抑制和失败恢复运行；在此之前不要宣称 005 或整体可用。
