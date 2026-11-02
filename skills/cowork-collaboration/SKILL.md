---
name: cowork-collaboration
description: Coordinate Unity development through Codely CLI only when the user explicitly requests this collaboration workflow for the current project or task.
---

# Unity 项目：Codex 与 Codely CLI 协作

仅在用户明确要求对当前项目或任务使用本协作技能或 Codely CLI 协作时启用。普通开发请求不触发本技能，也不自动通过 `codely_bridge` 分派。授权限于用户明确指定的项目或任务范围；本技能自身不能扩大该范围。

此技能适用于用户正在处理的任意 Unity 项目。采用 [Qantara](https://github.com/AhmeedGamil/qantara) 的主 Agent + CLI 桥接思路：Codex 自主判断是否分派，负责顶层设计、任务拆解、集成决策和独立验收；桥接层只管理进程及消息；适合清晰划定边界的实现细节通常交给 Codely CLI。简短、紧急、受阻或不适合委派的工作可由 Codex 直接完成；用户对当前任务的指令优先。

**禁止向 Codely CLI 分派视觉设计和图片生成。** 包括设计或评审 UI 视觉风格、布局、配色、概念图、图标、插画、贴图，以及编写生图提示词或调用工具生成、修改图片。这些由 Codex 或适当的专用工具处理。混合任务先拆分：设计和图像产出由 Codex 完成，规格及资产明确后，Codely 可以按既定规格完成代码、布局接线等纯技术实现；不得让它自行补充视觉设计或生成图片。

## 选择项目与准备交接

确认用户意图、目标项目根目录、项目规则（包括 `AGENTS.md` 和现有 `CODELY.md`）及已有改动；Git 项目另查分支和基准提交。不要把某个历史项目或工作树当作默认项目。为任务确定单一写入者及具体读写路径；对允许修改的已有脏文件，在必要时保留任务前内容或差异与哈希，便于辨别本次增量。不要重置、覆盖或归属其他人的改动。并发工作须明确隔离冲突路径及 Unity Editor 所有权；任务或技能已有正式生命周期时沿用其合同和关闭规则。

已实测 Nightly `1.0.0-nightly.71` 在项目目录运行后，即使使用 `ask` 也可能在 `.codely-cli/auto-saves/` 写入 JSON 和 Markdown 会话存档，或在 `.codely-cli/UnityInsight/` 创建索引数据库与锁文件，内容可能包含任务及对话信息。这是 CLI 自身的额外文件，不代表业务文件被模型修改；在任务基线和结果中如实区分并检查这些文件，勿自动删除、提交或修改忽略规则。若用户要求整个项目文件系统完全只读，不能假定该 CLI 调用无写入；需要合适的隔离环境或如实说明限制。

给 Codely 的任务应包含：唯一任务 ID、目标和交付物、项目根目录、相关约束、明确的允许写入路径与禁止动作、验收标准、必要的检查和停止条件。要求其报告改动路径、实际检查结果与阻塞。明确禁止超出当前用户授权的提交、推送或其他外部动作；需要 Editor 时明确由谁使用哪个 Editor。只读任务注明不修改文件。

## 使用 CLI 分派

优先使用已注册的 `codely_bridge` MCP 服务器：`ask_codely` 接受绝对项目路径 `cwd`、`task_type`（`implementation`、`analysis` 或 `verification`）、自包含的 `task`、可选精确 `session_id` 和 `background`。它不接受视觉设计或图片生成类别；Codex 仍须判断任务内容并拆分，类别枚举和提示词不是对自然语言的完全强制隔离。`check_job`、`wait_job`、`cancel_job` 管理后台任务；`recover_job` 仅用于经核对后的中断执行恢复记录，`check_job` 返回当前状态及已观察的会话 ID、PID 和最近工具事件。长任务使用 `background: true`，记录 job ID/PID 后继续其他不冲突工作，完成前用 `wait_job` 收取结果（单次最多等待约 45 秒）。

桥接器通过共享本地状态目录中的项目租约实现跨进程互斥，执行快照与回答文件可在重启后查询，job 使用不复用的 UUID。默认状态目录为 Codex 用户目录下的 `codely-bridge`；可设绝对路径 `BRIDGE_STATE_DIR`，参与互斥的实例必须使用同一目录。不同状态目录、其他编辑工具及遗留子孙进程不受此租约约束，仍应检查实际写入者。这些执行记录不取代正式任务合同或独立验收。

`interrupted` 表示原桥接退出且执行结果待核对；租约不会自动过期或重发。先检查 CLI PID、子孙进程、会话和部分改动，确认没有写入者后，才可调用 `recover_job`，传入 `job_id`、`confirm_no_writers: true` 和核对依据 `evidence`。工具会拒绝仍存活的原桥接或直接 CLI；恢复只记录失败并释放租约，不重放任务。`incomplete` 表示响应或回答文件被截断，检查结构化 `result_path`、截断标记及实际产物后再判断，不能当作完整成功。

`cancel_job` 仅请求停止 CLI 直接子进程，需再查看终态、可能的子孙进程及部分改动。桥接子进程的权限不自动继承 Codex 沙箱；下发前按 CLI 实际权限和用户授权判断。不要把桥接层 `done` 当作验收通过。

如果新注册的 MCP 工具尚未载入，可在可用时重启 Codex 会话；也可按下述相同限制通过命令执行工具直接调用安装的 `codely` CLI。始终在**目标项目根目录**执行，不使用图形界面自动化或向 Cowork 窗口发消息。先用 `codely --version` 和 `codely --help` 核对实际版本与可用参数；CLI 登录、模型或权限不可用时报告实际问题，不自动改配置或切换到图形界面。

桥接器以原生参数数组、关闭 shell，通过 `-p` 传递完整任务和固定策略；不依赖 stdin。任务加策略超过 24000 UTF-8 字节或 Windows 转义后过长时会拒绝，需拆分，不能静默截断。

本机已验证 Nightly `1.0.0-nightly.71` 支持非交互 `-p`、`--output-format stream-json`、`--resume-session`、`--approval-mode auto_edit` 和 `--path-policy strict`。使用参数数组或正确的 shell 引号传递任务，禁止把任务文本拼进可执行 shell 代码。根据任务选择最小权限，通常：

- 只读分析：`codely --no-upm --agents=false --path-policy strict --collaboration-mode ask --output-format stream-json -p "任务文本"`。
- 获准的文件实现：在相同基本参数下用 `--approval-mode auto_edit` 取代 `--collaboration-mode ask`。自动编辑仍只在用户授权范围内；`strict` 不保证整个工作区的文件系统隔离，也不按提示词强制限定具体文件。若命令或其他工具需要审批而非交互模式无法执行，不要为消除阻塞擅自切换 `--yolo`；由 Codex 在授权范围内完成必要操作或报告阻塞。

`--no-upm` 用于不需要 UPM 的任务，关闭 CLI 的自动 UPM 连接；这本身不证明所有 Editor 桥接或工具均已禁用。需要 Unity Editor/Bridge 时先确定具体实例和权限，按实际 CLI 版本与 Unity 技能执行。`--agents=false` 避免未经明确授权的嵌套分派。按环境支持的进程工具启动、观察输出与退出状态；任务较长时用有界等待持续跟踪，不把短暂静默当作完成。

`stream-json` 的 `init.session_id` 是 Codely 会话标识；记录它与项目路径、进程/工具会话句柄、时间、简要进度和错误。完成需同时检查 CLI 退出状态、结构化 `result.status`、最后回复和实际产物。对同一项目、同一会话的后续交接，只有确认旧进程已停止且会话 ID、项目路径匹配时，才可加 `--resume-session <已验证的会话ID>` 恢复；不要用 `--continue` 猜测最近会话，也不要假定 CLI 会话就是 Cowork GUI 的会话。

启动结果不明或观察中断时，记录 `delivery_unknown`（进程中断停在 `sending` 同样视为不明），先检查已有进程、输出、会话和工作树，禁止盲目重发或启动第二个写入者。历史 Cowork UI 交接记录保留原样，不自动当作 CLI 会话恢复。

若 CLI 返回 402 预算或额度错误，保留和检查可能已产生的部分改动，记录失败及实际输出，告知用户检查 Codely 账户或模型额度；不要循环重试或自行切换到付费模型。

## 进度记录与独立验收

正式任务已有合同或生命周期时，把分派与验收证据写入已有交接；不要建立第二套任务状态或关闭流程。否则使用随附的 [本地交接记录工具](scripts/ledger.py)，记录在 Codex 用户目录，不写进 Unity 项目。只存必要摘要，不记录密钥、敏感数据或完整对话。

状态为 `prepared`、`sending`、`delivery_unknown`、`sent`、`running`、`waiting_user`、`awaiting_verification`、`completed`、`failed`、`cancelled`；它们是观察记录，不是实时进程监控。一个项目的默认执行通道使用稳定标签 `Codely CLI`，用于防止未解决交接期间重复分派；真实 CLI 会话 ID 另记在事件中。不同通道、重命名、正式任务和其他进程不受该排他约束，仍须检查实际活动写入者。状态变化、进展、阻塞和恢复依据都应记录。

Codely 声称完成后，Codex 对照任务前基线检查实际改动、范围和产物，按任务运行独立检查；对 Unity 场景、序列化资产和 `.meta` 一并核对。记录命令、结果及未验证项。只有验收标准满足且有实际证据才标记 `completed`；失败或无法验证如实报告。正式任务是否关闭仍由原生命周期决定。

本流程依靠 Codex 活跃时启动和观察 CLI；本地记录可供以后恢复，但不自动提供 Codex 停止后的后台轮询或任务调度。

## 记录工具用法

运行 `python "<本技能目录>/scripts/ledger.py" --help` 查看参数。无正式任务记录时：

1. `create --project "项目绝对路径" --session "Codely CLI" --objective "目标" --scope "允许范围" --acceptance "验收标准" --baseline "任务前基线"`，把返回的 ID 写入 CLI 任务。
2. 启动前从 `prepared` 转 `sending`。桥接确认启动后转 `sent`，记录 job ID、PID、项目和启动时间；观察到会话 ID 后记录。再依据事件记录 `running` 或 `awaiting_verification`。启动结果不明时转 `delivery_unknown`。
3. 用 `note ID --text "进度和证据"` 保存摘要；`list --project "项目绝对路径"`、`list --all` 和 `show ID` 可恢复记录。完成或失败的桥接结果必须收取并记入现有交接；发生状态冲突先检查，不要强行覆盖。
4. 桥接完成后由 Codex 独立核对；验收通过后使用 `transition ID --from awaiting_verification --to completed --note "结论" --evidence "独立检查及结果"`。

该工具只记录交接，不运行 CLI、不验证任务，也不保证任务恰好执行一次。官方参考：[CLI 工作流](https://codely-docs.tuanjie.cn/using-codely/codely-cli/)、[命令行参数](https://codely-docs.tuanjie.cn/features-introduction/command-line-arguments/)。
