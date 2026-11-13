# FlowChat 开发指南

FlowChat 使用 Electron、React 和 TypeScript 构建，界面采用 Radix、Tailwind CSS、Lucide 与 Motion。应用调用用户本机安装的工具，不自动安装工具或管理模型凭证。

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
npm run package
node tools/smoke-package.mjs # 验证打包后的 FlowChat.exe
```

测试使用 `.artifacts/` 中的隔离工作空间和离线模拟工具，不调用真实模型，不消费账户额度。UI 测试截图和结果保存在 `.artifacts/electron-qa/`。

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

数据以本机明文文件保存，没有云同步。AI 请求由用户选择的本机工具发送至其模型供应商。每条新分支保留分支起点之前的祖先路径快照，后续父分支与兄弟分支内容不会混入。

## 参考

- [Electron 安全](https://www.electronjs.org/docs/latest/tutorial/security/)
- [shadcn/ui + Vite](https://ui.shadcn.com/docs/installation/vite)
- [Codex App Server](https://developers.openai.com/codex/app-server/)
- [Claude Code 程序化调用](https://code.claude.com/docs/en/headless)
- [OpenCode JavaScript 客户端](https://opencode.ai/docs/build/client/)
- [界面设计说明](../DESIGN.md)
- [历史验证记录](../VALIDATION.md)
