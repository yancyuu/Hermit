<p align="center">
  <a href="docs/screenshots/1.jpg"><img src="docs/screenshots/1.jpg" width="75" alt="看板" /></a>&nbsp;
  <a href="docs/screenshots/7.png"><img src="docs/screenshots/7.png" width="75" alt="代码审查" /></a>&nbsp;
  <a href="docs/screenshots/2.png"><img src="docs/screenshots/2.png" width="75" alt="团队视图" /></a>&nbsp;
  <a href="docs/screenshots/8.png"><img src="docs/screenshots/8.png" width="75" alt="任务详情" /></a>&nbsp;
  <img src="resources/icons/png/1024x1024.png" alt="Hermit" width="80" />&nbsp;
  <a href="docs/screenshots/9.png"><img src="docs/screenshots/9.png" width="75" alt="执行日志" /></a>&nbsp;
  <a href="docs/screenshots/3.png"><img src="docs/screenshots/3.png" width="75" alt="智能体评论" /></a>&nbsp;
  <a href="docs/screenshots/4.png"><img src="docs/screenshots/4.png" width="75" alt="创建团队" /></a>&nbsp;
  <a href="docs/screenshots/6.png"><img src="docs/screenshots/6.png" width="65" alt="设置" /></a>
</p>

<h1 align="center"><a href="https://github.com/yancyuu/Hermit">Hermit</a></h1>

<p align="center">
  <strong><code>拥有编程能力 + 拥有编程环境 = 可以操作数字世界。</code></strong>
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest"><img src="https://img.shields.io/github/v/release/yancyuu/Hermit?style=flat-square&label=version&color=blue" alt="最新版本" /></a>&nbsp;
  <a href="https://github.com/yancyuu/Hermit/actions/workflows/ci.yml"><img src="https://github.com/yancyuu/Hermit/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
</p>

<p align="center">
  <sub>面向 AI 工程团队的本地优先工作台：把 Agent、Skills、团队模板、任务看板和代码审查组织成可版本化、可复用、可协同的交付系统。</sub>
</p>

> Hermit 基于 `claude_agent_teams_ui` 二次开发，保留其本地优先的 Claude Code 团队协作能力，并在此基础上强化中文体验、团队看板、成员运行时、版本化 Skills / 团队模板，以及面向多运行时的长期架构。

<img width="1304" height="820" alt="界面预览" src="docs/screenshots/hero.png" />

## 为什么需要 Hermit

未来的编程 Agent 会越来越强，也会越来越多：Claude Code、Cursor SDK、Codex、Gemini、OpenCode，以及下一批更强的本地/云端运行时。真正稀缺的不会是“再接一个模型”，而是如何把这些能力组织成一个可持续交付的工程系统。

Hermit 不把自己定位成又一个模型网关，也不把多机调度做成复杂的远程控制系统。它更关注 Agent 真正进入工程流程以后需要的控制平面：

- **运行时可替换**：Claude Code 是当前默认底座，Cursor SDK、Codex、Gemini、OpenCode 都应该能作为未来的执行引擎接入。
- **团队可复用**：成员、角色、工作流、Skills、运行时配置不应只存在于某台电脑的隐式状态里，而应该能沉淀为团队模板。
- **企业资产可沉淀**：一个公司真正有价值的不是某次 Agent 对话，而是它逐渐形成的领域团队、岗位分工、审查标准、排障流程、发布规范和内部 Skills。Hermit 要让这些能力沉淀为企业自己的可复用资产。
- **知识可版本化**：Skills、团队模板、角色预设和工作方式应该像代码一样通过 GitHub / 企业 Git 仓库同步、审查、回滚和复用。
- **协作不依赖中心调度**：多台机器协同不需要 Hermit 自己发明复杂分布式系统。每台机器安装 Hermit，连接同一组仓库源，用 Git/PR/企业代码库完成协作。

当 Agent 能写代码之后，问题会自然变成：谁定义任务？谁拥有上下文？谁负责审查？哪些经验可以复用？哪些配置可以跨团队传播？一家企业如何把自己的工程经验、业务知识和协作流程变成可安装、可升级、可审查的“数字团队资产”？Hermit 就是在这个层面提供产品能力。

