# 账户菜单、头像与公开 UID 实施计划

## 范围与任务归属

本计划落地 `ALPHA-033` 的账户资料切片：Editorial Studio 账户入口、个人资料编辑、头像三路来源和不可变公开 UID。它不实现阶段 9 好友关系、好友列表、消息、推荐或公开用户目录。

设计依据：[`docs/superpowers/specs/2026-08-28-account-menu-avatar-public-uid-design.md`](../superpowers/specs/2026-08-28-account-menu-avatar-public-uid-design.md)。

实施前必须阅读仓库要求的 Next.js 16 agent guide（`node_modules/next/dist/docs/`）以及当前架构、数据库和测试策略文档；不得把现有未提交的 `surface-state` 改动带入本切片。

## 任务 1：账户领域模型与跨端契约

### 修改/新增

- `src/modules/account/domain/public-uid.ts`
- `src/modules/account/domain/avatar.ts`
- `src/modules/account/domain/account-profile.ts`
- `src/modules/account/domain/index.ts`
- `src/shared/contracts/v1/api-contract.ts`
- `contracts/schemas/v1/account-profile-response.schema.json`
- `contracts/schemas/v1/account-profile-patch.schema.json`
- `contracts/schemas/v1/avatar-upload-response.schema.json`
- `contracts/openapi/v1/openapi.json`
- `contracts/fixtures/v1/account-profile-*.json`
- `apps/mobile/lib/core/contracts/api_contract.dart`
- `apps/mobile/lib/features/account/data/account_profile_dto.dart`
- `tests/unit/public-uid.test.ts`
- `tests/unit/avatar-domain.test.ts`
- `tests/contracts/account-profile-contract.test.ts`
- `apps/mobile/test/core/contracts/account_profile_contract_test.dart`

### 实现

建立独立的 `account` 领域模块，避免把账户身份和学习画像混在 `profile` 模块中。定义：

- `public_uid` 的生成/规范化/格式校验（`SN-XXXX-XXXX`，排除易混字符）；
- `AvatarKind = upload | preset | initials`、稳定 `presetId` 枚举、头像引用 DTO；
- 首字母按 Unicode 字素提取，颜色由公开 UID 哈希映射到 Sueño 语义色；
- `AccountProfileDto`、PATCH 输入和稳定错误码，禁止暴露数据库行类型、邮箱、内部 UUID 或签名 URL。

TypeScript 与 Dart 必须由同一组 JSON fixtures 校验字段集合、空值语义和未知字段拒绝规则。领域代码保持纯 TypeScript，不依赖 React、Next.js、Drizzle 或 Supabase SDK。

### 验收

覆盖 UID 格式、字符集、哈希颜色、Unicode 首字母、头像三种来源、缺少显示名、未知字段和版本不匹配。Dart 解析结果与 TypeScript fixtures 一致。

## 任务 2：数据库迁移、UID 保留与 RLS

### 修改/新增

- `src/shared/db/schema/users.ts`
- `src/shared/db/schema/index.ts`
- `drizzle/0015_*.sql`（使用 `pnpm db:generate` 生成并审阅）
- `src/modules/account/repositories/account-repository.ts`
- `src/modules/account/repositories/drizzle-account-repository.ts`
- `src/modules/privacy/repositories/*`（仅为头像清理和 UID 保留扩展）
- `tests/database/account-profile-persistence.test.ts`
- `tests/database/account-profile-rls.test.ts`
- `tests/database/account-data-deletion.test.ts`

### 实现

在 `profiles` 增加 `public_uid`、`avatar_kind`、`avatar_preset_id`、`avatar_path`，并使用 `updated_at` 作为并发条件。新增仅服务端可访问的 `reserved_public_uids` 表（唯一 UID、保留时间、原因），保证账号删除后 UID 永不重新分配。

迁移必须：

1. 先为现有 profile 生成合法 UID，处理唯一冲突并写入保留表保护历史值；
2. 再添加非空/检查约束与唯一索引；
3. 更新 Supabase Auth profile 创建触发器，让新账户服务端自动生成 UID；
4. 保持现有 `profiles_select_own`/`profiles_update_own` 语义，并禁止客户端直接读取保留表；
5. 将头像对象路径纳入现有隐私删除清理任务，删除事务先登记 UID、再清理 profile；
6. 不修改其他代理未提交的迁移或绕过版本化迁移流程。

