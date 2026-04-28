<p align="center">
  <a href="docs/screenshots/1.jpg"><img src="docs/screenshots/1.jpg" width="75" alt="看板" /></a>&nbsp;
  <a href="docs/screenshots/7.png"><img src="docs/screenshots/7.png" width="75" alt="代码审查" /></a>&nbsp;
  <a href="docs/screenshots/2.jpg"><img src="docs/screenshots/2.jpg" width="75" alt="团队视图" /></a>&nbsp;
  <a href="docs/screenshots/8.png"><img src="docs/screenshots/8.png" width="75" alt="任务详情" /></a>&nbsp;
  <img src="resources/icons/png/1024x1024.png" alt="Hermit" width="80" />&nbsp;
  <a href="docs/screenshots/9.png"><img src="docs/screenshots/9.png" width="75" alt="执行日志" /></a>&nbsp;
  <a href="docs/screenshots/3.png"><img src="docs/screenshots/3.png" width="75" alt="智能体评论" /></a>&nbsp;
  <a href="docs/screenshots/4.png"><img src="docs/screenshots/4.png" width="75" alt="创建团队" /></a>&nbsp;
  <a href="docs/screenshots/6.png"><img src="docs/screenshots/6.png" width="65" alt="设置" /></a>
</p>

<h1 align="center"><a href="https://github.com/yancyuu/Hermit">Hermit</a></h1>

<p align="center">
  <strong><code>拥有编程能力 + 编程环境 = 拥有一切。</code></strong>
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=blue" alt="最新版本" /></a>&nbsp;
  <a href="https://github.com/yancyuu/Hermit/actions/workflows/ci.yml"><img src="https://github.com/yancyuu/Hermit/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
</p>

<p align="center">
  <sub>基于 Claude Code 的极简多智能体协同看板。我们不造大模型网关，我们为具备通用执行能力的数字劳动力提供最强的工作台。</sub>
</p>

> Hermit 基于 `claude_agent_teams_ui` 二次开发，保留其本地优先的 Claude Code 团队协作能力，并在此基础上强化中文体验、成员启动模式、远程多机运行和进程治理。

<img width="1304" height="820" alt="界面预览" src="https://github.com/user-attachments/assets/dea53a01-68b3-4c36-bcf6-e4d1ad4cdb31" />

## 设计哲学：做减法，聚焦核心

当前的 Multi-Agent 框架大多陷入了过度工程化的泥沼：复杂的编排系统、沉重的模型网关、难以调试的黑盒状态。但回归本质，真正强大的 Agent 不只是“会写代码”，而是掌握了编程这种通用执行能力：能读写文件、调用工具、连接系统、改造流程，并把想法落实到可运行的环境里。

Hermit 的选择很明确：不在“让 Agent 更像一个新框架”这件事上继续堆抽象，而是复用已经足够强的 Claude Code Runtime，把通用任务协作需要的控制平面补齐。

- **编程能力 The Brain & Hands**：编程不是狭义的写业务代码，而是操作数字世界的元能力。Claude Code 已经证明了单一 Agent 在理解、执行、改造系统上的强大能力，它就是 Hermit 最信任的底层执行单元。
- **编程环境 The Environment**：能力需要被约束、观察和调度。Hermit 通过 Electron 看板、任务状态、审查流、飞书长连接、SSH/MCP，把本地和远程工作环境变成可管理的数字工位。
- **状态即调度，文件即记忆**：当任务、消息、审查、收件箱和运行状态都能落盘并被看见，很多复杂中心化调度逻辑就不再是第一优先级。

当你为最强的数字大脑配备 Kanban、IM 通讯、无缝文件访问、工具调用和可审查的执行轨迹时，它能处理的就不只是软件开发，而是所有可以被数字化、流程化、工具化的任务。你不需要先造一个庞大的模型网关。你需要的是一个能让它持续交付的工作台。

## 像管理真实团队一样管理 Agent

Hermit 拒绝“全局网关式”的臃肿设计，采用更接近真实团队的协作模型：负责人接需求、拆任务、同步状态；成员在独立上下文里执行；看板、评论、审查和日志共同构成团队事实。

- **Leader 并非代理服务器**：负责人是业务入口，负责理解目标、拆解任务并分配成员，而不是代管一切 Prompt 流量的中心网关。
- **独立且自治的成员**：每个成员都有独立 Inbox 和执行环境。成员可以接任务、写评论、发起审查，也可以被单独查看、诊断或重启。
- **看板不是装饰**：任务状态是团队协作协议的一部分。需求、执行、审查、返工和完成都沉淀在同一条工作流里。
- **零信任与资产保护**：Hermit 不是云端代码托管服务。真实执行由你的本地或 SSH 远程 Claude Code 发起，核心代码资产不需要上传到第三方控制面。

