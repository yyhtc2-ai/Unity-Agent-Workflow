# Unity Agent Workflow

将 Agent Foundry 的任务与工程流程、Codex/Codely 协作技能及 Qantara 风格的 MCP 桥接器组合为一个可迁移仓库。适用于任意 Unity 项目，不包含游戏工程或 Codely 本体。

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

## 验证和已知限制

`verify.ps1` 构建桥接器、运行模拟 CLI 的 MCP 集成测试和交接记录测试，不消耗模型额度。实际账户鉴权、模型额度和 Unity Editor 连接需在使用环境验证。此前实测 CLI 为 `1.0.0-nightly.71`；该适配器的真实模型端到端调用未完成验证（账户曾返回 402）。

任务运行在桥接进程内存中；重启后 job 丢失，交接记录用于人工恢复。项目互斥只覆盖单个桥接进程；取消仅针对直接子进程。CLI 即使 ask 模式也可能写入项目 `.codely-cli/auto-saves/`。桥接完成不等于验收完成，也不提供 Codex 退出后的常驻监控。

## 来源与许可证

保留 [第三方说明](docs/THIRD_PARTY.md) 及各组件许可证。Agent Foundry 包含受 Unity Companion License 约束的参考材料，不能将整个仓库一概声明为 MIT。本包没有凭据、历史会话、任务数据库、node_modules 或个人 Codex 配置。项目仓库：[yyhtc2-ai/Unity-Agent-Workflow](https://github.com/yyhtc2-ai/Unity-Agent-Workflow)。