repository 只接受内部 `userId`，所有查询显式按拥有者过滤；application 层返回 DTO。若现有删除事务无法在同一边界完成 UID 保留和头像清理，停止扩张并记录阻塞，不静默放宽权限。

### 验收

空库迁移、已有 profile 回填、UID 唯一性/不可变性、删除后不回收、用户 A/B RLS 隔离、头像清理任务和并发 `updated_at` 冲突测试通过。

## 任务 3：头像存储 provider 与账户 application

### 修改/新增

- `src/modules/account/storage/avatar-storage.ts`
- `src/modules/account/storage/supabase-avatar-storage.ts`
- `src/modules/account/application/get-account-profile.ts`
- `src/modules/account/application/update-account-profile.ts`
- `src/modules/account/application/upload-avatar.ts`
- `src/modules/account/application/delete-avatar.ts`
- `src/modules/account/application/index.ts`
- `src/shared/observability/index.ts`（仅添加不含 PII 的头像事件）
- `package.json` / lockfile（若图像转换库尚未存在，增加服务端 `sharp`）
- `tests/unit/account-application.test.ts`
- `tests/unit/avatar-storage.test.ts`

### 实现

定义 `AvatarStorage` 端口；Supabase 适配器使用服务端 service-role 配置访问私有 `profile-avatars` bucket，路径只含内部用户 hash/版本，不返回长期签名 URL。上传 application 负责：

- 读取 multipart 文件并限制请求体大小；
- 服务端 MIME、像素尺寸和内容类型校验；
- 使用 `sharp`（或仓库已批准的等价库）裁切/缩放为约 512×512 WebP，去除 EXIF；
- 以新对象写入成功后再更新 profile，旧头像保留至清理任务完成；
- 使用 `attemptId`/`updated_at` 防止旧请求覆盖新头像，支持取消、超时和重试；
- 预设和首字母不产生存储对象；删除头像回退 `initials`。

缺少 service-role 配置、转换失败或对象存储故障必须返回稳定、可重试的错误码，不伪造保存成功；日志只记录 requestId、内部 hash、延迟和错误类型。

### 验收

fake storage 契约测试覆盖成功、MIME/尺寸拒绝、EXIF 清理、旧头像保留、取消、超时、重复 attempt 和删除回退；测试不得调用真实收费/生产存储。

## 任务 4：`/api/v1/me` 与头像 Route Handler

### 修改/新增

- `app/api/v1/me/route.ts`
- `app/api/v1/me/avatar/route.ts`
- `src/shared/contracts/v1/api-contract.ts`（错误码如需扩展）
- `tests/unit/account-route.test.ts`
- `tests/e2e/account-menu.spec.ts`

### 实现

沿用现有 `verifyRequestUser` + cookie 回退认证模式：

- `GET /api/v1/me` 返回账户菜单/资料页所需最小 DTO；数据库不可用返回诚实的 503，不返回占位 UID；
- `PATCH /api/v1/me` 只允许显示名、头像预设/回退和允许的资料字段，执行 Zod 校验、所有权检查和版本条件；
- `POST /api/v1/me/avatar` 接收 multipart 照片，交给 application 处理并返回新的 DTO；
- `DELETE /api/v1/me/avatar` 二次确认由客户端完成，服务端保持幂等并回退首字母；
- 所有响应包含 `apiVersion`、稳定错误码和 requestId；Route Handler 不直接访问数据库、存储 SDK 或 React 组件。

更新 OpenAPI 与 JSON Schema fixtures，覆盖未登录、无数据库、越权、非法图片、冲突、存储未配置和成功响应。

## 任务 5：Web Editorial Studio 账户入口与资料页

### 修改/新增

- `src/shared/ui/account-menu.tsx`
- `src/shared/ui/app-shell.tsx`
- `src/shared/ui/bottom-navigation.tsx`
- `app/(product)/layout.tsx`
- `app/(product)/me/profile/page.tsx`
- `app/(product)/me/profile/profile-editor.tsx`
- `app/globals.css`
- `public/avatar-presets/*.svg`（6 个以内，使用 Sueño 调色板的原创矢量预设）
- `tests/unit/account-menu.test.tsx`
- `tests/unit/profile-editor.test.tsx`
- `tests/e2e/account-menu.spec.ts`

