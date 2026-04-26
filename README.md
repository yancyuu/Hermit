<p align="center">
  <a href="docs/screenshots/1.jpg"><img src="docs/screenshots/1.jpg" width="75" alt="看板" /></a>&nbsp;
  <a href="docs/screenshots/7.png"><img src="docs/screenshots/7.png" width="75" alt="代码审查" /></a>&nbsp;
  <a href="docs/screenshots/2.jpg"><img src="docs/screenshots/2.jpg" width="75" alt="团队视图" /></a>&nbsp;
  <a href="docs/screenshots/8.png"><img src="docs/screenshots/8.png" width="75" alt="任务详情" /></a>&nbsp;
  <img src="resources/icons/png/1024x1024.png" alt="Multi Agent Teams" width="80" />&nbsp;
  <a href="docs/screenshots/9.png"><img src="docs/screenshots/9.png" width="75" alt="执行日志" /></a>&nbsp;
  <a href="docs/screenshots/3.png"><img src="docs/screenshots/3.png" width="75" alt="智能体评论" /></a>&nbsp;
  <a href="docs/screenshots/4.png"><img src="docs/screenshots/4.png" width="75" alt="创建团队" /></a>&nbsp;
  <a href="docs/screenshots/6.png"><img src="docs/screenshots/6.png" width="65" alt="设置" /></a>
</p>

<h1 align="center"><a href="https://github.com/lazy-agent/multi-agent-workbench">Multi Agent Teams</a></h1>

<p align="center">
  <strong><code>把 Claude Code 从“一个聊天窗口”升级成“一个可协作、可审查、可接入渠道的 AI 团队”。</code></strong>
</p>

<p align="center">
  <a href="https://github.com/lazy-agent/multi-agent-workbench/releases/latest"><img src="https://img.shields.io/github/v/release/lazy-agent/multi-agent-workbench?style=flat-square&label=version&color=blue" alt="最新版本" /></a>&nbsp;
  <a href="https://github.com/lazy-agent/multi-agent-workbench/actions/workflows/ci.yml"><img src="https://github.com/lazy-agent/multi-agent-workbench/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
</p>

<p align="center">
  <sub>中文优先的 Claude Code 团队工作台。默认使用官方 `claude` CLI，支持团队负责人、成员、任务看板、代码审查、外部渠道接入和团队级多机执行。</sub>
</p>

<img width="1304" height="820" alt="界面预览" src="https://github.com/user-attachments/assets/dea53a01-68b3-4c36-bcf6-e4d1ad4cdb31" />

## 为什么需要它

Claude Code 很强，但单个会话天然更像“一个聪明的人”。真实软件工程更像团队协作：有人拆任务，有人实现，有人审查，有人同步状态，有人对接外部需求。

Multi Agent Teams 做的事情，是把 Claude Code 的能力组织成一个可管理的团队系统：

- 你不是反复给一个 agent 喂上下文，而是给一个团队负责人下目标。
- 负责人把目标拆成任务，分配给成员，并维护任务看板。
- 成员通过收件箱、任务评论和审查流协作，而不是各自孤立执行。
- 所有进度、消息、代码改动、审查意见都沉淀到可追踪的团队工作区。
- 外部渠道消息不是进入混乱网关，而是绑定到明确的团队负责人和上下文。

它的目标不是替代 Claude Code，而是让 Claude Code 具备“团队操作系统”的外壳。

## 核心创新

### 1. 渠道绑定到人，而不是丢给网关

很多多智能体系统会先做一个全局消息网关：飞书、Slack、Webhook、企业微信都进同一个入口，再让网关猜应该转给哪个 agent。这个模式一旦团队变多、任务变多、渠道变多，很容易出现消息归属混乱：这句话属于哪个团队？该谁回复？要不要变成任务？后续上下文在哪里？

Multi Agent Teams 采用相反的设计：**渠道绑定到团队负责人或指定人员**。

