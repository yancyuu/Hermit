# Agent 导航

本文件只作为导航层，帮助 Agent 快速找到项目说明、架构约定和当前产品方向。不要把这里当成第二份架构真相；具体规则仍以对应文档和代码为准。

优先阅读：
- 项目概览、安装和命令：[README.md](README.md)
- 工作约定和项目规则：[CLAUDE.md](CLAUDE.md)
- Feature 架构标准：[docs/FEATURE_ARCHITECTURE_STANDARD.md](docs/FEATURE_ARCHITECTURE_STANDARD.md)

当前产品重点：
- UI 默认面向中文用户，新增可见文案应优先使用简体中文。
- 默认本地运行时是普通 Claude CLI/Claude Code，不要假设必须存在 `claude-multimodel`。
- 多机协同方向改为仓库同步：每台机器安装 Hermit，团队模板和 Skills 通过 GitHub/企业 Git 仓库源同步；不要再把 SSH/SFTP 分布式调度作为新功能默认方向。
- Skills 支持配置多个 GitHub/企业 Git 源；团队模板也支持多个 GitHub/企业 Git 源。
- 团队名、成员名、角色等用户输入必须支持中文；内部目录/标识需要单独做安全 slug。

新功能默认位置：
- 中大型功能：`src/features/<feature-name>/`
- 参考实现：`src/features/recent-projects`
- `src/features` 内的本地规则：[src/features/CLAUDE.md](src/features/CLAUDE.md)

## Review 重点

- Agent 团队消息、任务生命周期、会话解析、代码审查 UI、运行时/提供商检测出现回归时，按高优先级处理。
- 中大型新功能必须符合 `docs/FEATURE_ARCHITECTURE_STANDARD.md`，尤其是跨进程边界和公开 feature 入口。
- Electron main、preload、renderer、shared 要保持职责分离，并使用既有 path alias。
- 不要手动拼接 agent block 标记，使用 `wrapAgentBlock(text)`。
- 小心影响 `isMeta` 语义、chunk 生成、成员消息解析、任务/subagent 过滤、结构化任务引用的改动。
- IPC 和 main-process handler 必须验证输入、优雅失败，不能暴露不安全的文件系统或进程能力。
- 触及解析、持久化、IPC、Git、provider auth、review flow 的用户可见流程，需要聚焦测试或清晰验证路径。
- 验证命令优先使用 `pnpm`；除非用户明确要求，不要建议运行会大范围改格式的 `pnpm lint:fix`。