### 实现

将账户菜单从固定“你”升级为：

- 身份行：头像、显示名、当前目标语言标签、chevron；
- 约 320px Editorial Studio 弹层：身份卡（显示名/UID/复制/语言）、编辑资料、进步与隐私、偏好、帮助反馈、退出登录；
- 只在身份卡显示最小公开资料，不放邮箱、评分、连续打卡、时长、好友入口或记忆；
- 资料页提供上传照片、预设、首字母三种选择，1:1 裁剪预览、保存/取消、删除确认和失败重试；
- 触发器和菜单支持键盘、Escape、点击外部、焦点管理、加载/空/失败状态；
- 桌面与移动 CSS 复用令牌但分别适配窄屏；移动 Web 使用底部抽屉语义。

账户数据在产品 layout 以可失败的服务端读取提供初始值；菜单打开时可重新拉取，资料保存后 `router.refresh`，避免客户端缓存成为事实来源。替换现有账户菜单 CSS 时不得改变主导航信息架构或其他页面的颜色令牌。

视觉验收：320/375/414/768/1024/1440px 无横向溢出；暖米白、深墨绿、赤陶、灰绿色；细分隔线和编辑式留白；不使用渐变、儿童化圆润卡片或社交网格。

## 任务 6：Flutter 账户入口与资料编辑

### 修改/新增

- `apps/mobile/lib/features/account/data/account_profile_dto.dart`
- `apps/mobile/lib/features/account/data/account_profile_repository.dart`
- `apps/mobile/lib/features/account/ui/account_menu_sheet.dart`
- `apps/mobile/lib/features/account/ui/account_profile_page.dart`
- `apps/mobile/lib/shared/widgets/product_shell.dart`
- `apps/mobile/lib/app.dart`（仅注入 repository/source）
- `apps/mobile/test/features/account/account_menu_sheet_test.dart`
- `apps/mobile/test/features/account/account_profile_page_test.dart`

### 实现

复用现有 `AuthenticatedApiClient`，通过 repository/source 隔离 HTTP；不要在 Widget 中直接调用 Supabase SDK。窄屏顶部提供头像入口，打开安全区友好的底部抽屉；宽屏账户入口与 Web 信息架构一致。资料页支持预设/首字母和照片上传（使用 multipart API），系统返回、拖拽关闭、键盘/语义标签和失败重试均有覆盖。

预设 ID、首字母和颜色映射直接消费共享 fixtures；头像上传不保存本地音频或私密对话。无后端配置时显示诚实的不可用状态，不生成伪造 UID。

## 任务 7：隐私文档、状态页与发布回归

### 修改

- `docs/architecture.md`
- `docs/database.md`
- `docs/testing-strategy.md`
- `PROJECT_STATUS.md`

记录 `profiles` 新字段、UID 保留表、头像 bucket/清理顺序、API DTO、RLS、日志字段和阶段 9 边界。只在实现和测试完成后更新 `PROJECT_STATUS.md`，记录 Commit、修改范围、验证、限制和下一项；不改写其他代理任务状态。

## 验证顺序

1. 领域/契约/数据库相关 Vitest 与 Flutter 测试；
2. `pnpm lint`；
3. `pnpm typecheck`；
4. `pnpm test --run`（Windows 资源不足时单 worker 复跑并记录既有失败）；
5. `pnpm test:e2e -- tests/e2e/account-menu.spec.ts`；
6. `flutter analyze`、`flutter test`；
7. 涉及迁移和发布候选时执行 `pnpm test:e2e`、`pnpm build`。

不使用真实 service-role、生产存储或收费 provider 运行默认测试；没有 Mac/Xcode 时不把 Flutter 检查表述为 iOS 编译或真机验证。

## 停点条件与已知限制

- 如果 Supabase Storage service-role、图像转换库或现有删除事务无法在当前环境安全接入，先停在 provider/application 层并报告阻塞；不得退回客户端直写数据库或公开 bucket。
- 如果迁移发现已有 `avatar_url` 语义与新 `avatar_path` 冲突，先做字段映射和兼容读取，再删除旧字段；不得静默丢失现有头像。
- 阶段 9 好友查找/邀请链接只保留契约边界，不在本计划实现。