这套模型并不试图微观管理每一次模型调用。它把真实协作中最重要的东西摆到台面上：谁在做、做到哪、卡在哪里、改了什么、谁来审。

### 对标 OpenClaw：不是重写智能，而是组织交付

OpenClaw 以及大量基于 Pydantic AI 等框架构建的 Agent 系统，核心发力点通常是“如何让单个或多个 Agent 思考得更深、记忆更持久”。

Hermit 不在这一层硬卷。它直接把 Claude Code 视为基础设施，把重点放在“如何把强 Agent 大面积部署到真实任务流程里”：多团队状态监控、任务同步、外部渠道接入、远程机器执行、审查闭环和故障排查。

这更像是在为数字劳动力提供办公室、看板、信箱、工作目录和审查流程，而不是重新训练一个更复杂的 Agent。

### 对标 Hermes：不是中心化路由，而是团队入口

很多复杂 Multi-Agent 系统会在调度层做很重的中心化 Gateway，让网关二次判断每个消息应该去哪里、由谁处理、如何路由。

Hermit 的原则是：**负责人是团队入口，不是全局网关**。外部渠道可以绑定到具体团队或负责人，消息天然带有团队归属。负责人在自己的团队语境里决定是否回复、创建任务、分派成员或进入审查流。

这更接近一个高效任务团队：Leader 负责接需求和定目标，成员在自己的 Inbox 和工作区里执行，系统通过文件状态、任务看板和日志把过程透出来，而不是让一个巨大的中心路由器替所有人思考。

## 核心能力

- **Claude Code Runtime**：默认复用官方 `claude` CLI / Claude Code 能力，不要求你先迁移到另一套模型网关。
- **团队负责人**：统一团队入口，负责目标理解、任务拆解、成员分派和外部沟通。
- **成员协作**：成员有独立 Inbox，可以互相发消息、接任务、评论任务、请求审查。
- **任务看板**：任务支持待办、进行中、审查、完成等状态，工作流可视化。
- **代码审查**：按任务查看 diff，可对 hunk 接受、拒绝或评论。
- **执行日志**：查看 Claude CLI 输出、工具调用、会话消息和成员状态。
- **渠道接入**：当前重点支持飞书长连接，后续可扩展 Slack、企业微信、钉钉、Webhook。
- **团队级远程执行**：通过 SSH/SFTP 把团队调度到远程机器，由远程 Claude Code 执行。
- **启动模式可选**：成员可选择 Claude 子 agent 模式或 tmux 独立进程模式，并按顺序串行启动以降低限流风险。
- **中文优先**：界面、团队创建、成员管理、设置、删除确认、错误提示等主流程面向中文用户。

## 架构简图

```text
外部渠道（飞书/Slack/Webhook）
        |
        v
渠道实例绑定
        |
        v
团队负责人 team-lead
        |
        +--> 任务看板 / 评论 / 审查
        |
        +--> 成员 inbox
        |
        +--> Claude Code Agent 进程
        |
        +--> 本地或 SSH 远程项目目录
```

关键原则：

- 负责人是团队入口，不是全局网关。
- 成员是独立执行单元，不让负责人代替成员消费普通成员 Inbox。
- 任务、消息、审查和运行状态都要落到可追踪状态里。
- 远程执行先以团队为单位，不提前引入复杂调度。
- 长期记忆优先沉淀到系统级文件、任务和审查记录，而不是先依赖复杂向量库。

## 竞品对标

| 基础能力 | Hermit | Claude Dashboard | OpenClaw 类 Agent 框架 | Hermes 类中心网关 | Vibe Kanban / OpenHands 类产品 |
|---|---:|---:|---:|---:|---:|
| 直接复用 Claude Code Runtime | ✅ | ✅ | ❌ | ❌ | ⚠️ |
| 多成员团队模型（负责人 + 成员） | ✅ | ❌ | ⚠️ | ⚠️ | ⚠️ |
| 成员独立 Inbox / 消息协作 | ✅ | ❌ | ⚠️ | ⚠️ | ❌ |
| 看板任务状态闭环 | ✅ | ⚠️ | ❌ | ❌ | ✅ |
| 代码审查 / diff 审批流 | ✅ | ⚠️ | ❌ | ❌ | ⚠️ |
| 飞书等外部渠道绑定负责人 | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| 本地优先，不托管核心代码 | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| SSH 远程团队级执行 | ✅ | ❌ | ❌ | ⚠️ | ⚠️ |
| 文件、任务、评论沉淀为长期记忆 | ✅ | ⚠️ | ⚠️ | ❌ | ⚠️ |
| 低复杂度启动，先可用 | ✅ | ✅ | ⚠️ | ❌ | ✅ |