## 设计哲学：少造底座，多沉淀组织资产

很多 Multi-Agent 框架会把重点放在复杂编排、中心化路由和模型抽象层上。Hermit 反过来做：复用已经足够强的 Agent Runtime，把团队协作中真正需要长期沉淀的部分补齐。

- **编程能力 The Brain & Hands**：编程不是狭义的写业务代码，而是操作数字世界的元能力。Claude Code、Cursor Composer 这类运行时会不断进化，Hermit 不和它们抢“大脑”。
- **团队环境 The Operating Layer**：能力需要被约束、观察和调度。Hermit 通过看板、任务状态、评论、审查和执行日志，把 Agent 的工作变成可管理的团队流程。
- **仓库即协作边界**：跨机器、跨团队、跨组织的协作优先通过 GitHub / 企业 Git 仓库完成。Skills 和团队模板可以像代码一样被 review、发布和回滚。
- **企业经验产品化**：企业可以把“支付故障排查团队”“前端重构团队”“安全审查团队”“发版值班团队”沉淀为团队模板，把内部 SOP、排障手册、代码规范和工具使用方式沉淀为 Skills。新人、不同项目组、不同机器都可以复用同一套组织能力。
- **状态即调度，文件即记忆**：当任务、消息、审查、模板和运行状态都能落盘并被看见，很多“神秘调度层”就不再是第一优先级。

你不需要先造一个庞大的模型网关。你需要的是一个能把数字劳动力组织起来、让经验不断复用、让交付过程可审查的工作台。

## 像管理真实团队一样管理 Agent

Hermit 拒绝“全局网关式”的臃肿设计，采用更接近真实团队的协作模型：负责人接需求、拆任务、同步状态；成员在独立上下文里执行；看板、评论、审查和日志共同构成团队事实；Skills 和团队模板则把可复用经验沉淀成资产。

- **Leader 并非代理服务器**：负责人是业务入口，负责理解目标、拆解任务并分配成员，而不是代管一切 Prompt 流量的中心网关。
- **独立且自治的成员**：每个成员都有独立 Inbox 和执行环境。成员可以接任务、写评论、发起审查，也可以被单独查看、诊断或重启。
- **看板不是装饰**：任务状态是团队协作协议的一部分。需求、执行、审查、返工和完成都沉淀在同一条工作流里。
- **零信任与资产保护**：Hermit 不是云端代码托管服务。真实执行发生在你的本地工作站、你选择的运行时或你信任的仓库/云环境中，核心代码资产不需要交给一个额外的中心控制面。
- **仓库同步而非远程遥控**：多机器协同优先通过 GitHub / 企业 Git 仓库同步 Skills、团队模板和代码变更。每台机器都可以是独立工作站，而不是被一个中心 UI 远程遥控的“节点”。

这套模型并不试图微观管理每一次模型调用。它把真实协作中最重要的东西摆到台面上：谁在做、做到哪、卡在哪里、改了什么、谁来审。

### 和 OpenClaw 的差异：不是个人助理，而是工程团队工作台

OpenClaw 更像一个本地常驻的个人 AI assistant：通过 Gateway 接入 Telegram、Slack、Discord、飞书等渠道，配合 skills、记忆、调度和本地运行环境，让一个长期在线的个人助手能处理各种日常任务。

Hermit 的切入点不同。它不是要做一个覆盖所有聊天渠道的个人助理，而是把编程型 Agent Runtime 放进工程交付流程里：负责人、成员、任务看板、代码审查、执行日志、Skills 和团队模板共同构成一个可管理的 AI 工程团队。

OpenClaw 关注“我如何拥有一个长期在线的 AI 助手”。Hermit 关注“一个组织如何沉淀可复用的数字团队，并让它稳定交付软件和工程任务”。

### 和 Hermes 的差异：不是通用 Agent 网关，而是团队交付控制面

