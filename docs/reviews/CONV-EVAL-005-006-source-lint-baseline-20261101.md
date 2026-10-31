# CONV-EVAL-005/006：源码分区 ESLint 基线审计（2026-11-01）

本切片只审计全量 ESLint 的可解释边界，没有调用 MiniMax、写真实数据库或修改共享生成物。

## 命令与结果

使用 4 GB Node 堆，对 `src`、`app`、`scripts`、`tests` 做分区扫描，并排除 `.next*`、`.tmp*`、`artifacts` 与 `node_modules`：

```text
node --max-old-space-size=4096 node_modules/eslint/bin/eslint.js src app scripts tests --max-warnings=0 --ignore-pattern '.next*' --ignore-pattern '.tmp*' --ignore-pattern 'artifacts/**' --ignore-pattern 'node_modules/**'
```

扫描结果为 **3 errors / 4 warnings**：

- `src/modules/conversation/ui/conversation-contact-rail.tsx` 第 176、204、227 行的 `let request` 触发 `prefer-const`；该文件在本切片前已有未提交改动，且该问题已在历史状态记录中登记，本切片不覆盖其他代理的共享改动。
- `scripts/backfill-media-word-timings.ts` 有两个已有未使用变量警告。
- `tests/database/character-network-persistence.test.ts` 有两个已有未使用变量警告。

未筛选的仓库根目录扫描还会进入 `.next-3000`、`.tmp-*` 等生成物并产生数万条诊断，因此不能作为源码质量结论。Lucía 006 受影响文件此前的定向 ESLint 仍为零错误、零警告；本切片没有新增 005/006 源码诊断。

## 结论

该切片关闭了“全量 lint 结果的生成物污染与源码基线分离”审计；不关闭 `CONV-EVAL-005` 或 `CONV-EVAL-006`。修复共享 `conversation-contact-rail.tsx` 的既有 `prefer-const` 应由其原负责人另立切片处理，避免把无关 UI 改动混入 Lucía 评估收口。

未执行：全量 Vitest、稳定全仓 Playwright、`build`、iPhone Safari、真实登录态、真实 Auth 删除、收费 provider 和真实生产 workflow。整体可用性仍未证明。
