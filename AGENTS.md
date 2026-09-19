# AGENTS.md

本文件是本仓库及其 worktree 的 AI 指令入口。目标是保护学习评分、用户隐私、角色一致性和个人 Alpha 范围。项目约定不能覆盖系统、平台或更高优先级指令；子目录若有适用指令，进入该目录前一并检查。

## 开始任务

1. 首次承担实现任务或需要运行入口时阅读 [README](README.md)；简单问答、错字修正不要求重复加载项目背景。
2. 修改前核对 `git status --short --branch`。领取任务、合并或跨分支核对时，再读 [PROJECT_STATUS](PROJECT_STATUS.md) 并核对 `git log -5 --oneline --decorate` 和 `git worktree list`。其他分支完成不等于当前分支或部署环境可用。
3. [项目执行约束](docs/agent-rules.md) 保留全部有效边界；按受影响领域读取相关章节，不要求每次首次会话全读。下方不变量始终适用。
4. 按 [文档导航](docs/README.md) 选择规格、ADR、实施计划的当前任务章节及领域文档。不要每个任务都加载全部历史设计；没有代码路径时先查契约和设计，不猜接口。
5. 实现任务明确唯一任务 ID、范围和验收；简单问答不要求登记。自主领取仅限 ready 且没有其他负责人的任务；用户直接指定的任务在核对并发负责人无冲突后即可执行，不必等待 ready 登记，不擅自重排全局队列。范围外决策仅阻塞依赖它的部分，继续完成范围内不受影响的工作。

## 必须记住

以下仅为完整约束的摘要，不替代正文：

- 学习页打开即视频/播客内容；无 Hero、开始/继续学习 CTA 或强制模式选择。词句、语料与文字考察归阅读，手机账户入口在底部“我的”。
- 文字不能形成语音证据；跟读不能证明自主交流；技术失败/低置信度不扣能力；时长不评分；mastery 与 confidence 分离。
- 完整表达前不纠错；无 done 不算成功；旧 generation 不更新当前状态。评分、权限、角色真实性与记忆隔离由服务端校验。
- 白名单采集只到候选；独立语言/教学审核、结构校验和显式发布不可跳过。审核身份如实标记 AI；非盈利不豁免许可与平台限制。
- 视频下载统一使用 yt-dlp，按[媒体运行手册](docs/operations/media-content-workflow.md)配置官方依赖；浏览器用于播放验收，不替代下载。不可绕过访问控制或 DRM。
- 默认测试用 fake；不因文档验证访问生产、调用收费 Provider、采集、发布或清理数据。
- 只改当前授权范围；不覆盖用户改动、不提交密钥、不用强制重置。真实设备、真实播放、部署状态与 fixture 测试分别报告。

## 结束任务

按 [执行约束第 14 节](docs/agent-rules.md#14-任务完成定义) 和 [文档维护检查](docs/README.md#维护约定) 核对。交接包含任务、修改文件、Commit（未提交则如实说明）、测试结果、未执行检查及原因、用户验证方式、限制和下一步。分支负责人同步分支状态，合并者负责 main 对账，不能互相替代。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