Hermes 是一个更通用的 agent CLI 和 messaging gateway：支持多模型、多工具、终端环境、消息平台接入、定时任务，以及子代理委托。它擅长把一个 agent 连接到不同入口，并让它在多个工具和平台之间工作。

Hermit 不试图成为所有消息和工具的通用网关。它把“团队”作为基本单位：负责人在团队语境里接需求、拆任务、分派成员、推进看板和审查。团队成员不是一次性的子任务 worker，而是有角色、Inbox、任务历史和可复用工作流的持久协作单元。

Hermes 更像“通用 agent 运行和消息接入底座”。Hermit 更像“AI 工程团队的项目管理、审查和知识资产层”：它关心的不只是一次对话如何执行，而是任务如何流转、结果如何审查、团队经验如何沉淀、不同机器如何通过仓库共享同一套 Skills 和团队模板。

## 核心能力

- **Claude Code Runtime**：默认复用官方 `claude` CLI / Claude Code 能力，不要求你先迁移到另一套模型网关。
- **多运行时路线**：当前以 Claude Code 为主，架构上预留 Cursor SDK、Codex、Gemini、OpenCode 等运行时适配。
- **团队负责人**：统一团队入口，负责目标理解、任务拆解、成员分派和外部沟通。
- **成员协作**：成员有独立 Inbox，可以互相发消息、接任务、评论任务、请求审查。
- **任务看板**：任务支持待办、进行中、审查、完成等状态，工作流可视化。
- **代码审查**：按任务查看 diff，可对 hunk 接受、拒绝或评论。
- **执行日志**：查看 Claude CLI 输出、工具调用、会话消息和成员状态。
- **Skills 与团队模板**：规划支持多个 GitHub / 企业 Git 源，同步团队成员模板、角色工作流、Skills 和运行时预设。
- **企业知识沉淀**：企业可以维护自己的团队模板库和 Skills 库，把内部最佳实践、审查标准、故障处理流程和领域知识变成可复用的 Agent 能力包。
- **仓库化协同**：多机协作通过共享仓库、分支、PR 和模板源完成，而不是把 Hermit 做成复杂的远程调度中心。
- **启动模式可选**：成员可选择 Claude 子 agent 模式或 tmux 独立进程模式，并按顺序串行启动以降低限流风险。
- **中文优先**：界面、团队创建、成员管理、设置、删除确认、错误提示等主流程面向中文用户。

## 架构简图

```text
GitHub / 企业 Git 源
        |
        +--> Skills / 团队模板 / 运行时预设
        |
        v
Hermit 本地工作台
        |
团队负责人 team-lead
        |
        +--> 任务看板 / 评论 / 审查
        |
        +--> 成员 inbox
        |
        +--> Agent Runtime（Claude Code / Cursor SDK / Codex / ...）
        |
        +--> 本地项目目录 / 用户选择的可信执行环境
```

关键原则：

- 负责人是团队入口，不是全局网关。
- 成员是独立执行单元，不让负责人代替成员消费普通成员 Inbox。
- 任务、消息、审查和运行状态都要落到可追踪状态里。
- 多机协同优先通过 Git 仓库同步，不提前引入复杂分布式调度。
- 长期记忆优先沉淀到系统级文件、任务和审查记录，而不是先依赖复杂向量库。

## 竞品对标