- 一个飞书长连接可以绑定到某个团队的负责人。
- 外部消息进入后，天然携带团队、负责人、渠道和会话上下文。
- 是否创建任务、分派成员、回复用户，由负责人在当前团队语境里决定。
- 回复也沿着同一个渠道回去，不需要全局网关再猜一次。

这让外部沟通变成团队协作的一部分，而不是团队外的一层消息转发。

### 2. 复用 Claude Code 的运行时和记忆

项目不重新造一套模型网关、账号系统或“外部记忆数据库”。当前默认直接使用官方 `claude` CLI：

- 账号、模型、权限、MCP、skills、会话能力尽量复用 Claude Code 原生能力。
- 应用只负责组织团队、任务、消息、看板、审查和状态文件。
- 团队上下文进入 Claude Code 的真实会话，而不是被复制到另一套系统里。

这样做的价值是状态更少、链路更短，也更贴近用户已经验证可用的 Claude Code 环境。

### 3. 文件驱动的团队协作

团队状态不是只存在内存里，而是落到文件结构中：

- 团队配置：`~/.claude/teams/<team>/config.json`
- 成员收件箱：`~/.claude/teams/<team>/inboxes/*.json`
- 任务、评论、审查和运行状态由应用服务读取、更新和索引

文件驱动带来几个好处：

- 易排查：出问题可以直接看文件。
- 易迁移：本地和远程机器都可以用同一套控制模型。
- 易扩展：后续可接入 CLI、Web UI、远程 worker 或更多渠道。
- 少魔法：不依赖复杂中心调度器，也不要求第一期就上集群编排。

### 4. 团队级多机执行

第一期分布式不是做复杂的成员级调度，而是采用更稳的团队级调度：

- 创建或启动团队时选择运行目标：本机或某台 SSH 主机。
- 本地 UI 通过 SSH/SFTP 操作远程项目目录和 `.claude/teams` 文件。
- 远程机器上的 Claude Code 负责真实执行。
- 不做 skills 同步、卷挂载、复杂远程进程编排。

这更接近“把一个团队调度到一台机器上运行”，简单、可控、容易落地。未来再演进到成员级调度也有清晰空间。

### 5. 看板、消息、代码审查是一套闭环

普通聊天工具只记录对话，普通看板只记录任务。Multi Agent Teams 把它们合在一起：

- 用户消息可以转为任务。
- 成员产出必须回写任务评论。
- 完成后可以进入审查流。
- 审查意见对应具体任务和 diff。
- 负责人可以根据消息、任务和代码状态继续分派。

这让 AI 团队不只是“能聊”，而是真的能按工程流程推进。

## 功能概览

- **中文优先**：界面、创建团队、启动团队、成员管理、设置、删除提示等主流程面向中文用户。
- **Claude Code only**：当前默认只支持官方 Claude Code / `claude` CLI，减少多 provider 抽象带来的不稳定。
- **团队负责人**：统一使用 `team-lead` 作为内部负责人身份，UI 展示为“负责人”。
- **成员协作**：成员有独立收件箱，可以互相发消息、接任务、评论任务和请求审查。
- **任务看板**：任务支持待办、进行中、审查、完成等状态，工作流可视化。
- **代码审查**：按任务查看 diff，可对 hunk 接受、拒绝或评论。
- **执行日志**：查看 Claude CLI 输出、工具调用、会话消息和成员状态。
- **渠道接入**：负责人可绑定渠道监听，当前重点是飞书长连接，后续可扩展 Slack、企业微信、钉钉、Webhook 等。
- **远程执行**：通过 SSH 选择远程机器运行团队。
- **单人团队**：也可以只启动负责人，把它当增强版 Claude Code 工作台使用。

## 快速开始

1. 安装并启动应用。
2. 确保本机已安装并登录官方 Claude Code / `claude` CLI。
3. 选择一个项目目录。
4. 创建团队，填写团队目标、成员、角色和工作方式。
5. 启动团队，负责人会初始化团队上下文并拉起成员。
6. 在看板、消息、任务详情和代码审查中观察并介入。

## 安装

当前版本默认检测官方 `claude` CLI，不再要求预装 `claude-multimodel`。

