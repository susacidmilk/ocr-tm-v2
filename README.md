# OCR 翻译记忆库 v2

[![selftest](https://github.com/susacidmilk/ocr-tm-v2/actions/workflows/selftest.yml/badge.svg)](https://github.com/susacidmilk/ocr-tm-v2/actions/workflows/selftest.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4.svg)](#-快速开始windows)

**中文** | [English](README.en.md)

Windows 桌面 **游戏 / 视觉小说 OCR 翻译器**：在屏幕上框一块对白区 → 自动 OCR → 调用 **DeepSeek（云端）** 或 **本地 LM Studio** 翻译 → 置顶悬浮层显示译文，并把每句「原文 / 译文」按游戏存入本地**翻译记忆库（TM）**。同一段剧情再次出现时**秒显已存译文、不再重复调用 API**。

> 纯本地数据、不上传历史；API Key 只存在你自己机器的设置文件里。

---

## ✨ 主要功能

- **屏幕框选识别区域**：鼠标拖拽画框，屏幕上有浅色虚线提示当前识别区域（可关）。
- **实时逐句翻译**：OCR 稳定识别一句即翻译，翻译源可切 **DeepSeek / 本地 LM Studio**。
- **置顶悬浮层**：透明无边框、点击穿透（可解锁拖动）、字号与宽度可调、自动避开识别区域。
- **批量录制 → 整段翻译**：挂机持续收集对白成清单，一次性整段提交 DeepSeek（自动均分每段 ~70 句、可并发、可用低推理强度防"半天不出字"）。
- **本地翻译记忆库（TM）**：按游戏隔离；同句合一行历史（只记一次 + 出现次数）；精确命中秒显；相似句给"疑似命中"由你确认。
- **术语表**：按游戏维护 `原文 → 译文 #备注`，翻译时作为约束带入，保证专有名词一致。
- **翻译质量控制**：长度硬校验 + 二分/单句兜底；DeepSeek 偶发"回显原文"会被识别并重试；单句「重翻」与「整段翻译」强制走 DeepSeek 保证质量。
- **本地模型提示词**：LM Studio 走视觉小说模板（`[History]`/`[Glossary]`/`[Input]`），被 DeepSeek 修正过的历史行会标 `[corrected]` 作为权威参考，避免用本地初译误导小模型。
- **导出**：翻译记忆库可导出 JSON / TXT。

---

## 🚀 快速开始（Windows）

### 方式一：双击启动（推荐）

1. 安装 [Node.js](https://nodejs.org/)（LTS 版即可，装完无需重启也行，保险起见重启一次）。
2. 双击项目根目录的 **`启动.cmd`**。
   - 第一次会自动下载依赖（Electron，约 100MB，需联网），之后每次都是秒开。
3. 在软件里填好 DeepSeek API Key，即可使用。

### 方式二：命令行

```powershell
npm install
npm start
```

> 首次运行需要联网安装 Electron。若报 `unable to verify the first certificate`（公司网络/证书拦截），可先执行：
> ```powershell
> npm config set strict-ssl false
> npm install
> ```

### 系统要求

- Windows 10 / 11（64 位）
- 英文 OCR 语言包：Windows 设置 → 时间和语言 → 语言和区域，确认有 **English (United States)**（多数中文系统已自带）。
- 用 DeepSeek 需要外网；用本地 LM Studio 则无需外网。

---

## 🕹 使用步骤

1. **填 Key**：左侧「翻译源」选 ☁️ DeepSeek（或 🔌 LM Studio），填好 API Key / Base / 模型。
2. **框选识别区域**：点「🖱 框选区域」，在游戏画面上拖拽框住对白文字区。
   - 可用「🔍 测试识别」检查是否抓到字；主界面会实时显示 OCR 当前看到的原文，方便对准。
3. **开始**：点「▶ 开始 OCR」。
   - **实时模式**：对白变化即翻译，悬浮层显示译文。
   - **批量录制模式**：先挂机收集对白成清单，停止后点「整段翻译」批量译好并入库。
4. **回看 / 修正**：右侧「历史」可回看、单句重翻、删除；「翻译记忆库」可搜索、导出。

> 说明：界面目前仅中文。英文界面与更多 UI 语言已列入 [路线图](docs/ROADMAP.md)。

---

## ⚙️ 关键设置

| 位置 | 项 | 说明 |
|---|---|---|
| 翻译源 | DeepSeek / LM Studio | 实时翻译跟随所选源；**单句重翻与整段翻译强制 DeepSeek** |
| 识别区域 | X/Y/W/H、常驻浅色框 | 框选后自动回填 |
| 悬浮层 | 显示/点击穿透、译文字号、原文字号、宽度(240–900)、上下文句数 | 即时生效 |
| 术语表 | 原文 → 译文 → #备注 | 按当前游戏生效 |
| 整段翻译 | 每段句数(70–110)、并发段数、推理强度 | 推理强度默认 `low`，避免长时间无输出 |
| 历史/记忆库 | 两行完整 / 单行紧凑 | 列表显示方式 |

---

## 📁 数据位置

所有数据都在本机（默认 `%APPDATA%\OCR 翻译记忆库 v2\ocr-tm-v2\`）：

- `settings.json` —— 设置（含各翻译源的 API Key / Base / 模型）
- `records/<游戏名>.json` —— 会话历史（同句只留一行）
- `tms/<游戏名>.json` —— 翻译记忆库
- `glossary.json` —— 术语表

删除该目录即可完全重置。**不会**上传任何历史或译文。

---

## 🔧 常见问题

- **OCR 没反应 / 抓不到字**：确认已装英文 OCR 语言包；用「🔍 测试识别」确认框选位置对；主界面「当前识别到的原文」可帮你看是不是框偏了。
- **一直"翻译中…"**：多为网络/服务无响应，程序有超时看门狗会跳过并标记失败；检查 API Key 与外网。
- **本地 LM Studio 不出字 / 很慢**：确认 LM Studio 已加载模型且服务在 `http://127.0.0.1:1234/v1`；模型名与设置一致。
- **DeepSeek 返回原文不翻译**：程序已有"回显防护"自动重试；仍偶发可点该条「重翻」。
- **悬浮层不见了**：可能被拖到屏幕外或在设置里被关；也确认「显示翻译悬浮层」勾选。
- **双击启动.cmd 一闪而过**：多半是没装 Node.js，或依赖安装失败；命令行里手动 `npm install` 可看到具体报错。

---

## 🧪 开发者：自测

自测**不需要** Electron / 屏幕 / 网络（纯 Node）：

```powershell
npm test                 # 一键跑全部
node scripts/selftest-data.js    # 数据层（TM / 历史合并 / norm）
node scripts/selftest-batch.js   # 整段批量：对齐、二分兜底、回显防护、并发
node scripts/selftest-b.js       # OCR 稳定帧 / 录制器 / 路由决策
node scripts/selftest-c.js       # 视觉小说提示词 + 术语表
```

真实 DeepSeek 连通性自测（可选，需自备 Key）：

```powershell
$env:OCR_TM_DEEPSEEK_KEY="sk-..."
$env:OCR_TM_LIVE="1"
node scripts/selftest-batch.js
```

### 打包成免安装 exe（可选）

想让完全不装 Node.js 的人也能用，可自行打一个绿色便携版：

```powershell
npx electron-builder --win --x64
```

产物在 `dist/`（`portable` 单文件 exe 与 zip）。打包配置已写在 `package.json` 的 `build` 字段里。
注意：这样分发的是**你自己构建**的包，与在 GitHub 上 clone 源码后 `npm install` 的用法互不影响。

### 目录结构

```
src/main/            主进程
  index.js             装配 / 窗口 / IPC
  data/                TM、历史、词表、设置、norm、原子写
  ocr/                 屏幕捕获、稳定帧、模式路由、录制器、控制器
  translate/           Provider 抽象、DeepSeek / LM Studio、批量调度、VN 提示词
  match/               精确命中、疑似命中（模糊）
src/preload/         contextBridge API
src/renderer/        主界面 / 悬浮层 / 框选窗 / 区域提示框
scripts/             离线自测
docs/                设计说明与验证清单
```

更多设计细节见 [`docs/设计说明.md`](docs/设计说明.md)；真实屏幕 OCR 的验收步骤见 [`docs/验证清单.md`](docs/验证清单.md)；后续计划见 [`docs/ROADMAP.md`](docs/ROADMAP.md)；版本变化见 [`CHANGELOG.md`](CHANGELOG.md)；想参与贡献见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

---

## ⚠️ 免责声明

本项目仅用于**个人学习与自用翻译辅助**。请遵守你所用游戏 / 内容的使用条款与当地法律；OCR 结果与机器翻译仅供参考。使用 DeepSeek 等第三方服务时，请遵守其服务条款并自行承担 API 费用。

## 📄 许可证

[MIT](LICENSE)
