# Unity Agent Workflow

将 Agent Foundry 的任务与工程流程、Codex/Codely 协作技能及 Qantara 风格的 MCP 桥接器组合为一个可迁移仓库。适用于任意 Unity 项目，不包含游戏工程或 Codely 本体。

## 设计意图

这个项目面向以 Codex 为主要开发入口、希望按需调用 Codely CLI 的 Unity 开发者。目标是把架构决策、具体实现和结果验收连接起来，让开发者知道每项任务由谁负责、允许改什么、如何判断完成，并能在后续会话中找到交接依据。

设计围绕以下原则展开：

- **架构与实现分工明确**：Codex 保留整体上下文和设计责任，将可独立描述、范围可控的技术任务交给 Codely；收到结果后重新读取实际改动并验收，不能仅凭执行者的总结关闭任务。
- **按任务选择协作**：用户明确启用后，Codex 再判断哪些细节值得委派。普通开发继续由 Codex 完成，避免安装工具后所有任务都自动进入多 Agent 流程。
- **流程和运行机制一起交付**：Agent Foundry 提供任务、架构、评审和 QA 技能，桥接器提供 CLI 启动、进度查询、会话恢复及结果收取，协作技能连接两者。
- **融入已有 Unity 项目**：每次分派明确项目路径、允许写入范围和验收条件，检查已有改动及 Editor 所有权，并核对场景、序列化资产和 `.meta`。已有正式任务合同优先使用，不再维护另一套关闭状态。
- **交接可追溯**：记录任务 ID、job ID、会话 ID、进展、失败和独立验证证据。进程中断或结果不明时先核对现场，再决定是否恢复，避免盲目重复执行。
- **技术与视觉责任分开**：Codely 只接收技术任务；视觉设计、视觉评审、图片生成和编辑由 Codex 或专用工具处理。该边界由宿主规则和提示共同约束，不能视为不可绕过的安全隔离。

例如实现一个存档系统时，Codex 先确定数据边界、版本迁移方案及验收标准；启用协作后，可让 Codely 在指定目录实现序列化和对应测试；最后由 Codex 检查差异、运行必要验证，再更新原任务合同。短小修改仍可由 Codex 直接完成。

## 与相关开源项目的对比

本项目建立在现有开源成果之上，优势集中在 **Codex + Codely CLI + Unity 的集成适配**。下表比较的是工作流定位，不是模型能力、生成质量或性能排名。对比依据为各项目公开说明（核对于 2026-11-02），本仓库的实际实现范围以源码及“验证和已知限制”为准。