如果 macOS 图形界面启动后找不到 `claude`，请确认 Claude Code 已安装，或在设置里配置 CLI 路径。常见路径包括 Homebrew、npm/nvm、`~/.claude/local/bin` 等。

<table align="center">
<tr>
<td align="center">
  <a href="https://github.com/lazy-agent/multi-agent-workbench/releases/latest">
    <img src="https://img.shields.io/badge/macOS-下载最新版本-000000?style=for-the-badge&logo=apple&logoColor=white" alt="macOS" />
  </a>
</td>
<td align="center">
  <a href="https://github.com/lazy-agent/multi-agent-workbench/releases/latest">
    <img src="https://img.shields.io/badge/Windows-下载最新版本-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows" />
  </a>
</td>
<td align="center">
  <a href="https://github.com/lazy-agent/multi-agent-workbench/releases/latest">
    <img src="https://img.shields.io/badge/Linux-下载最新版本-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="Linux" />
  </a>
</td>
</tr>
</table>

## 典型使用场景

### 软件开发团队

你给负责人一个需求，例如“把设置页的渠道配置做完整”。负责人会拆任务，安排前端、后端、测试或审查成员并行推进，最后在看板上沉淀状态。

### 外部渠道值班

把飞书群或应用长连接绑定到团队负责人。外部用户发来的问题会进入该团队上下文，负责人可以直接回答，也可以创建任务交给成员。

### 远程机器执行

本地电脑只做 UI 和控制台，把团队调度到远程 Mac、Linux 机器或更适合跑任务的开发机上执行。

### 个人增强工作台

不创建多个成员，只使用负责人。你仍然能获得任务看板、消息记录、代码审查和日志追踪能力。

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
- 成员是独立执行单元，不让负责人代替成员消费普通成员 inbox。
- 任务和消息都要落到可追踪状态里。
- 远程执行先以团队为单位，不提前引入复杂调度。

## 与普通多智能体网关的区别

| 维度 | Multi Agent Teams | 普通网关式方案 |
|---|---|---|
| 消息入口 | 渠道绑定负责人/人员 | 全部进入中心网关 |
| 上下文归属 | 天然属于某个团队 | 需要网关二次判断 |
| 任务沉淀 | 消息、任务、评论、审查统一 | 常停留在消息转发层 |
| 运行时 | 复用 Claude Code | 通常再包一层模型网关 |
| 多机执行 | 团队级 SSH 调度 | 常需要 worker/队列/编排系统 |
| 排障方式 | 文件状态可直接检查 | 多依赖服务日志 |
| 第一阶段复杂度 | 低，先可用 | 高，容易过度工程化 |

## 开发

依赖：Node.js 20+、pnpm 10+。

```bash
git clone https://github.com/lazy-agent/multi-agent-workbench.git
cd multi-agent-workbench
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

- 当前主线优先支持 Claude Code，不再把 Codex/Gemini/OpenCode 作为首页或创建团队主路径。
- 多机 MVP 是团队级执行，不是成员级调度。
- 渠道接入当前优先飞书长连接，多渠道结构已预留。
- 应用不是云端代码托管服务；它读取本地或你配置的远程项目目录，真实模型请求由你的 Claude Code 环境发起。

## 路线图

- 多渠道接入：Slack、企业微信、钉钉、Webhook。
- 团队渠道模板：按团队/负责人快速复用渠道配置。
- 更稳定的远程执行状态监控。
- 成员级远程调度。
- 计划模式：执行前先生成并审查团队计划。
- 更细粒度的成员上下文权限。
- CLI / Web 控制台。
- 自定义看板列和工作流。

## 安全

IPC 和主进程 handler 会校验 ID、路径和 payload 结构。项目编辑和写入操作被限制在当前选择的项目根目录内；只读发现流程会访问 `~/.claude/` 下的 Claude 数据和应用自有状态目录。敏感配置、凭据路径和路径穿越会被阻止。

## 许可证

[AGPL-3.0](LICENSE)
