# CORPUS-REDESIGN-001：语料页评估与重做交付

- 日期：2026-10-15
- 状态：review，等待所有者使用验收
- 分支：`codex/disable-legacy-readlang`（沿用共享工作树）
- Commit：无；未提交、推送或部署，保留其他任务的已有改动。

## 评估结论

保留语料页，但将职责改为**真实用例查询与对照**。词汇页解释词义，短语页提供审核后的实用说法；语料页帮助确认“我看的真实资料中，这个词怎么搭配、前后说了什么、换一个来源又怎么用”。

旧页默认机械截取2–3词，搜索又依赖不完整的出现索引，正文有表达仍可能搜不到。继续增加旧片段不能解决问题。新页直接检索可见原文，并修复文章来源版本和媒体定位，使来源入口有实际用途。设计决定见 [ADR-0017](../adr/0017-corpus-example-workspace.md)。

## 已实现

- 暖色、灰绿的编辑式列表，桌面有简短使用指引，手机采用单列。查询、文章/视频/播客筛选、原词序/同段全部词、已有译文开关、高亮、分页与浏览器历史恢复。
- API直接查询已发布、清权的文章和已审核字幕；保留旧search/browse协议兼容。文章最新已发布版本、媒体currentVersion，私人生成文章仅本人可见。前后文执行同一可见性条件，计数和数据来自同一SQL快照，不预先截取固定数量再搜索。
- 无译文的长文章段按西语句界显示完整命中句；多个命中保留中间句，默认浏览显示开头两句。展开保留完整原段及相邻段。单句、无法分句或已有段落译文时保留全文；不机械按字数截断、不拼接虚构例句。
- 原句可朗读/停止；只朗读实际显示的西语，明确为浏览器合成声音。最多三条临时对照，朗读和对照采用相同句子；刷新清除，不写入收藏、评分或能力证据。
- 来源文章URL包含版本与段落锚点；媒体传递真实时间/稳定segment index，播放器就绪后定位。显式定位优先旧进度，兼容t=0与稀疏字幕index。
- 查询20秒截止，取消、卸载、旧请求/语音回调隔离、失败重试、无效响应、无结果与越界页恢复均有覆盖。没有新增迁移、供应商或录音存储。

## 修改文件

新增主体：

- `src/modules/lexicon-corpus/{schemas/corpus-examples.ts,repositories/corpus-examples-repository.ts,application/list-corpus-examples.ts}`
- `src/modules/lexicon-corpus/{domain/corpus-highlight.ts,domain/corpus-excerpt.ts,ui/corpus-workbench.tsx}`
- `app/api/v1/corpus/examples/route.ts`
- `app/(product)/read/corpus/corpus-workbench.css`
- `contracts/schemas/v1/corpus-examples-{query,response}.schema.json`

修改入口与来源定位：

- `app/(product)/read/corpus/{page.tsx,corpus-shelf-skeleton.tsx}`
- `src/modules/lexicon-corpus/domain/content-reference.ts`
- `app/(product)/read/article/[articleId]/article-reader.tsx`
- `app/(product)/learn/media/[stableKey]/page.tsx`
- `src/modules/media/ui/media-learning-workbench.tsx`
- `contracts/openapi/v1/openapi.json`（新增GET path）

测试：

- 新增 `tests/unit/{corpus-workbench.test.tsx,corpus-highlight.test.ts,corpus-excerpt.test.ts,corpus-examples-route.test.ts,media-source-position.test.tsx}`
- 新增 `tests/database/corpus-examples.test.ts`、`tests/contracts/corpus-examples-contract.test.ts`
- 新增 `tests/e2e/{corpus-workbench.spec.ts,fixtures/corpus-examples.ts}`
- 更新 `tests/unit/{article-reader.test.tsx,lexicon-pages.test.tsx}`、`tests/e2e/{lexicon-library.spec.ts,video-learning.spec.ts}`

同步ADR-0017、实施计划13.7、架构、内容制作、测试策略、旧阅读规格取代说明及状态页。本报告只列本任务范围，不把共享树其他任务改动计入交付。

## 验证结果

本机未提供`pnpm`可执行命令，使用已安装依赖的Node入口执行等价检查。

| 检查 | 结果 |
| --- | --- |
| 聚焦Vitest（领域、UI、Route、合同、SQL与来源定位兼容） | **15 files / 134 tests通过，exit0** |
| PGlite真实查询SQL | 上述包含**12项**；最小表来自真实schema，仅适配execute返回封装，不mock SQL |
| 受影响TS/TSX ESLint | 通过，0警告 |
| 全局TypeScript | `tsc --noEmit`通过，exit0 |
| 隔离生产构建 | **76/76页面**通过，含TypeScript，exit0 |
| Playwright桌面/手机 | **18/18通过，exit0**；含长段命中句/朗读/对照/完整原段、来源定位、320–1440px、浅深主题及44px主要操作 |
| 真实库只读查询 | 默认**49,247**条；por eso **192**，tener que **39**，a veces **133**，quedar **70**；返回覆盖三类型、多来源 |
| 真实库浏览器集成 | 无语料API拦截；返回12条，por eso **192**，无横向溢出、API写入或pageerror |

真实浏览器中，首条文章原段745字符，列表保留92字符完整命中句，展开与原始全文逐字一致。已人工检查真实数据桌面和手机截图，输出位于`test-results/corpus-redesign/`。真实查询首次冷连接曾约6.9秒，后续样本约1.1–2.0秒；不把此样本当作性能承诺。

测试过程发现新增长段测试的模糊文本定位同时匹配说明和展开控件，改为精确定位后18/18通过，未放宽功能断言。一次与Next开发类型生成并行的全局tsc读到临时不完整routes类型；等待生成结束后重新执行通过，未排除文件或放宽检查。旧媒体fake路径仍有既有`Uncaught Error: 0`日志，同类旧记录也存在；新语料页真实数据浏览器记录无pageerror。

## 未执行与限制

- 未跑全仓lint、全量Vitest和全部E2E：共享树有大量其他任务改动，已有worker OOM及迁移基线问题；本次采用受影响范围检查，不把既有失败算作通过。
- PGlite最小表和真实库只读查询不能替代全量迁移/RLS数据库角色验证。真实浏览器使用隔离E2E身份读取公开内容，不声称实际用户登录路径通过。
- 未验证iPhone Safari/PWA真机、实际扬声器音色和真实YouTube播放；TTS和媒体定位自动测试使用fake接口。
- 检索匹配实际词形，不自动覆盖全部变位、词元、中文语义或全网内容；无现成译文则不显示，不即时生成翻译。
- 字幕沿用来源分段，可能跨句或含不完整语法句；展开前后文与回原播放器用于保留真实语境。长段只有一个句子时保留全文，不人为切断。
- 对照仅当前页面内存保存，刷新清除。当前SQL扫描在更大语料规模下需重新测量后决定全文索引。

## 用户验证与下一步

刷新本地`/read/corpus`，搜索`por eso`，应看到文章、播客和视频中的真实用例。展开第一条前后文，加入两条对照，朗读其中一句，再用“读原文”或“到原处听”验证准确定位；切换内容类型、翻页并前进/后退应保留查询。

下一步建议以实际设备使用反馈检查音色、查询速度和来源内容质量，再决定小范围优化；本任务不扩张到其他页面或新训练系统。
