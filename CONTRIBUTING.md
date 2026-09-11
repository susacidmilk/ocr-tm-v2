# 贡献指南 / Contributing

感谢愿意帮忙！无论提 Issue、改文档还是写代码都欢迎。

## 提 Issue

- **Bug**：请用 Bug 模板，附上复现步骤、期望与实际结果、日志原文、系统版本（Windows 版本 / Node 版本），以及 OCR 相关时的「测试识别」输出。
- **功能建议**：请用 Feature 模板，说明使用场景与想要的效果。
- **安全 / 隐私问题**（例如密钥泄漏风险）：请勿公开贴出你的 API Key，描述问题即可。

## 开发环境

```powershell
git clone https://github.com/susacidmilk/ocr-tm-v2.git
cd ocr-tm-v2
npm install
npm start          # 启动应用
npm test           # 跑离线自测（不需要 Electron / 屏幕 / 网络）
```

- 需要 Node.js ≥ 18（开发时用 20 / 24 均可）。
- 自测是纯 Node 的，可在 Linux/macOS 上跑，因此 CI 在 ubuntu 上执行。
- 调试 OCR 需要真实 Windows 桌面与英文 OCR 语言包，参考 [`docs/验证清单.md`](docs/验证清单.md)。

## 代码约定

- **分层不要打破**：`src/main`（主进程逻辑）、`src/preload`（contextBridge）、`src/renderer`（渲染层）三者职责分离；主进程的数据/OCR/翻译模块**不要**依赖 electron 类型，以便被离线自测直接 require。
- 翻译源遵循同一 Provider 接口（见 `src/main/translate/provider.js`），新增源请实现 `translateLine` 与 `translateBatch`。
- 数据写入一律走 `atomicWriteJson`（临时文件 + rename）。
- 注释用中文或英文皆可，但请解释「为什么」而不只是「做了什么」。
- 新增逻辑请尽量补上离线自测断言（`scripts/selftest-*.js`）。

## 提交 PR

1. 从 `main` 切分支：`git checkout -b fix/your-topic`。
2. 确保 `npm test` 全绿；涉及界面/OCR 的改动请说明手工验证方式。
3. PR 描述里写清：改了什么、为什么、如何验证；有关联 Issue 请链接。
4. 保持改动聚焦，一个 PR 解决一件事。

## 不要提交的内容

- `node_modules/`、`dist/`、日志
- 任何 API Key、Token、个人路径（`C:\Users\你的名字\...`）
- 本地运行数据（`settings.json` / `records` / `tms` / `glossary.json`）

`.gitignore` 已覆盖上述内容；提交前可用下面命令自查：

```powershell
git diff --cached | Select-String "sk-[A-Za-z0-9]{16,}|C:\\Users\\"
```

## 许可证

贡献即表示同意以本项目的 [MIT](LICENSE) 许可证发布你的改动。
