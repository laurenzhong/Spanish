# TTS-AUDITION-001：西语朗读同文本试听

- 日期：2026-10-15
- 状态：本地试听交付完成；等待所有者试听与选择，未接入网站生产朗读。
- 授权：所有者接受同文本比较方案，后续明确先做 Kokoro 和 MiniMax；Azure 暂不纳入。
- 分支：沿用当前共享 `codex/disable-legacy-readlang`，不认领其他任务，不调整全局队列。
- Commit：无，未提交、推送或部署；保留其他会话全部在途改动。

## 交付

20 个原创西语测试单词、10 个原创短句，每个文本生成四种音色，共 120 段 AI 合成音频。文本为未发布的评估草稿，不是正式教学审核或能力证据。

| 方案 | 模型与音色 | 成功样本 | 本次生成耗时中位数 |
| --- | --- | --- | --- |
| Kokoro 本地 CPU | v1.0 INT8 / ef_dora | 30 | 2908ms |
| Kokoro 本地 CPU | v1.0 INT8 / em_alex | 30 | 3056ms |
| MiniMax 云端 | speech-2.8-turbo / Spanish_SereneWoman | 30 | 616ms |
| MiniMax 云端 | speech-2.8-turbo / Spanish_WiseScholar | 30 | 890ms |

耗时是这台机器上的少量运行数据。Kokoro 不含模型加载，MiniMax 包含网络等待；全部使用各自合成参数 speed=1，但参数标尺不等价。不得把表格当作严格性能排名或音质排名。

离线产物：`D:/workspace/out/tts-audition-20261015/index.html`、`audio/`、`samples.json`、`manifest.json`、`README.md`、两份验证 JSON、两张截图；ZIP 为 `D:/workspace/out/tts-audition-20261015.zip`，5,021,111 bytes。均位于已有忽略目录 `out/`。试听页内嵌完整元数据，离线播放不需要 API 密钥或新合成请求。评分和笔记只保存在用户当前浏览器，可显式导出 JSON。

本地生成工具、已下载模型与隔离 Python venv 位于已有忽略目录 `.tmp-tts-audition-20261015/`。主要文件为 `catalog.mjs`、`generate-minimax.mjs`、`generate-kokoro.py`、`download-models.py`、`build-page.py`、`serve.py`、`verify-audio.py`、`verify-page.mjs` 和 `package-artifact.py`；未向全局 Python 或项目依赖加入库。venv 使用系统已有 NumPy/ONNX Runtime，其余依赖安装在 venv，未修改产品 package.json/lockfile。

本次仓库文档改动仅涉及 `PROJECT_STATUS.md`、实施计划顶部的独立评估条目及本报告。未修改产品代码、API 契约、数据库、线上供应商配置或用户数据。

## 验证与结果

- `build-page.py`：120/120 样本可用，四音色各 30 段。
- `verify-audio.py`：120/120 SHA256 与解码通过，均非静音，合计约 179.62 秒，满幅裁切比例为 0。
- `verify-page.mjs`：真实 Chrome 读取全部 120 段时长，四种音色实际播放进度增长；切换音色/文本和停止取消播放，旧播放不覆盖新状态；故障可重试；评分/笔记保存恢复及导出正确；键盘操作正确；320/375/768/1440px 无横向溢出，按钮高度至少 44px；预览服务禁止读取运行环境与非公开文件。pageerror 为 0。
- `preview-375.png`、`preview-1440.png`：已人工查看布局截图。
- `node --check` 和 Python `py_compile`：试听脚本语法检查通过。
- MiniMax 生成器在全部完成后再次执行，新增尝试字符数为 0，复用已验证成功文件，无新收费请求。

全量 `pnpm lint`、`pnpm typecheck`、`pnpm test --run`、产品 `pnpm test:e2e`、`pnpm build` 未执行：本次不改产品实现，仅独立本地评估工具、产物及文档；本报告中的真实 Chrome 检查不冒称产品 E2E 或发布门禁。

## 来源、费用与恢复

Kokoro 使用官方链接所指向的公开 ONNX release，并对照 GitHub release API 的 SHA256：

- `kokoro-v1.0.int8.onnx`：`ae315a79b623f244700e4afb9246c46a26066782e049ba174bf3ba433970ee9c`
- `voices-v1.0.bin`：`bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d`

`kokoro-onnx==0.4.9` 对本模型的 `input_ids` 导出错误传入 int32 的 speed，模型声明实际需要 float32。隔离脚本中的 session 包装仅转换该输入 dtype，未修改下载模型、已安装包或产品适配器。初次失败历史保留在本地运行结果中，最终 manifest 取每个文本/音色的最新成功项。INT8 结果不代表 FP32 的质量上限。

MiniMax 从官方 `get_voice` 系统音色列表筛选两种 Spanish 音色，依照官方同步合成接口生成。成功结果保存模型、音色、采样率、生成耗时、音频哈希及请求标识；不保存密钥或原始接口响应。接口报告计费字符合计 **1182**；未查验实际账单单价，不推测金额。一次明确的 `1002` 限流拒绝后停止，降低请求速率再恢复；已有成功样本没有重新生成。

付费请求发送前先持久化进行中标记。取消、超时或不确定结果不自动重发；成功缓存按 SHA256 验证，文件遗失或损坏时拒绝自动再次收费。音频播放与试听页不请求合成服务。仅向 MiniMax 发送本测试集的原创非私密文本，没有发送聊天、用户录音、数据库内容或角色记忆。

代码/模型许可分别为 kokoro-onnx MIT、Kokoro 模型 Apache-2.0；完整部署仍需核对 espeak 等依赖许可。参考：[Kokoro 音色与短文本限制](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)、[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx)、[MiniMax 同步合成](https://platform.minimaxi.com/docs/api-reference/speech-t2a-http)。

## 用户验证与下一步

打开本地预览 `http://127.0.0.1:8766`，或解压 ZIP 后用浏览器打开 `index.html` 并保留 audio 子目录。先听 pero/perro、hablo/habló、casa/caza，再比较短句 2、7、9、10；评价准确性、目标口音匹配度和自然度，导出笔记。

尚未确认音色的实际地区口音，不能保证这些 Spanish 音色均为 es-ES。casa/caza 在合法的 seseo 口音中可能同音；口音匹配与发音正确性分开判断。自动化只证实音频可解码和播放，不代表人耳确认了文本完整性、重音、自然度或真人感。未做 iPhone Safari/PWA 真机验收。

下一项建议：所有者选定方案和音色后，另立 `TTS-READALOUD-001` 产品接入任务，明确公共/私有文本权限、缓存归属与删除、供应商与费用边界，再更新相应设计/ADR/契约并实现。当前浏览器 TTS 与已有真人例句播放保持现状。
