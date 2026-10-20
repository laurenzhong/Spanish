# MEDIA-SERIES-002：首批真实系列归属清单

- 任务：MEDIA-SERIES-002；本节为公开元数据盘点与清单准备，不构成数据库导入、内容重新审核或发布记录。
- 盘点输入：协调者从真实已发布目录只读取得的 `.tmp-media-series-inventory.json`，共 **172 条：80 视频、92 播客**。本次没有联网查询、媒体下载、收费供应商调用或数据库写入。
- 输入快照 SHA-256：`ed7d92792697e6a2abed6bdb04ddb3cabcee75878ebbc7161341d1109878ea85`。该临时文件不作为提交产物，已选条目的稳定 ID、版本、内容哈希在附录保存供执行前后核对。
- 版本化清单：[alpha-series-v1.json](../../content/media-series/alpha-series-v1.json)，`schemaVersion=1`、`catalogueKey=alpha-series-v1`。
- 清单 SHA-256：`eb1aae1e0d0fc966d07297ca0ac3dceebb1381869e7d690546d0d50828729b5f`。任何成员或文字修订都会改变此值；apply 必须使用实际文件哈希。

## 1. 已确认归属的依据

首批采用保守的双重匹配：视频要求稳定频道 ID 与题名中的节目名称同时一致；播客要求已发布 source_name 与题名中的节目名称同时一致。只确认系列目录关系，不据此给予字幕、语言、教学或版权批准。这里的“确认”是对仓库当前公开目录元数据的一致性审核，并非新抓取平台原站或人工母语审核。

**聚合源限制：全部 92 条播客的 source_feed_url 实际都指向同一个 Language Reactor 混合目录 `https://www.languagereactor.com/c/es/pd/t_pd_mix_es`，不是各节目的独立 RSS。** 清单证据显式记录此事实。共享该 URL 不能证明节目归属，也不能作为未来 MEDIA-SERIES-005 的独立节目身份；后续应补来源适配器提供的真实节目 ID 或独立 feed 证据。

| 系列 | 类型 | 本站已收录条数 | 归属依据 |
| --- | --- | ---: | --- |
| Peppa Pig en Español Latino | 视频 | 25 | 稳定频道 UCrreHSUa5rnuCVDeO8dX4eA；25 条题名均明确 Peppa/Pepa。包括 clip、合辑与 Los Cuentos 子标题，使用 Peppa 节目总系列，不声称是同一季或 25 个独立原播集。 |
| 31 minutos | 视频 | 3 | 稳定频道 UCrVhY_d0L0qayRhMsRlPBOA；题名均以 31 minutos 开头。当前仅三条歌曲视频，不声称完整节目集数。 |
| Caso Cerrado | 视频 | 2 | 稳定频道 UCGbofRROopWrumVob5w61OA；题名均明确 Caso Cerrado 与 Telemundo。 |
| A hombros de gigantes | 播客 | 2 | source_name 与题名前缀一致；排除题名明确 Más cerca 的冲突项。 |
| Acontece que no es poco con Nieves Concostrina | 播客 | 9 | source_name 与 Acontece que no es poco 题名前缀一致；另一个无节目前缀条目暂缓。 |
| Cheleando con Mextalki | 播客 | 1 | source_name 与题名 PODCAST cheleando con Mextalki 一致，原题名明确 #186。单条也可构成已确认节目归属，但暂时没有其他集推荐。 |
| CNN 5 Cosas | 播客 | 16 | source_name 与题名 CNN 5 cosas / CNN en Español: 5 Cosas 一致；一条泛称 Cinco noticias 的题名暂缓。 |
| Fallo de sistema | 播客 | 2 | source_name、题名前缀及原题名 885 / 886 一致。 |
| News in Slow Spanish Latino (Intermediate) | 播客 | 3 | source_name 与题名 News In Slow Spanish Latino 一致，原题名明确 #691、#692、#693。 |

共 **9 个系列、63 个稳定媒体 ID：30 视频＋33 播客**。清单逐成员保存现有来源链接、来源名称和完整原题名，未通过字符串相似度把其他条目吸入系列。计数表示本站已收录条数，不表示节目总集数。

## 2. 排序、集号与审计边界

全部系列使用 `orderMode=episodic`，依当前可见内容的发布时间倒序；所有 `position`、`seasonNumber` 为 null。上传时间及清单文件成员顺序不构成官方集序，也不人为补季号。

只有原题名明确存在的集号进入 episodeNumber/episodeLabel：Cheleando #186、Fallo de sistema 885/886、News in Slow Spanish Latino #691/#692/#693。日期不是集号；Peppa 的 clip/合辑不被编造为连续剧集。