✅ 支持；⚠️ 部分支持或需要额外工程；❌ 不是核心能力。

Hermit 的核心取舍是：不重新发明 Agent 大脑，而是在 Claude Code 之上补齐团队控制平面。相比 Claude Dashboard 更强调多成员协作、渠道入口、远程执行和任务闭环；相比框架/网关类方案更少造底座，优先让数字劳动力稳定交付。

## 快速开始

1. 安装并启动 Hermit。
2. 确保本机已安装并登录官方 Claude Code / `claude` CLI。
3. 选择一个项目目录。
4. 创建团队，填写团队目标、成员、角色和工作方式。
5. 启动团队，选择成员启动方式：Claude 子 agent 或 tmux 独立进程。
6. 在看板、消息、任务详情和代码审查中观察并介入。

## 安装

当前版本默认检测官方 `claude` CLI，不再要求预装 `claude-multimodel`。

如果 macOS 图形界面启动后找不到 `claude`，请确认 Claude Code 已安装，或在设置里配置 CLI 路径。常见路径包括 Homebrew、npm/nvm、`~/.claude/local/bin` 等。

<table align="center">
<tr>
<td align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest">
    <img src="https://img.shields.io/badge/macOS-下载最新版本-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS" />
  </a>
</td>
<td align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest">
    <img src="https://img.shields.io/badge/Windows-下载最新版本-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
  </a>
</td>
<td align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest">
    <img src="https://img.shields.io/badge/Linux-下载最新版本-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux" />
  </a>
</td>
</tr>
</table>

## 典型使用场景

### 软件开发团队

你给负责人一个需求，例如“把设置页的渠道配置做完整”。负责人会拆任务，安排前端、后端、测试或审查成员推进，最后在看板上沉淀状态。

### 外部渠道值班

把飞书群或应用长连接绑定到团队负责人。外部用户发来的问题会进入该团队上下文，负责人可以直接回答，也可以创建任务交给成员。

### 远程机器执行

本地电脑只做 UI 和控制台，把团队调度到远程 Mac、Linux 机器或更适合跑任务的开发机上执行。

### 个人增强工作台

不创建多个成员，只使用负责人。你仍然能获得任务看板、消息记录、代码审查和日志追踪能力。

## 开发

依赖：Node.js 20+、pnpm 10+。

```bash
git clone https://github.com/yancyuu/Hermit.git
cd hermit
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm dist:mac:arm64
```

项目主要技术栈：

- Electron 40
- React 19
- TypeScript 5
- Tailwind CSS
- Zustand
- Claude Code / `claude` CLI
- MCP
- SSH/SFTP

## 当前边界

- 当前主线优先支持 Claude Code，不把 Codex/Gemini/OpenCode 作为首页或创建团队主路径。
- 多机 MVP 是团队级执行，不是成员级调度。
- 渠道接入当前优先飞书长连接，多渠道结构已预留。
- Hermit 不是云端代码托管服务；它读取本地或你配置的远程项目目录，真实模型请求由你的 Claude Code 环境发起。
- 成员可用 Claude 子 agent 或 tmux 独立进程启动，但为了降低限流风险，团队初始化会按成员顺序串行拉起。

## 路线图

- 多渠道接入：Slack、企业微信、钉钉、Webhook。
- 团队渠道模板：按团队/负责人快速复用渠道配置。
- 更稳定的远程执行状态监控。
- 成员级远程调度。
- Master 分发：后续将 Skills 与 MCP 能力统一通过 master 下发，团队成员只接收经过负责人编排和授权的工具/技能配置。
- 计划模式：执行前先生成并审查团队计划。
- 更细粒度的成员上下文权限。
- CLI / Web 控制台。
- 自定义看板列和工作流。

## 安全

IPC 和主进程 handler 会校验 ID、路径和 payload 结构。项目编辑和写入操作被限制在当前选择的项目根目录内；只读发现流程会访问 `~/.claude/` 下的 Claude 数据和应用自有状态目录。敏感配置、凭据路径和路径穿越会被阻止。

## 许可证

[AGPL-3.0](LICENSE)
