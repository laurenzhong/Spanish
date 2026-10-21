# TTS-LATENCY-001：弱网下的重复朗读与长文首段

- 状态：review，实现与本切片验收完成；2026-10-16。本会话，沿用共享分支 `codex/disable-legacy-readlang`。
- 授权：所有者反馈点击起声延迟，并说明当前网络较差；依赖TTS-READALOUD-001。Commit无，未提交/推送/部署，保留共享树全部其他任务改动。

## 改动与原因

现有客户端每次重播都重新POST，服务端即使已缓存也要等待网络/鉴权/下载；长文首段可能接近1000字符，必须完整合成和下载才播放。保留固定MiniMax女声、32kHz/128kbps音质、鉴权API、串行按需和取消规则，进行两个局部优化：

1. 同一控制器内，成功完整播放的最多8段/4MiB字节保留60秒，LRU淘汰；重播免HTTP，速率本地调整。不共享到其他控制器，不写存储/公开缓存。stop/组件卸载、页面隐藏/pagehide、账户退出、Supabase后续会话事件清空并取消；到期和空闲时释放订阅、监听器及定时器。失败/取消/旧会话迟到响应不缓存。
2. 文本超过300 UTF-16字符时，先生成最多180字符首段，再使用最多1000字符段。优先句界/词边界，全文及代理对保留。不预取未播放段，不添加自动重试。

## 修改文件

- `src/modules/providers/tts/read-aloud.ts`：首段、缓存接入与共享生命周期。
- `src/modules/providers/tts/read-aloud-replay-cache.ts`：控制器内存、边界与会话/页面失效。
- `tests/unit/read-aloud.test.ts`、`tests/unit/read-aloud-replay-cache.test.ts`：缓存、隐私、竞态、过期/容量和首段回归。
- `tests/e2e/article-read-aloud.spec.ts`：实际按钮模拟弱网重播、退出清理、长文首段。
- `docs/adr/0019-unified-minimax-read-aloud.md`、`docs/architecture.md`、`docs/testing-strategy.md`、2026-09-12实施计划、本交接与`PROJECT_STATUS.md`。

## 验证

- 新重播和短首段断言先在旧实现失败；实现后串行测试使用不同句子，继续断言每段完整、上一段ended才请求下一段，另独立验证相同文本复用。
- 最终Vitest **8 files / 73 tests**通过，包含客户端、hook、缓存、静态标准、application、MiniMax适配器、鉴权route和TTS契约。fake供应商，零真实收费请求。
- 最终定向ESLint（0警告）和全仓`tsc --noEmit`通过。
- 最终Playwright **16/16**通过（桌面Chrome与Pixel7仿真），文章选词/全文、恢复/停止/旧回调以及词汇、场景、私人聊天共用入口。首次PowerShell包装器因stderr返回非零但16项测试通过；最终改用cmd内重定向直接运行Node，确认exit0，未放宽断言。
- 模拟每次音频请求额外800ms：最终桌面点击→blob play调用 **833.4ms→5.3ms**，手机仿真 **819.1ms→5.9ms**。重播请求数仍为1，退出后增为2。此处播放事件为fake、未测真实解码/扬声器；数字只证明移除了模拟请求等待，不能作为真实网络加速比例或首次供应商延迟。
- 隔离 `.next/prod-check` 生产构建通过（含TypeScript，**77/77**页面，单worker，exit0）；限定diff check通过。用户3000服务保留，Playwright3101验证进程已释放；未添加新tsconfig路径。
- 日志：`.tmp-tts-latency-{core-final,e2e-final,typecheck-final,lint-final,build}.out`；浏览器计时也附在Playwright产物。

## 验收、限制与下一步

刷新现有页面，朗读单词/短句至结束，一分钟内同处再次点击，第二次应更快；换页面/隐藏、停止、退出或过期后会重新请求。文章全文应较早开始短首段，仍读完整篇。女声和音质保持一致。

首次单词/短句仍依赖网络、鉴权与MiniMax生成；本轮没有测量所有者真实网络或调用真实provider。长文可能增加一个请求，后续段间仍有等待；取消中的未完整播放音频不会缓存。本轮未重跑全仓lint/全量Vitest/全套E2E：共享树含大量其他任务变更，上轮已记录全量OOM及其他失败，采用本切片聚焦回归、全仓类型与生产构建；不将其他失败一概认定既有基线。不涉及数据库/迁移/学习证据，未验真实RLS、Supabase跨标签页真登录或iPhone Safari/PWA真机听感。

建议下一任务：本人在网络恢复后复核首次与重播听感；若首次仍明显慢，再单独测鉴权/供应商分段耗时，评估流式首声路径。本任务未改API协议或引入预生成费用。
