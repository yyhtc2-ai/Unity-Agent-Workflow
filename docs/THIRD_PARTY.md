# 来源与分发

- `plugins/agent-foundry`：本机已安装 Agent Foundry 0.9.4 的插件快照；保留 LICENSE、THIRD_PARTY_NOTICES.md 和 UNITY_COMPANION_LICENSE.md。未声称有对应的上游精确 commit。
- `bridge/codely`：基于 [Qantara](https://github.com/AhmeedGamil/qantara) commit `0e483108bfd5c436fb5ba8582906ba29c7d4027c` 的本地适配。保留原 MIT LICENSE；新增 Codely runner、进度、项目互斥和测试。不是上游官方发行版。
- `skills/cowork-collaboration`、顶层脚本与文档：本工作流的本地集成内容。

Agent Foundry 的 MIT 许可不覆盖其中 Unity Technologies 的材料，具体范围见组件内第三方说明。Codely、Unity、Codex 本体以及相关账户服务均未包含。现有第三方说明中指向原始仓库 `docs/export-manifest.json` 的路径是上游上下文，本快照不包含该原始导出记录。

本项目自身的文件清单及 SHA256 见 `docs/file-manifest.json`，用于核对本包内容，不构成上游精确版本的证明。没有重打包其他系统技能、商业资源或市场缓存。