| 基础能力                        | Hermit | Claude Dashboard | OpenClaw 类 Agent 框架 | Hermes 类中心网关 | Vibe Kanban / OpenHands 类产品 |
| ------------------------------- | -----: | ---------------: | ---------------------: | ----------------: | -----------------------------: |
| 直接复用 Claude Code Runtime    |     ✅ |               ✅ |                     ❌ |                ❌ |                             ⚠️ |
| 面向多运行时适配                |     ⚠️ |               ❌ |                     ⚠️ |                ✅ |                             ⚠️ |
| 多成员团队模型（负责人 + 成员） |     ✅ |               ❌ |                     ⚠️ |                ⚠️ |                             ⚠️ |
| 成员独立 Inbox / 消息协作       |     ✅ |               ❌ |                     ⚠️ |                ⚠️ |                             ❌ |
| 看板任务状态闭环                |     ✅ |               ⚠️ |                     ❌ |                ❌ |                             ✅ |
| 代码审查 / diff 审批流          |     ✅ |               ⚠️ |                     ❌ |                ❌ |                             ⚠️ |
| 本地优先，不托管核心代码        |     ✅ |               ✅ |                     ✅ |                ⚠️ |                             ⚠️ |
| Skills / 团队模板版本化         |     🚧 |               ❌ |                     ⚠️ |                ❌ |                             ❌ |
| 多机协同通过仓库同步            |     🚧 |               ❌ |                     ❌ |                ❌ |                             ⚠️ |
| 文件、任务、评论沉淀为长期记忆  |     ✅ |               ⚠️ |                     ⚠️ |                ❌ |                             ⚠️ |
| 低复杂度启动，先可用            |     ✅ |               ✅ |                     ⚠️ |                ❌ |                             ✅ |

✅ 支持；⚠️ 部分支持或需要额外工程；❌ 不是核心能力。

Hermit 的核心取舍是：不重新发明 Agent 大脑，而是在强运行时之上补齐团队控制平面和可版本化组织资产。相比 Claude Dashboard 更强调多成员协作、渠道入口、任务闭环和模板复用；相比框架/网关类方案更少造底座，优先让数字劳动力稳定交付。

## 快速开始

1. 安装并启动 Hermit。
2. 确保本机已安装并登录官方 Claude Code / `claude` CLI。
3. 选择一个项目目录。
4. 创建团队，填写团队目标、成员、角色和工作方式。
5. 启动团队，选择成员启动方式：Claude 子 agent 或 tmux 独立进程。
6. 在看板、消息、任务详情和代码审查中观察并介入。

未来团队可以进一步连接 Skills / 团队模板仓库源，让不同机器上的 Hermit 复用同一套角色、工作流和团队资产。

## 安装

当前版本默认检测官方 `claude` CLI，不再要求预装 `claude-multimodel`。

如果 macOS 图形界面启动后找不到 `claude`，请确认 Claude Code 已安装，或在设置里配置 CLI 路径。常见路径包括 Homebrew、npm/nvm、`~/.claude/local/bin` 等。

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-arm64.dmg">
    <img src="https://img.shields.io/badge/macOS_Apple_Silicon-DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="下载 macOS Apple Silicon DMG" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-x64.dmg">
    <img src="https://img.shields.io/badge/macOS_Intel-DMG-000000?style=for-the-badge&logo=apple&logoColor=white" alt="下载 macOS Intel DMG" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-Setup.exe">
    <img src="https://img.shields.io/badge/Windows-Setup.exe-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="下载 Windows 安装包" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit.AppImage">
    <img src="https://img.shields.io/badge/Linux-AppImage-FCC624?style=for-the-badge&logo=linux&logoColor=black" alt="下载 Linux AppImage" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-amd64.deb">
    <img src="https://img.shields.io/badge/Linux-DEB-A81D33?style=for-the-badge&logo=debian&logoColor=white" alt="下载 Linux DEB" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit-x86_64.rpm">
    <img src="https://img.shields.io/badge/Linux-RPM-EE0000?style=for-the-badge&logo=redhat&logoColor=white" alt="下载 Linux RPM" />
  </a>
  <a href="https://github.com/yancyuu/Hermit/releases/latest/download/Hermit.pacman">
    <img src="https://img.shields.io/badge/Linux-pacman-1793D1?style=for-the-badge&logo=archlinux&logoColor=white" alt="下载 Linux pacman 包" />
  </a>
</p>