| 项目 | 主要定位 | 本项目针对目标场景提供的补充 | 选用边界 |
| --- | --- | --- | --- |
| [Qantara](https://github.com/AhmeedGamil/qantara) | 通用 MCP 桥接，让 Claude Code、Codex、Gemini 等 CLI 相互委派；宿主负责判断任务和结果 | 在其桥接思路与代码基础上适配 Codely，解析流式输出，报告会话 ID、PID 和最近工具事件；增加共享状态目录内的跨进程项目互斥，并衔接 Unity 任务合同 | 需要多种 CLI 相互调用时，优先评估上游 Qantara；本包服务只公开 Codely 相关工具 |
| [Claude Code Game Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) | 面向 Claude Code 的游戏工作室模板，以角色、技能、规则和质量关卡组织开发，覆盖多种引擎 | 通过 Agent Foundry 的已有适配，提供 Codex 技能入口，再连接实际的 Codely CLI 执行与回收流程，适合已有 Unity 工程按需接入 | 需要 Claude Code 原生工作室模板时，可直接评估该项目；本包不部署其完整原生 hooks 或全部运行机制，也不声称比其更轻或质量更高 |
| [Unity 官方 Agent 插件](https://github.com/Unity-Technologies/unity-agent-plugin) | 提供游戏开发、商业化和性能优化等 Unity 专项技能 | 补充跨 CLI 的任务交接、角色边界和独立验收约定，可与官方专项技能配合使用 | 专项技能与协作编排可以组合；本项目不替代 Unity 官方技能，也不自带 Editor 连接服务 |

### 这些差异带来的实际价值

1. **减少手动搬运任务的步骤**：通过 MCP 调用 CLI，把项目、约束及验收标准写入自包含任务，收取结构化结果，无需操控 Cowork 窗口粘贴消息。
2. **方便把执行进度放回工程任务**：同一个任务合同承接设计、委派和验收证据，便于检查实现是否符合最初约定；没有正式合同的临时任务才使用本地交接工具。
3. **更容易排查交接故障**：流式进度、精确会话恢复和明确失败状态，为中断、超时、缺失终止结果及额度错误提供排查依据。配套模拟 CLI 测试可在不消耗模型额度的情况下检查桥接行为。
4. **便于复用和审阅**：插件快照、协作技能、桥接代码、安装脚本和来源说明分别存放，包含锁文件与内容清单；可审查规则后用于不同 Unity 项目。

上述价值来自流程约定与适配实现，尚无跨项目效率、成本或生成质量的对照实测。当前已有跨进程项目租约和持久化执行快照，但没有自动重放的持久化任务队列或无人值守调度；各平台安装入口及 CLI 适配仍需在实际账户环境中验证，不能将离线测试通过等同于完整生产验证。

## 目录

```text
plugins/agent-foundry/          Agent Foundry 0.9.4 插件快照及原始许可证
skills/cowork-collaboration/    按需启用的 Codex 协作技能和本地交接工具
bridge/codely/                  Qantara 衍生的 TypeScript MCP 服务及离线测试
scripts/                       安装与检查脚本
examples/                      项目规则片段
docs/                         架构、来源与分发说明
```

## 分工和启用范围

普通 Unity 开发由 Codex 处理。只有用户针对当前项目或任务明确提出“使用 Codely 协作”或 `$cowork-collaboration` 才启用委派；安装插件、注册 MCP 和使用 Agent Foundry 均不代表授权委派。

启用后，Codex 负责顶层架构、任务拆解、授权范围和独立验收；Codely CLI 负责边界明确的技术落地。视觉设计、视觉评审、图片生成和编辑不得分派给 Codely。已有视觉规格及资产的纯技术接入可以分派。

Agent Foundry 的正式任务合同是状态来源；已存在任务时不建立第二套生命周期。没有正式任务时，可用协作技能的 SQLite 交接工具。

## Windows 安装

需要 Node.js/npm、Python 3 和已安装的 Codex。先按[官方 Nightly 指南](https://codely-docs.tuanjie.cn/using-codely/codely-cli-nightly/)安装 Codely CLI 并完成账户配置。本项目不下载 CLI，不携带登录信息，也不修改账户或额度。

```powershell
# 在本仓库根目录；先构建和执行不调用模型的测试
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/verify.ps1
# 安装技能、构建并注册 codely_bridge；同名现有配置会阻止安装
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/install.ps1
```

安装器将 Agent Foundry 的技能复制到 Codex 用户技能目录，作为独立技能提供；插件快照保留原生插件结构供审阅。若已通过插件安装 Agent Foundry，请加 `-SkipFoundry`，避免重复发现。此安装方式只部署 Codex skills，不部署 Claude commands/agents，也不自动安装技能提到的其他工具。

可用 `-CodexHome <目录>` 指定技能位置，`-CodelyEntry <绝对路径>` 指定 CLI 的 `bundle/gemini.js`。MCP 注册由当前 `codex` 命令的用户配置决定；自定义 CodexHome 时请同时为该命令设置 `CODEX_HOME`。

安装后新开 Codex 会话。将 [项目规则片段](examples/AGENTS.collaboration.md) 按需合入目标 Unity 项目的 AGENTS.md；安装器不会覆盖任何项目规则。使用示例：“对当前 Unity 项目的存档功能使用 $cowork-collaboration；你负责架构，Codely 实现已确定的技术任务。”

## macOS 安装

macOS 使用 Python 安装入口，无需 PowerShell。先安装 Git、Python 3、Node.js/npm 和 Codex，并确认 `git`、`python3`、`node`、`npm`、`codex` 在当前终端的 PATH 中。离线 CI 使用 Node.js 24；[Codely Nightly 官方指南](https://codely-docs.tuanjie.cn/using-codely/codely-cli-nightly/)目前推荐 Node.js 26.4 或更高版本，请优先满足实际 CLI 的要求。

### 1. 安装并登录 Codely CLI

按官方指南安装；其 macOS 命令为：

```bash
curl -fsSL "https://codesearch-plugins.tos-cn-shanghai.volces.com/codely-cli/install.sh" | bash
codely --version
codely
```

最后一条命令用于账户登录。若已安装旧公版，先按官方指南处理版本冲突。本项目不自动运行该安装器；权限及 macOS 系统提示按官方指南处理。账户额度和模型访问需要单独确认。

### 2. 下载、验证和安装本项目

```bash
git clone https://github.com/yyhtc2-ai/Unity-Agent-Workflow.git
cd Unity-Agent-Workflow

# 不调用模型的构建、桥接集成测试和交接工具测试
python3 scripts/verify.py

# 只检查依赖、目标目录和 MCP 配置，不复制或修改配置
python3 scripts/install.py --dry-run

# 安装技能并注册 codely_bridge
python3 scripts/install.py
```

已有 Agent Foundry 插件时，预检和安装均添加 `--skip-foundry`。默认技能目录为 `~/.codex/skills`；自定义目录请提前设置 `CODEX_HOME`，先创建该目录，该变量也会传给 `codex mcp`。已有同名技能或 `codely_bridge` 时安装器停止，不覆盖现有配置。中途失败可能留下已复制的技能，需检查后再重试。

安装器通过 `npm root -g` 查找 `@codely/cli/bundle/gemini.js`，兼容不同 npm 前缀；也可指定入口：

```bash
python3 scripts/install.py --skip-foundry --codely-entry "/absolute/path/to/@codely/cli/bundle/gemini.js"
codex mcp get codely_bridge
```

安装后新开 Codex 会话，按前文说明合入项目规则，协作仍须用户明确启用。注册使用 Node 和仓库绝对路径，因此不要移动仓库；切换 nvm 等工具的 Node 版本后，若原路径失效，需更新 MCP 配置。Unity 项目使用本机绝对路径，例如 `/Users/yourname/Projects/MyGame`，Editor 位置及连接也需在本机确认。

### 兼容性检查范围

| 组件 | 检查结果与边界 |
| --- | --- |
| MCP 桥接器 | 使用 Node 直接启动 CLI、标准路径接口和进程信号；已审查 macOS 路径，macOS GitHub runner 与 Windows 离线测试均通过 |
| 安装与验证 | 新增跨平台 `install.py`、`verify.py`；原 `.ps1` 保留供 Windows 使用 |
| 已安装 CLI 检查 | 移除 `APPDATA` 固定路径，改用 npm 全局目录或 `BRIDGE_CODELY_ENTRY`；构建后在 `bridge/codely` 内运行 `node tests/installed-mcp.mjs`，只检查入口和 MCP 工具发现，不调用模型 |
| 交接数据库 | 使用 Python 标准库 `pathlib` 和 SQLite，遵循 `CODEX_HOME` 或用户主目录 |
| Agent Foundry / Unity 工具 | 保留上游快照，未逐项执行全部技能，未验证 Mac Editor、原生依赖和其他外部集成 |
| Apple Silicon / Intel | 本次未新增原生二进制依赖；Node、Codely、Unity 的架构支持取决于其发行版本，未完成双架构实机验证 |

已添加 [跨平台离线 CI](.github/workflows/compatibility.yml)，在 macOS、Windows 和 Linux runner 上执行构建、模拟 CLI 集成测试及交接工具测试。[首次运行](https://github.com/yyhtc2-ai/Unity-Agent-Workflow/actions/runs/41390148453)的 macOS 和 Linux 测试已通过，最新结果以仓库 Actions 为准；CI 不安装 Codely、不登录账户、不启动 Unity。当前改动在 Windows 完成，不能据此声称 Mac 上的真实 Codely/Unity 链路已验证。

## 运行、恢复和升级

桥接器 0.3.0 公开 `ask_codely`、`check_job`、`wait_job`、`cancel_job` 和 `recover_job`。任务正文与固定策略直接通过原生 Node 参数 `-p` 传递，关闭 shell，不依赖 Codely Nightly 未实际接收的 stdin。正文加策略上限为 24000 UTF-8 字节；Windows 转义后过长时也会拒绝，需拆分任务，不会静默截断或回退到 stdin。

执行快照、回答文件和项目租约默认保存在 `${CODEX_HOME:-~/.codex}/codely-bridge/`。可通过 MCP 环境变量 `BRIDGE_STATE_DIR` 指定绝对目录；要互斥的桥接进程必须共享同一目录。job 使用 UUID，不因服务重启复用 ID。这些是执行记录，正式任务合同仍由 Agent Foundry/现有项目流程管理。

- `check_job` / `wait_job` 同时返回文本与结构化字段，包括 `job_id`、`status`、`session_id`、`pid`、`result_path`。`done` 只说明 CLI 成功，不能替代 Codex 验收。
- 服务意外退出后，原记录显示 `interrupted`，项目租约保留。先检查 CLI PID、子孙进程、会话及部分改动；确认无写入者后，调用 `recover_job`，传入 `job_id`、`confirm_no_writers: true` 及 `evidence`。工具会拒绝仍存活的原桥接或 CLI；只将中断执行记为失败并释放租约，不重新发任务或自动接受产物。PID 复用等无法确认的情况应保持阻塞。
- `incomplete` 表示 CLI 成功但响应或回答文件发生截断，返回 `isError: true` 及截断标记，需检查 `result_path` 指向的本地文件。默认 MCP 文本响应上限 1000000 字节，单事件解析上限 4000000 字节，回答文件上限 8000000 字节；分别可用 `BRIDGE_MAX_OUTPUT_BYTES`、`BRIDGE_MAX_EVENT_BYTES`、`BRIDGE_MAX_ARTIFACT_BYTES` 设置。结构化元数据另计。
- `cancel_job` 仍只取消直接 CLI 进程；共享租约不能约束其他编辑工具、使用不同状态目录的实例或遗留子孙进程。重试前仍需核对写入者。

已有安装不会被安装器覆盖。升级时先收取/停止原任务，再拉取代码并构建；如果 MCP 已指向本仓库，重启 Codex 会话即可加载新构建。若仍指向旧的本机副本，需按 [桥接器文档](bridge/codely/CODELY-BRIDGE.md) 更新注册。安装在用户技能目录的 `cowork-collaboration` 也需比较后同步更新，保留自己的修改。旧 `qantara setup` 已禁用，不会再修改 Claude/Gemini/Codex 的通用桥接配置。

## 验证和已知限制

`python3 scripts/verify.py`（Windows 也可使用 `scripts/verify.ps1`）执行构建、原有模拟 CLI 集成测试、12 项新增回归及 5 项交接工具测试，不调用模型。新增回归覆盖正文传递、异常事件隔离、跨进程互斥、重启与崩溃恢复、UTF-8 截断、旧 setup 拒绝配置修改，以及 Windows 文件占用与快照并发更新。

2026-11-02 已用真实 Codely Nightly `1.0.0-nightly.71` 验证一次隔离 Unity 元数据工具任务：完整任务和策略送达、随机回执匹配、14 项独立行为检查通过、原文件保持不变。首次尝试暴露的 Windows `EPERM` 快照替换问题已增加有界重试；后续调用成功结束，验收器补充识别 CLI 自身索引缓存后，复核已有会话通过，未再次调用模型。详见 [验证记录](docs/VALIDATION.md)。

在用户明确授权真实账户调用后，可手动运行：

```bash
cd bridge/codely
# 会消耗账户额度；默认 CI 不运行
node tests/live-e2e.mjs --allow-model-call
# 对已完成的同一会话重新验收，不再调用模型
node tests/live-e2e.mjs --verify-existing /absolute/path/to/evidence-directory
```

CLI 即使使用 `ask` / `--no-upm`，仍可能写入 `.codely-cli/auto-saves/` 和 `.codely-cli/UnityInsight/` 存档、索引或锁文件。本流程单独记录这些副产物，不自动删除、提交或修改忽略规则；严格要求整个文件系统只读时需另行隔离。共享租约是协作约束，不是操作系统沙箱。

实际鉴权、额度、CLI 版本变化、Unity Editor 联动和 C# / 场景 / Prefab 开发仍需对应环境验证。单次 Node 工具任务不代表全部 99 个 Agent Foundry 技能经过行为验证，也不能推断复杂 Unity 任务的质量、成本或速度。服务重启只恢复查询依据，不提供 Codex 退出后的常驻调度；历史快照与回答文件需由使用者按保留需求管理。

## 来源与许可证

保留 [第三方说明](docs/THIRD_PARTY.md) 及各组件许可证。Agent Foundry 包含受 Unity Companion License 约束的参考材料，不能将整个仓库一概声明为 MIT。本包没有凭据、历史会话、任务数据库、node_modules 或个人 Codex 配置。项目仓库：[yyhtc2-ai/Unity-Agent-Workflow](https://github.com/yyhtc2-ai/Unity-Agent-Workflow)。
