# 跨客户端 API 契约

本目录是 Next.js Web、服务端和 Flutter 客户端共同依赖的协议权威来源。UI 源码不跨端共享，但协议版本、错误码、字段含义和一致性样本必须共享。

## 目录

```text
contracts/
  openapi/v1/openapi.json       # OpenAPI 3.1 根文档
  schemas/v1/                   # 可复用 JSON Schema
  registry/v1/                  # 协议版本与稳定错误码注册表
  fixtures/v1/                  # TS 与 Dart 同时读取的有效/无效样本
```

## v1 规则

- HTTP 端点统一位于 `/api/v1/`。
- 成功响应包含 `apiVersion` 和 `data`，分页端点可包含 `page`。
- 失败响应包含 `apiVersion` 和 `error`。
- 客户端只根据稳定 `error.code` 决定程序行为，不解析供应商原始错误文本。
- `retryable` 是服务端对本次失败的明确判断；注册表中的 `defaultRetryable` 只用于映射和测试基线。
- 未知字段默认拒绝，避免供应商字段或含义未确认的数据静默扩散。
- 不兼容的 `apiVersion` 返回或映射为 `PROTOCOL_VERSION_UNSUPPORTED`，不能静默按旧语义处理。

## 当前认证端点

`GET /api/v1/auth/session` 接受 Supabase access token：

```text
Authorization: Bearer <access-token>
```

服务端通过 Supabase Auth 验证令牌后返回 `userId` 和可空 `email`。缺少、过期或无法验证的令牌返回 HTTP 401 与稳定错误码 `AUTH_REQUIRED`。TypeScript 和 Dart 都从 `success-auth-session.json` 验证并解析相同身份 DTO。

该端点不接受客户端自行解析 JWT 后提交的用户 ID，也不向响应写入刷新令牌。

## Content Bundle v1

`schemas/v1/content-bundle.schema.json` 是版本化内容文件的结构契约，由服务端 Zod Schema 自动生成。`fixtures/content/v1/` 保存 TypeScript 与 Dart 共同读取的有效样本和语义错误变体。

JSON Schema 负责字段、类型、枚举和未知字段拒绝；以下跨实体规则由 TypeScript 与 Dart 严格校验器共同执行：

- 稳定 ID、版本和引用必须存在且唯一。
- 参与评分的标签权值总和必须为 1。
- 已发布实体必须有 approved review。
- 已发布内容包的版权状态必须为 `cleared`。
- 非原创来源必须提供 URL、署名和许可证据。

修改 Zod Schema 后运行 `pnpm contracts:generate-content` 更新 JSON Schema，再运行两端契约测试。正式内容文件的目录和导入命令见 `content/README.md`。

## 修改流程

1. 先修改 Schema 和注册表。
2. 为兼容与不兼容行为各增加 fixture。
3. 同步 TypeScript 与 Dart DTO/解析器；内容结构从 Zod 重新生成 JSON Schema。
4. 运行 `pnpm test:contracts` 和 `flutter test test/core/contracts`。
5. 破坏性变更必须增加新的 API 主版本，不能原地改变 v1 字段含义。

当前契约只定义协议基础，不代表数据库结构，也不授权客户端直接写证据、画像或关系记忆。