> 如果上面的稳定链接暂时不可用，请到 [Releases](https://github.com/yancyuu/Hermit/releases/latest) 页面下载对应版本资产。

## 典型使用场景

### 产品工程交付

把一个需求交给团队负责人，例如“把设置页的渠道配置做完整”。负责人会把目标拆成前端、主进程、测试、审查等任务，分配给不同成员推进。每个任务的状态、评论、代码变更和审查意见都会沉淀在看板上，而不是散落在聊天记录里。

### 线上故障响应

企业可以准备一个“线上故障响应团队”：负责人接收告警或工单上下文，排障成员查看日志和代码路径，修复成员提交变更，审查成员确认风险。故障处理过程会自动形成任务、评论、结论和复盘线索。

### 代码审查与质量门禁

为代码库配置专门的审查团队：实现成员完成任务后进入 review，审查成员查看 diff、提出修改意见或批准。团队可以把内部代码规范、安全规则、性能检查清单沉淀成 Skills，让审查标准长期一致。

### Skills 与团队模板复用

把常用 Skills、团队角色、成员工作流和运行时预设放进 GitHub 或企业 Git 仓库。不同机器上的 Hermit 可以连接同一组源，拉取模板、审查变更，并用 PR 管理团队知识的演进。团队不必每次从零配置“谁负责实现、谁负责审查、怎么处理发布、怎么排查问题”。

### 企业团队资产沉淀

企业可以把高频工作方式沉淀成自己的数字团队：例如“线上故障响应团队”“代码安全审查团队”“版本发布团队”“数据分析团队”。每个团队模板都包含成员角色、工作流、审查标准和默认 Skills；每个 Skill 都可以承载内部 SOP、工具调用规范、业务知识和质量标准。它们通过企业仓库版本化，像内部平台能力一样持续迭代。

### 多机器协同

不同成员可以在自己的机器上安装 Hermit，连接同一套团队模板源和 Skills 源，通过共享代码仓库、分支和 PR 协同。Hermit 不需要扮演复杂的远程调度中心；企业已有的 Git 仓库就是跨机器协作边界。

### Agent Runtime 评估与迁移

团队可以先以 Claude Code 作为默认运行时，后续逐步评估 Cursor SDK、Codex、Gemini 或 OpenCode 等运行时。Hermit 关注任务、团队、审查、模板和知识资产，让底层 Agent Runtime 可以随技术演进替换。

### 内部平台与自动化团队

平台团队可以把日常重复工作变成数字团队：依赖升级、CI 失败排查、Release Note 生成、文档同步、测试补齐、代码库巡检。负责人负责接收请求和拆任务，成员负责执行，结果通过看板、评论和 PR 留痕。

### 个人增强工作台

不创建多个成员，只使用负责人，也能获得任务看板、消息记录、代码审查和日志追踪能力。适合个人项目、独立开发者、技术负责人做日常规划、代码整理、问题排查和长周期任务管理。

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
- Git / GitHub / 企业仓库源（规划）

## 当前边界

- 当前主线优先支持 Claude Code，Cursor SDK / Codex / Gemini / OpenCode 等作为运行时适配方向逐步验证。
- 不再把 SSH/SFTP 分布式调度作为新功能默认方向；多机协同优先通过 GitHub / 企业 Git 仓库同步 Skills、团队模板和代码变更。
- Hermit 不是云端代码托管服务；它读取本地或你配置的远程项目目录，真实模型请求由你的 Claude Code 环境发起。
- 成员可用 Claude 子 agent 或 tmux 独立进程启动，但为了降低限流风险，团队初始化会按成员顺序串行拉起。

## 路线图

- Cursor SDK Runtime：把 Cursor Agent Runtime 作为可编程运行时接入。
- Skills Git 源：支持配置多个 GitHub / 企业 Git 源，导入、审查、更新和回滚 Skills。
- 团队模板 Git 源：支持多个团队模板源，复用成员角色、工作流和运行时预设。
- 仓库化协同：通过 Git 分支和 PR 管理团队知识、Skills 和模板演进。
- 计划模式：执行前先生成并审查团队计划。
- 更细粒度的成员上下文权限。
- CLI / Web 控制台。
- 自定义看板列和工作流。

## 安全

IPC 和主进程 handler 会校验 ID、路径和 payload 结构。项目编辑和写入操作被限制在当前选择的项目根目录内；只读发现流程会访问 `~/.claude/` 下的 Claude 数据和应用自有状态目录。敏感配置、凭据路径和路径穿越会被阻止。

## 许可证

[AGPL-3.0](LICENSE)
