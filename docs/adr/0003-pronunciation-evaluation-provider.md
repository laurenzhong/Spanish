# ADR-0003：个人 Alpha 发音评测供应商选择

- 日期：2026-08-21
- 状态：Proposed

## 背景

ALPHA-012 已经可以把可信的语音尝试转换为追加式证据并重算技能快照，但当前训练页面仍使用 `FakeTrainingLoop`、模拟转写和 fake evaluator。第一次产品体验复盘确认了以下事实：

- `/learn` 的“继续学习”主路径清晰，训练页面在桌面和移动窄视口均可完成现有微循环。
- 文字自然替代表达、刷新恢复和移动端无横向溢出已有 E2E 覆盖。
- 录音路径仍显示“提交模拟语音”，转写结果由当前表达的文本模拟，真实 STT provider 和证据 application 尚未接入页面。
- OpenAI STT provider 只提供转写；其置信度保持 `null`，不能据此产生发音、语流或负面能力证据。

下一步需要选择一个真正面向语言学习的发音评测能力。选择不能只看转写准确率，还必须覆盖西班牙语、音素或发音清晰度、流利度、重音与语调、可解释反馈、短音频 API、Web 与 Flutter 的服务端接入，以及录音隐私和 Alpha 成本。

## 决定

1. **推荐 Speechace 作为个人 Alpha 的首个发音与流利度评测试点。** 先申请试用并用固定西班牙语回放集校准，不在本 ADR 中直接接入真实 API。
2. 保留 OpenAI `gpt-transcribe` 作为已有的通用文件转写 provider。发音评测 provider 与 STT provider 分离，不能用转写文本或 LLM 判断冒充发音证据。
3. 后续实现新增内部 `PronunciationProvider` 接口。接口只接受当前尝试的短期音频、`es-ES`/`es-MX` locale、可选参考文本和 `attemptId`/`generationId`，返回内部统一的发音、流利度和供应商元数据；不直接写入 `evidence_events`、画像或训练状态。
4. 发音 provider 只用于抽样的自主口语尝试和明确的口语复核，不用于打字、普通聊天或每一轮默认调用。语境成功仍由独立 evaluator 决定，供应商分数只能作为受限的发音/流利度观察。
5. 低置信度、静音、音频格式失败、供应商超时、取消或结果无法校验时，当前尝试显示“口语待验证”或可恢复错误，不产生负面能力证据。打字路径不调用发音 provider，也不更新发音、语流和真实口头反应技能。
6. 录音保持 `ephemeral`。服务端只记录内部 ID、供应商、模型或版本、locale、延迟、结果分类、请求 ID 和估算成本；普通录音评测完成后删除，禁止记录原始音频、完整转写和长期签名 URL。

## 候选比较

| 候选 | 西班牙语与指标 | 与本产品的匹配 | 主要代价或风险 |
|---|---|---|---|
| **Speechace** | 官方文档列出 `es-ES`、`es-MX`；支持音素级发音反馈、流利度、语速、停顿、重音和语调，并有自发口语的语法、词汇、连贯性和相关性评测 | 最接近语言学习和口语迁移目标；可把发音/流利度作为独立观察，适合服务端 REST 适配 | 需要试用和合同层面的数据保留确认；官方方案按月收费，Premium 页面显示 $125/月、10,000 个 15 秒请求，价格需在开通时重新确认；供应商指标仍需用西语人工样本校准 |
| **Azure Speech Pronunciation Assessment** | 支持 `es-ES`、`es-MX`；可返回音素、词和全文准确度、流利度及完整度 | SDK、区域和企业运维成熟，适合作为工程备选；可支持 scripted/unscripted 配置 | 官方文档明确 prosody assessment（重音、语调、速度、节奏）当前只对 `en-US` 可用；对本产品的西班牙语流利自然度覆盖不完整，且需要验证 SDK/REST 的服务端实现成本 |
| **OpenAI STT + LLM 自行评估** | 当前只稳定提供转写；没有可直接信任的音素、发音清晰度或语流信号 | 能复用现有 provider 和 evaluator，适合语境成功、文本组织和自然替代表达 | 不能作为发音证据；LLM 不能从转写可靠推断音素、重音或停顿，且重复调用会增加延迟和费用 |

## 选择理由

Speechace 的公开 API 文档明确面向语言学习场景，并同时覆盖 scripted pronunciation、read-aloud fluency 和 spontaneous speech。它对西班牙语提供与本产品目标直接相关的发音和流利度能力，尤其是 lexical stress、intonation、pausing、speaking rate 等反馈维度。Azure 的西班牙语基础发音能力较强，但 prosody 的语言限制使它更适合做备选或 scripted 发音基线，而不是当前 Alpha 的首选。

Speechace 的推荐不是对供应商分数的信任背书。启用前必须用本产品自己的回放集检查：自然替代不因参考句差异被误判、低置信度不扣分、西班牙母语者对发音清晰度和流利度的人工排序与供应商结果方向一致，以及噪声、口音、截断和静音都能安全降级。

## 实施边界

后续实现任务应按以下顺序拆分，保持每个任务一个可验证切片：

1. 定义 `PronunciationProvider`、稳定错误码和内部 DTO；添加 fake、取消、超时、无效响应和契约测试，不调用真实供应商。
2. 接入 Speechace 试用 API 的服务端适配器，先只保留 `es-ES` 短音频和最小所需指标；供应商响应必须经过 Zod 校验和内部类型转换。
3. 建立西班牙语固定回放集与人工标注，比较 Speechace、Azure 备选和无 provider 的降级结果；在质量门槛通过前不更新 mastery。
4. 将 provider 接入训练 application，而不是直接接入 React 组件；每次调用携带 `attemptId`、`generationId`、取消信号和幂等键，旧 generation 不能更新当前状态。
5. 通过体验和隐私复核后，再把抽样发音观察映射到口语专属技能。供应商发音分数不能替代语境成功、`mastery`/`confidence` 分离或服务端最终校验。

## 下一步验收条件

- `es-ES` 短音频可以返回内部统一的发音和流利度结果；`es-MX` 作为后续 locale，不在首个切片扩大范围。
- 供应商失败、取消、超时、空音频、低质量结果和过期 generation 均有自动测试。
- 打字、低置信度转写和技术失败不会写入负面口语证据。
- 供应商原始响应、原始录音和完整转写正文不会进入 evidence 引用或普通日志。
- 默认测试只使用 fake；真实 API 试用调用单独触发，不进入 CI。
- 试点回放集包含清晰语音、自然替代、明显发音问题、停顿、噪声、静音、截断和不同西班牙语 locale 样本，并有人工解释。

## 未决事项

- Speechace 试用账号、API key 申请、区域、数据处理条款和实际保留期尚未确认。
- 官方价格页显示的是当前公开方案，部署前必须重新核对月费、请求定义、超额计费和是否允许个人 Alpha 使用。
- 供应商的“发音/流利度”指标需要先映射到本产品八维技能的有限观察，不可直接当作能力总分。
- 当前 Windows 环境仍不能验证 Flutter iOS 真机录音、音频会话和生命周期；服务端 provider 适配可先用 Web/公共 Flutter fake 验证。

## 参考资料

- [Speechace API Use-Cases](https://api-docs.speechace.com/introduction/use-cases)
- [Speechace API Plans](https://www.speechace.com/api-plans/)
- [Azure Speech pronunciation assessment](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- [Azure Speech language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment)
- [ADR-0002：首个 STT 供应商采用 OpenAI 文件转写](0002-openai-stt-provider.md)