首次创建的 expectedRevision 全部为 0，幂等键为 `alpha-series-v1:<seriesKey>`；不移走其他系列成员（fromSeriesRevisions 为空），不删除已有成员（removeStableKeys 为空）。若执行时已存在同名系列、归属或 revision 冲突，应停止并审阅，不能静默覆盖。目录归属不修改任何媒体版本、字幕、原审核身份、用户进度或学习证据。新增 summary 仅简短描述节目与条目种类，没有新增教学建议或 AI 能力评判。

## 3. 暂未归属及原因

**109 条保留原独立内容入口：50 视频、59 播客。** 未归属不是下架或质量判断；现有 source_name 分组不能自动替代系列确认。

| 视频来源 | 条数 | 暂缓原因 |
| --- | ---: | --- |
| Alex Tienda | 1 | 题名存在 Viaje a Corea del Norte / Ep. 1 的子系列线索；只有一个条目，暂未核对该子系列范围。 |
| elrubiusOMG | 3 | 混合个人频道；不把整个频道当系列。 |
| enchufetv | 14 | 混合短片和不同项目；Mortal Glitch / Ep 1 等只作为子系列线索，不将频道其他短片整体合并。 |
| HolaSoyGerman. | 12 | 创作者频道包含不同栏目；Preguntas de Twitter 5/6 可作为后续专题核对线索，不自动吸入其余视频。 |
| Ibai | 1 | 单条视频没有本批可相互佐证的系列身份。 |
| JuegaGerman | 9 | 游戏、评论等混合内容，缺少本批可确认的统一节目。 |
| La Hiperactina | 1 | 来源为创作者频道，单条没有本批统一系列证据。 |
| Luisito Comunica | 8 | 旅行与体验混合频道；街头美食相似题材不自动构成同一官方系列。 |
| TikTak Draw | 1 | Draw My Life 为题名线索，暂未核对节目范围。 |

| 播客来源 | 暂缓条数 | 暂缓原因 |
| --- | ---: | --- |
| A hombros de gigantes | 1 | 标题明确为另一个节目 Más cerca，与 source_name 冲突。 |
| Acontece que no es poco con Nieves Concostrina | 1 | 原题名无节目前缀，只有当前来源名称和聚合目录，待补节目证据。 |
| Charlas Hispanas | 11 | 题名只含集号或主题；聚合目录不是独立 feed。节目名元数据是线索，本轮尚未独立佐证。 |
| Chill Spanish Listening Practice | 2 | 题名仅集号和词语主题，待独立节目元数据。 |
| CNN 5 Cosas | 1 | 题名为 CNN en Español: Cinco noticias，先保留待核对，未因语义近似自动合并。 |
| El Dollop | 3 | 题名仅故事/分部/集号，待独立节目元数据。 |
| Hoy Hablamos | 12 | 泛主题题名，且 GRAM 与普通集使用不同编号轨道；待核对节目及子栏目关系。 |
| LearnCraft Spanish | 18 | 题名仅课程编号和主题，待独立节目元数据；不据上传顺序或连续课程号反推身份。 |
| Medical Spanish Podcast | 1 | 题名为医学主题，单靠聚合源及名称暂不确认。 |
| News in Slow Spanish Latino (Intermediate) | 1 | 题名 Noticias en español Latino #695 不含明确节目名，待补证据。 |
| No Hay Tos (Real Mexican Spanish) | 4 | 题名仅主题，待独立节目元数据。 |
| Relatos de la Noche | 3 | 恐怖故事主题不能替代节目身份，待独立节目元数据。 |
| Unlimited Spanish podcast with Oscar | 1 | 题名仅编号与发音主题，待独立节目元数据。 |

需要定点复核的四条：

- `podcast.language-reactor.it_7be5d9ab33bc`：Más cerca - Canibalismo en el Neolítico peninsular - 16/09/2026；不加入 A hombros de gigantes。
- `podcast.language-reactor.it_6356c930ab14`：Septiembre de 1936: La desmemoria extremeña。
- `podcast.language-reactor.it_678bc91d5d62`：CNN en Español: Cinco noticias del 17 de septiembre。
- `podcast.language-reactor.it_ec8ec3941d4c`：Noticias en español Latino #695: actualidad, gramática y cultura。

## 4. 清单本地验证

- 全部 9 个 SaveMediaSeriesCommand 通过当前 Zod schema。
- 63 个成员均存在于真实盘点快照、类型匹配且全局唯一；逐条来源 URL、source_name、题名与快照一致。
- 至少一个真实视频系列和真实播客节目；Peppa 25 条、无伪造季集序、全部创建 revision=0。
- 以上是清单与公开元数据的一致性验证，不是数据库迁移、RLS、导入事务、播放器或 Safari 验收。执行证据由协调者后续补充。

