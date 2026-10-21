# YOUTUBE-EXACT-001：频道与精确视频ID元数据发现

2026-10-16 · review · 共享分支 `codex/disable-legacy-readlang` · Commit：无，未提交、推送或部署。

承接用户确认的MEDIA-RIGHTS-001下一建议。本任务实现指定视频的元数据发现，不启用真实来源，不写真实配置、候选或授权，不取得字幕和音视频，不调用翻译、ASR或发布。本批仍为2条待复核、10个未填补；没有新增学习内容。

## 完成行为与兼容

YouTube来源的`rightsPolicy.allowedVideoIds`为可选严格数组：1–2个11字符ID，区分大小写，不接受URL、空白、空数组或重复。存在时直接调用官方`videos.list`，不请求最新feed、不回退全频道；无此字段保留旧feed行为。直接构造适配器也验证数组，避免空配置静默扩大范围。

API返回的每个ID必须属于当前请求页，重复或额外ID拒绝整页，候选顺序按配置排列。指定视频仍必须满足已有频道、公开、嵌入、语言、地区、时长及许可门禁；空标题不生成候选。缺失条目不替换成其他视频，不能据此认定删除。API请求禁止重定向，保留响应大小限制和错误脱敏，避免含服务端密钥的URL被转发。

每次运行只处理一页。游标严格绑定mode、version、sourceStableKey、channelId、有序videoIds与offset；模式切换、顺序或配置改变、非法字段均在网络前拒绝，需通过合法所有者配置流程显式重置游标，不能手改生产数据库绕过迁移。limit=1时两条ID分两次运行；末页返回null，下轮重新检查同一批ID，因此暂缺元数据可以重新出现。

发现适配器及application在外部await后重验取消，忽略abort但晚到的结果不会进入候选/游标提交。原repository的原子候选/游标事务和source revision CAS保持不变，无新增数据库列、迁移或公共API。来源策略公共边界原为任意只读record，本任务只扩展内部严格解析。

## 修改文件

以下路径相对仓库根目录：

- `src/modules/content-acquisition/adapters/youtube/youtube-exact-discovery.ts`：ID和游标校验、分页。
- `src/modules/content-acquisition/adapters/youtube/youtube-policy.ts`：可选字段与工厂传递。
- `src/modules/content-acquisition/adapters/youtube/youtube-channel-adapter.ts`：直接官方查询、响应范围与频道检查、取消及feed兼容。
- `src/modules/content-acquisition/application/run-acquisition-source.ts`：取消后拒绝创建/发现/提交。
- `tests/contracts/youtube-exact-discovery-contract.test.ts`、`tests/unit/content-acquisition-run.test.ts`：新契约与取消回归。
- `docs/architecture.md`、`docs/content-authoring.md`、`docs/testing-strategy.md`、`docs/operations/content-acquisition-runbook.md`、内容供应实施计划、`PROJECT_STATUS.md`及本报告：行为、兼容、恢复、验证与交接。

共享文件只追加本任务改动，保留之前mediaProcessing、CEFR及其他会话工作。构建自动追加的两条youtube-exact-build tsconfig include已移除，其他include保留；未整体提交共享工作树。

## 验证

本shell的pnpm不在PATH，直接使用既有`C:/nvm4w/nodejs/node.exe`及本地工具，无依赖安装。默认验证全部使用fake或隔离PGlite，不读取真实API密钥或向生产数据写入。

| 检查 | 结果 |
| --- | --- |
| 实现前契约 | 初版24项中17失败、7通过，复现旧策略不支持精确配置及直接构造回退feed；后续补足边界。一处数组参数表传参错误已修正，不将测试错误当产品缺陷 |
| 实现前取消回归 | 2失败、4通过，确认预先取消及晚到结果仍可继续发现/提交 |
| 最终专项Vitest | **6文件、81项通过**：精确发现42、既有来源契约、候选策略、acquisition-run6、处理授权及daily pipeline |
| PGlite持久化 | **1文件、5项通过**：原子提交、重复重放、冲突与revision/CAS等既有边界；隔离内存库，不等于真实RLS验证 |
| 专项ESLint | **6个TS文件通过**，max-warnings=0 |
| 全树TypeScript | **通过**，`tsc --noEmit --incremental false`退出0 |
| 生产构建 | **通过**，编译、严格类型检查、77/77静态页面完成；Node wrapper确认子进程exit0。`CIRCLE_NODE_TOTAL=2`令Next使用1个页面worker，独立dist目录，无忽略类型错误或配置放宽 |
| 独立AI复核 | 无阻断项；另行执行精确发现与acquisition-run共2文件48项通过，不构成内容双维审核 |

最终专项命令：

```powershell
& 'C:\nvm4w\nodejs\node.exe' node_modules/vitest/vitest.mjs run tests/contracts/youtube-exact-discovery-contract.test.ts tests/contracts/youtube-source-adapter-contract.test.ts tests/unit/youtube-candidate-policy.test.ts tests/unit/content-acquisition-run.test.ts tests/contracts/media-processing-authorization-contract.test.ts tests/unit/daily-media-pipeline.test.ts --maxWorkers=1
& 'C:\nvm4w\nodejs\node.exe' node_modules/vitest/vitest.mjs run tests/database/content-acquisition-persistence.test.ts --maxWorkers=1
```

未重跑全仓lint、全量Vitest及整个E2E。本次限定适配器/application，没有UI变更；已有共享树全仓内存故障及全量失败记录，当前专项与构建通过不使此前失败变成通过，也没有隔离证明它们全是既有问题。前任务的视频/播客18项E2E不计入本任务验证。未运行真实Data API、收费provider、真实数据库/RLS、iPhone Safari/PWA或原音画面验证；未配置或启用真实来源，本轮无新增数据访问实现。

仓库外证据目录：`C:/Users/master/.codex/visualizations/2026/10/15/01a13f25-4c54-7281-b450-1ff23e5ded8d/`。`youtube-exact-001-baseline/`保存任务前共享文件副本和status；`youtube-exact-001-build.log`保存构建输出；`youtube-exact-001-validation.json`保存限定diff、UTF-8、文档链接、兼容保留检查和文件hash。

## 限制、用户验证与下一步

最后一次取消检查之后已开始的事务不能撤销；忽略signal且永不settle的外部调用不能被强制终止。历史媒体stableKey将ID转小写，本任务拒绝单份列表内仅大小写不同的组合，但不迁移跨来源已有key碰撞，实际导入前仍需核查身份。

来源默认CEFR仅是选材信号。VideoEle两条提案等级不同，可后续评估分别配置单ID来源并逐项审核；当前未配置。元数据限定不授予字幕取得、音频下载、云处理、翻译、ASR、索引、分发或发布权。现有estimatedCostMicros仍为0现金估算，真实官方请求仍消耗平台配额。

用户可重跑上述fake命令，核对最多两ID、分页、频道复验、缺失重试、游标篡改、取消和旧feed兼容，无需真实密钥。下一项建议单独核实实际来源配置、取得方式与逐项处理授权，再评估受限元数据canary；不自动启用、采集或发布。生产发布前仍需冻结共享树、归因全量失败并完成真实环境验收。
