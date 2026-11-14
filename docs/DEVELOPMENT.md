# FlowChat 开发指南

FlowChat 使用 Electron、React 和 TypeScript 构建，界面采用 Radix、Tailwind CSS、Lucide 与 Motion。普通对话调用用户本机安装的工具，不自动安装工具。可选的独立标题与语音接口在主进程调用，其 API Key 通过 Electron `safeStorage` 加密后保存。

## 环境与运行

需要 Windows x64、Node.js 22.12+ 和 npm。CI 使用 Node.js 22 与 Windows 2025 runner。

```powershell
npm ci
npm run dev       # Electron + Vite 热更新
npm run build     # 类型检查与生产构建
npm start         # 启动生产构建
npm run package   # Windows 可运行程序目录
npm run dist      # Windows x64 NSIS 安装包
```

也可运行 `./run.ps1` 或 `./build.ps1 -Publish`。安装包与程序目录输出到 `.artifacts/electron/`；便携分发需保留完整的 `win-unpacked` 目录。

## 测试

```powershell
npm test                    # 离线业务、存储、模型选择和模拟工具协议测试
npm run format:check
npm run build
npm run test:ui              # 构建后运行 Electron 实机 UI 测试
npm run test:layout          # 多窗口尺寸布局断言、截图与笔记交互保护
npm run package
node tools/smoke-package.mjs # 验证打包后的 FlowChat.exe
```

测试使用 `.artifacts/` 中的隔离工作空间和离线模拟工具，不调用真实模型，不消费账户额度。UI 测试截图和结果保存在 `.artifacts/electron-qa/`。

新功能交互截图保存在 `.artifacts/feature-qa/`，布局矩阵截图和测量结果保存在 `.artifacts/layout-qa/`。布局测试同时验证笔记的 Markdown 预览、未保存退出保护、过期模型建议的重新生成、等待模型时保存以及全局快捷键不穿透弹窗。

这些测试不代表真实供应商的在线生成已通过验证。实际生成依赖本机工具版本、登录、网络与模型权限。

## 持续集成与发布

[CI 工作流](../.github/workflows/ci.yml) 在 push、Pull Request 和手动运行时执行：

1. 从锁文件安装依赖，检查格式，运行离线测试。
2. 类型检查与生产构建，运行 Electron UI 测试。
3. 构建 Windows x64 NSIS 安装包，启动打包程序进行冒烟测试。
4. 上传安装包、便携 ZIP 与 SHA-256 校验文件，保留 30 天；UI 截图与结果保留 14 天。

在 Actions 中打开成功的 CI 运行，从 Artifacts 下载 `FlowChat-windows-x64`。下载 Actions 产物需要登录 GitHub。

推送与 `package.json` 版本一致的 `v*` 标签后，CI 成功才会自动创建 GitHub Release，并附上通过测试的安装包、便携版和校验文件。普通分支和 Pull Request 不会发布 Release。当前安装包未签名，流水线无需模型密钥或签名证书。

发布示例（先更新 `package.json` 与 `package-lock.json` 中的版本并提交）：

```powershell
git tag v0.2.0
git push origin v0.2.0
```

## 项目结构

```text
electron/                主进程、业务命令、持久化与工具通信
  domain.ts              会话、分支快照、上下文和偏好规则
  controller.ts          命令校验、会话状态和生成生命周期
  store.ts               串行写入、原子替换、备份与索引
  harness.ts             Codex / Claude Code / OpenCode 接入
  workspace.ts           工作目录与 memory.md 的读写
  compatible-api.ts      Chat Completions / ASR / TTS 兼容接口
  main.ts                原生窗口、IPC、导出和生命周期
  preload.ts             隔离的桌面 API
shared/                  前后端共享 TypeScript 契约
src/renderer/            React 页面、组件和设计变量
assets/                  品牌图标与第三方许可证
tests/electron/          离线业务和协议集成测试
tools/test-electron.mjs   Electron UI 测试与截图
tools/smoke-package.mjs   打包程序冒烟测试
```