### 2026-10-16 协调者执行与集成验证

已按明确配置连接执行版本化0046迁移，执行前核对0045时间戳与SHA256一致、唯一待执行项为0046；没有重放历史reconcile迁移。三个目录表已存在且RLS开启。随后默认dry-run执行9条命令并整体回滚，使用上述文件SHA256显式apply成功；真实库为9系列、63归属、9追加审计，均revision1。

真实repository读回Peppa当前可见25条，首屏20条且hasMore=true，同系列推荐6条，均video且排除当前稳定键。真实查询发现postgres-js不能编码raw SQL Date参数，已改为ISO文本与显式timestamptz并补驱动参数回归；PGlite没有暴露此差异。

导入前后在只读快照比较整表逐行聚合指纹完全相同：media_items175、media_versions573、media_segments99,285、user_media_progress60、evidence_events6。确认本次只写目录与追加审计，没有重发内容或改写字幕/学习事实。

导入聚焦用例覆盖完整先验、错hash、默认dry-run零持久写入、后续条目冲突整批回滚、幂等重放与身份大小写；专项lint、全局typecheck通过。001全量lint内存失败与全量Vitest基线失败仍未消除，尚未完成全套E2E/build、真实用户浏览器与iPhone Safari验收；下一切片003接入导航。Commit：无，未提交/推送/部署。

用户可审阅清单及本报告，并在接入UI后以Peppa任意条目核验系列；现阶段只完成真实目录，播放页尚未呈现系列入口。

## 5. 已选媒体版本基线

下表来自只读盘点输入，供受控 apply 前后核对；不是新的媒体版本或审核记录。

