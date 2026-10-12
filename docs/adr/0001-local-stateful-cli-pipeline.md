# ADR-0001：采用本地有状态 CLI 流水线

- 状态：Accepted
- 日期：2026-10-10

## 背景

流程同时包含本地 Git 操作、文件净化、人工复核、第三方仓库创建和 ICT Skill 调用。网络操作有副作用，且每一步都需要保留可复核证据。

## 决策

采用 Node.js 22 ESM 本地 CLI，以 `runs/<run-id>/` 作为一次流程的状态边界，并把外部写操作分成独立命令：

```text
acquire → audit → review → prepare → verify → create-repo → init-repo → push → select-problem → submit
```

默认 dry-run，真实外部写操作使用显式确认参数。

## 选择理由

1. 本地 Git 和文件系统操作是主工作负载，CLI 比服务端更直接。
2. 运行证据可以与源代码隔离保存，便于审计和回滚。
3. 分步命令允许在人工复核点暂停，不把多个不可逆操作绑定在一次调用中。
4. Node.js 与现有 ICT Skill 的 `.mjs` 脚本一致，减少运行时差异。
5. Provider、策略和 ICT Skill 都有明确适配器接缝，未来可替换。

## 代价

- 当前流程需要操作者按命令推进。
- 运行目录需要本地清理策略。
- GitCode 和 ICT 平台的网络错误需要在适配器层处理。
- 构建验证尚未覆盖所有语言生态。

## 后果

后续若增加 Web UI，UI 只能调用现有应用服务层，不应直接操作 Git 或 ICT API；CLI 仍作为完整、可审计的控制面。