## 数据与安全

默认工作空间位于 Electron `userData` 下的 `workspace` 目录。设置环境变量 `FLOWCHAT_DATA_DIR` 可使用独立目录。会话、索引、笔记和设置分开保存；写入串行处理，原子替换并保留 `.bak`。数据使用 v2 schema，不提供旧 C# 格式迁移。

渲染进程启用 `contextIsolation`、沙箱和 CSP，关闭 Node 集成。IPC 校验来源和命令，工具启动不经过 shell。Markdown 不执行 HTML，远程链接交给系统浏览器。

对话、笔记和指令以本机明文文件保存，没有云同步。API Key 在设置写入时加密，备份文件同样保存密文；更换操作系统账户后可能无法解密，需要重新填写。AI 请求由用户选择的本机工具或单独配置的接口发送至其供应商。每条新分支保留分支起点之前的祖先路径快照，后续父分支与兄弟分支内容不会混入。

用户指令保存于设置中的 `instructions`，只有用户通过界面修改；模型记忆统一使用应用数据目录的 `memory` 文件夹，所有对话和工作目录共享，不从用户指令初始化。`memory.md` 是索引，其余 Markdown 文件按主题分类，也支持子目录。生成前只读取索引正文（最多提供 12,000 字符）和文件名列表，不自动读取分类文档正文。模型可以按需搜索、读取、更新文档并维护索引。文档列表只扫描文件元数据；目录、文件内容或开关变化会使旧工具会话失效。界面支持切换、新建和编辑文档，切换前保存当前草稿。全局索引首次建立时合并已知旧工作目录中的记忆、去重并保留原文件，已有全局文档不会再次导入。工具只额外获得独立 `memory` 目录的访问权限，不开放包含设置和凭据的整个数据目录。旧版 `memory` 设置迁移为 `instructions`。对话开始前可指定 `workingDirectory`，之后不能切换目录；新建对话可以选择其他目录。未指定时使用数据目录的 `harness` 子目录。

普通生成启用 harness 的文件工具。Codex 使用 `workspaceWrite`，只允许写入工作目录；Claude Code 使用 `--restricted`（需要支持此参数的版本，官方文档要求 2.1.248+）与 Read/Edit/Write/Glob/Grep；OpenCode 允许文件工具并拒绝外部目录和其他工具。标题生成和笔记协作不启用文件写入工具，笔记建议只有用户采纳并保存后才落盘。权限仍由各 harness 实现，离线协议测试不代表各版本真实工具的在线行为都经过验证。

归档状态同时保存在对话和索引中，重建索引时保留；启动、侧边栏和普通搜索跳过归档对话，恢复入口在设置中。自动标题仅在首次主线回答完成后生成，手动重命名优先，标题失败保留原有标题与回答。

兼容接口以用户填写的 Base URL 为根，支持自定义路径前缀：标题 `POST chat/completions`（非流式）、ASR `POST audio/transcriptions`（multipart/form-data）、TTS `POST audio/speech`（MP3）。接口地址和模型不内置供应商绑定；语音默认关闭，仅为音频输入开放 Electron 麦克风权限。录音最多 3 分钟且大小限制 25 MB，转写结果只填入草稿；朗读按最多 4000 字符分段，可随时停止。

## 参考

- [Electron 安全](https://www.electronjs.org/docs/latest/tutorial/security/)
- [shadcn/ui + Vite](https://ui.shadcn.com/docs/installation/vite)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [OpenAI 语音接口](https://developers.openai.com/api/reference/typescript/resources/audio)
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/typescript/resources/chat/subresources/completions/methods/create)
- [Claude Code 程序化调用](https://code.claude.com/docs/en/headless)
- [OpenCode JavaScript 客户端](https://opencode.ai/docs/build/client/)
- [界面设计说明](../DESIGN.md)
- [历史验证记录](../VALIDATION.md)