| 稳定媒体 ID | 原版本 | 原内容 SHA-256 |
| --- | ---: | --- |
| podcast.language-reactor.it_017bd0dfe8fc | 3 | e7e81b68325133f684d4ce8d0909978526b9c11168aab09c06936a3b4b916625 |
| podcast.language-reactor.it_0bc4697d9627 | 3 | 986ca4b7bb2481e50a346176b205609c54ddc20b88aa6b68bafac11b709739f8 |
| podcast.language-reactor.it_0f4ad6d5a475 | 4 | 52e6ff4ac1a17302c5cc3a48ae20cfcd8fca1b9528ea8724110b5d9deeb47e62 |
| podcast.language-reactor.it_13becc04a3a3 | 3 | 1787a6494c5684de7627b5e2adb795a19effb13f247ed7b5bd1cdc181f01ec76 |
| podcast.language-reactor.it_180dd44fec02 | 4 | 58bf73bf9afe38a786c419c4144be05d891f3716e3ac5c811eea38fb4d449e84 |
| podcast.language-reactor.it_1cb2713f1c8e | 3 | 8a4a6025da9456f44fabb2bcf257611563d58151a055a21e3a2ec022063999d6 |
| podcast.language-reactor.it_1decf0b9f4d6 | 3 | 476824ef5e806e1b0e76140dc30fba4cc13f387f3193c2115e7a4968ff4b8676 |
| podcast.language-reactor.it_1e54ea384f81 | 3 | 17f772402b59ef83919738ec06281194858d3c799ae7de08ed4b672635c850d4 |
| podcast.language-reactor.it_2507e3a9deec | 4 | 9bf6570beeb323e41f5f70a235c454e893dcb203a9d000e10821c2ed09d3ec8e |
| podcast.language-reactor.it_2f13c5a713fb | 3 | dd79355d97739678f27ee41ffd89ddf37feba92b6df7dbea6e76402cf950c654 |
| podcast.language-reactor.it_3bff0cfe91cd | 2 | 41c329afcb1c52a932562ce923a3ee9861d656506b34b2b7a240b3c4dbd8e8a0 |
| podcast.language-reactor.it_3f48f786ba34 | 2 | dc32652dd869e17b2036570a5483ebed74a703ae00f9c6a0d3637499db6a9747 |
| podcast.language-reactor.it_476e9a104e5f | 2 | 4dd5dd6f2b4a7ea15a418262e6e31658676d86a31a19a7fa0aa40b3d77c74cee |
| podcast.language-reactor.it_4a2bbf6e88ce | 3 | 609e579984a4a00cff1b3fac160709bc00fcb2c4928cc9e81a516fa6d3c23924 |
| podcast.language-reactor.it_4a54ee69569b | 4 | 66579e3cfdc6ce998003a8df531e6455a93b525a5dff5758ec2b66bd57e2bb75 |
| podcast.language-reactor.it_7cfd728323bc | 4 | cf336ddffdff93fc7e1fb97223bd7c1332dcd642dff3bf521cd53b6ef6bfe012 |
| podcast.language-reactor.it_7e8b5c0dbf12 | 4 | cbf869f939bfad87b985495c317c9a0f101c000baa856770409849afc385bf44 |
| podcast.language-reactor.it_8f7182cc7eca | 3 | 0e9f3cee6ab54198d4291b7549bc45e241f3e3cf7392c6452adf2e1ef74479a3 |
| podcast.language-reactor.it_90ba7546eceb | 3 | c27c00e26de7016fc0c681b4bfe3f00e2d824a39fa5cc8f3434491d92b84cf1a |
| podcast.language-reactor.it_9137a8f1cd50 | 2 | eed569d64bbb16625e761bb66b5bd43535ac9b03d20b6f461aa658d5ec515936 |
| podcast.language-reactor.it_921b6e8fc4de | 3 | f1d10e4c8e6adf659bf1241ecf06f48508a7f0f4099566986cb014c1daf12a80 |
| podcast.language-reactor.it_a790fe7fb425 | 9 | 8b9cdb8f26e93703c790acf49033392a478aa69ae96191faa31aafc0dd5f549f |
| podcast.language-reactor.it_acf9a12f5c86 | 3 | 68772d3e9a58905cf6b8e5f2d1d72fc1432ab12bb5ba1ea86b96359c4cb124a3 |
| podcast.language-reactor.it_dfe9b6aef5fa | 3 | ca090d6d3d8d009f761d2af92450e6ab74b6ddc246f9548f161e3849db95c737 |
| podcast.language-reactor.it_e33ba0c155ed | 4 | 706935aa0d5e3736460c78f02b4c8e70db53d1f08e8a797359a617bf19c08c64 |
| podcast.language-reactor.it_e3457c2dec74 | 3 | fa4af57734608bfb6d7e4041fd461dde4c174b7530523532a3426d09895c3d98 |
| podcast.language-reactor.it_e4cf100bce5a | 2 | 0552550a7335efa0f485ecf01ed2c3ac510fc4f0bd9917031339b636b7eacc48 |
| podcast.language-reactor.it_e643a1683670 | 5 | f1a80f2a60247f4b89faaf4541a497b5a2eb7e4fa6438a8ce53c3263f5170a00 |
| podcast.language-reactor.it_e6e5117db1e4 | 4 | c61f96df30e4723cc7cbc0391fd8a49fcc7f01b16933d6b641e69ccf577ca3dd |
| podcast.language-reactor.it_ec8fd82f63ff | 3 | 0e502e45de7b748e1a566eade5381765a25ee9a497b78a07625b63a06a6708af |
| podcast.language-reactor.it_ede54fc47675 | 3 | 800c10423a195efe038fbc1375719f4bedb620649e72b4a75eb2750bed0901ba |
| podcast.language-reactor.it_f8b3b4c328e0 | 11 | 5e57a94bbc285a56dbc0d642f3df77796bb23e93cfd6bd87e0d5e745c965637d |
| podcast.language-reactor.it_fc6519ca9068 | 4 | bb84d787269427ba0294819f8b5ce0136787d9bb899b9b33029a7e6114ba5878 |
| youtube.language-reactor.03d6caf3025d5d4ff7173b98 | 3 | 91cdd84127e41362a374e5aa414e0d67fe3350d47034d5d28876e1320c341ff2 |
| youtube.language-reactor.0f655eb709f7de01ec09f51b | 3 | 1e609dfbc7312106eab273ad13df08392fe4b6084e7c754c09447f6885b604ab |
| youtube.language-reactor.169ce859154c22c2a38abe8d | 4 | 5b56320c5a60195797e586eee1482b538845f40723148b4fae669b82676cdad2 |
| youtube.language-reactor.1b8dead97d73ec570e42b3b9 | 3 | a437856e9b40c4d618bd864a22caec3469a18a76fc4e62dfad15e9ffff7c127a |
| youtube.language-reactor.2ed7b5a8401b017dc7153bba | 2 | 02f0aabcee663552300d580ebeea537b01562719a36cad52278526ab1ca8f8f2 |
| youtube.language-reactor.3c1b7c7e9538bea68e02b987 | 3 | 2384599ac7a6cf55de01fedfc377fcf57bde4e242bebc19b6ae83e7564724e84 |
| youtube.language-reactor.40f3d8811da3256beff5e573 | 3 | 7444b9610e30aa4d3d61181e7e930ba3ef2f746b6e71ce4f335d1a5395c5d064 |
| youtube.language-reactor.47c7cbd6ee81c2e97f83f05f | 2 | 399e936b3d1f1526b20b34a6ea14aa63dc3c1442165c6aadcb8d4022be85fa69 |
| youtube.language-reactor.4b03445db0bfdbefb291ded6 | 3 | 205dd0854e74955756a3ec4f12bb2b5ed4b2aa765338b3e485e157dc649a3dc2 |
| youtube.language-reactor.5b33771134f7671906118547 | 3 | e7b349c19aab995ace86ffd120cb5aed94e5a3bf065d67829dedbbdacfd5e048 |
| youtube.language-reactor.5fc903ff3fafb301288b3a8b | 3 | f5628ed856fc9194b9e46fdc47a2063c7820acae5613a362ad7c0fe46aefe496 |
| youtube.language-reactor.637f0118672a0f9b3d58cd22 | 6 | 8306032a5ccaef19ab3663f257f5d06ac559f0f42d51c886ff48b72a9226366e |
| youtube.language-reactor.64f9b9ffeab385852e941863 | 5 | bbd0cd295df81a6ca25961ebb043f6cf002c513f3a086263f3f231958e3e7906 |
| youtube.language-reactor.6fe9f2b9f1ecf2b86c04a21a | 3 | c5e6b2b5c89903b06351ebd476a29485c9fbee8229851867c5d9fd4c6fe2851b |
| youtube.language-reactor.74cf6ec47411960a44c7974d | 5 | 22a89a5c644965179aafe1c214ed36c1a4d09e597ce95a7f65bfde4d335f3796 |
| youtube.language-reactor.78ab2ff16039f05619953aec | 5 | 1462404868dcf3814c10802cafbd05ea6f3c2d867c87b5aa1fa67f4c38b1465f |
| youtube.language-reactor.7e66387dc3167d77fc379f15 | 5 | ae4936db66f5ff0f0c61a5a62b98ec224610822ef4c9e266f9faf682699c9866 |
| youtube.language-reactor.7edb2352504d8388d63c8a76 | 6 | ab85c4d975f63abf1528d8830a101ac8fda073c7c299f3988e170c2f5d2f5b6e |
| youtube.language-reactor.952691fad0fcdeca0e2af5cf | 2 | d41d3cb37073858e9bddf289222acceae355fbdb941a52a097204b05defc3e7c |
| youtube.language-reactor.ad09ca1bf27a93e33e190b62 | 6 | d5d86197630df706370c5f385e794c2b84acd05c01983e11980c2ea24b8c89b4 |
| youtube.language-reactor.ad72efd1c4aaa7fb69056ff1 | 3 | ff003c9d69dd04b4a3a2d9588ed8b6c7e339e5477ba06b00e550ba7bd7bc74c3 |
| youtube.language-reactor.b0f0d131fff1f8331a13e732 | 6 | 1d47ff906500e15cd1a32ad0242f608a30074a3695ebafdc679193fd86871675 |
| youtube.language-reactor.b85f2e3c4d3f8b85a2e5b2c5 | 3 | fb3c79c8ee87a1502760b960ecdb08c37f04cf975efa834c52e547e520da4c7f |
| youtube.language-reactor.bd35be11c23130f396e9b544 | 3 | e85f5565aa8dd92969b97269f392b109672f4f2362a2f5be18aa364671dc7d31 |
| youtube.language-reactor.bf2b3a27b939ede0875ef1db | 3 | 37ce2d815d12fa7ee248bd5e1455d808b5bcc38a9368aeebfcf0651c22ad187b |
| youtube.language-reactor.c7f96252872ccbee859347dc | 5 | 1eb5fd8e09dd1b18333056aa2996cd16bff789f6e97db7292a76d476c6c55503 |
| youtube.language-reactor.cf319f98a972f8fc4d5b6dc9 | 3 | 15a2e280fd846f9cc31eec43222e55ed6dcf50eccef4c24c8e6a5a9d12172bbe |
| youtube.language-reactor.d877540d6f039fbffe1a2506 | 5 | 5dbe6818a0ac91a3eb60a00d0d84a5f57d1d4bd379c5c72ab9941818a10f6fb1 |
| youtube.language-reactor.f40620ebdd85832804a879db | 3 | ede4cce5279bc3500c7397d7017a8ca0e011f324efc25ccaf4c29d2568258ed3 |
| youtube.language-reactor.fb0e8cc9436f764f81369218 | 6 | 5901a6ad4396917da96731f449fbde20890b3099c32aa90d8c92d606c8f14850 |
