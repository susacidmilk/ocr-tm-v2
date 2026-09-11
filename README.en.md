# OCR Translation Memory v2

[![selftest](https://github.com/susacidmilk/ocr-tm-v2/actions/workflows/selftest.yml/badge.svg)](https://github.com/susacidmilk/ocr-tm-v2/actions/workflows/selftest.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![platform: Windows](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4.svg)](#-quick-start-windows)

[中文](README.md) | **English**

A Windows desktop **OCR translator for games / visual novels**: draw a box over the dialogue area → it OCRs the text → translates it with **DeepSeek (cloud)** or a **local LM Studio** model → shows the translation in an always-on-top overlay, and stores every `source / translation` pair per game in a local **Translation Memory (TM)**. When the same line appears again, the cached translation is shown **instantly, with no extra API call**.

> All data stays local — no history is ever uploaded. 
---

## ✨ Features

- **Mouse-drag capture region** — drag to box the dialogue area; a faint dashed frame shows the current region on screen (can be turned off).
- **Real-time per-line translation** — as soon as a line is recognized stably, it is translated; switch between **DeepSeek** and **local LM Studio**.
- **Always-on-top overlay** — borderless and transparent, click-through (unlock to drag), adjustable font sizes and width, automatically avoids the capture region.
- **Batch record → whole-segment translation** — leave it running to collect dialogue into a list, then submit the whole segment to DeepSeek at once (auto-splits into ~70-line chunks, runs chunks concurrently, supports a low reasoning effort to avoid "no output for ages").
- **Local Translation Memory (TM)** — isolated per game; one row per sentence (counted, not duplicated); exact hits appear instantly; near-matches are surfaced as "suspected hits" for you to confirm.
- **Glossary** — per-game `source → target #note` entries, injected as constraints so proper nouns stay consistent.
- **Quality control** — strict length validation with bisect/single-line fallback; DeepSeek's occasional "echo the source" responses are detected and retried; single-line **Re-translate** and **whole-segment translation** are always forced to DeepSeek for quality.
- **Local-model prompting** — LM Studio uses a visual-novel prompt template (`[History]` / `[Glossary]` / `[Input]`); history lines corrected by DeepSeek are marked `[corrected]` and treated as authoritative references so a small local model isn't misled by its own earlier drafts.
- **Export** — export the translation memory as JSON / TXT.

---

## 🚀 Quick start (Windows)

### Option 1: double-click (recommended)

1. Install [Node.js](https://nodejs.org/) (LTS is fine).
2. Double-click **`启动.cmd`** in the project root.
   - The first run downloads dependencies (Electron, ~100 MB — needs internet). Afterwards it starts instantly.
3. Enter your DeepSeek API key in the app and you're ready.

### Option 2: command line

```powershell
npm install
npm start
```

> The first run needs internet access to install Electron. If you hit `unable to verify the first certificate` (corporate proxy / TLS interception), try:
> ```powershell
> npm config set strict-ssl false
> npm install
> ```

### Requirements

- Windows 10 / 11 (64-bit)
- English OCR language pack: Settings → Time & language → Language & region — make sure **English (United States)** is present (most systems already ship it).
- DeepSeek needs internet access; a local LM Studio model does not.
- It is recommended to use LM Studio for local deployment and invoke a 4B small model to achieve extremely low first-token latency.

---

## 🕹 How to use

1. **Add your key** — in the left panel pick the source (☁️ DeepSeek or 🔌 LM Studio) and fill in API key / Base / model.
2. **Select the capture region** — click "🖱 框选区域" and drag a box over the game's dialogue text.
   - Use "🔍 测试识别" to check that text is being recognized; the main window continuously shows the raw OCR text so you can align the box.
3. **Start** — click "▶ 开始 OCR".
   - **Live mode**: each new line is translated immediately and shown in the overlay.
   - **Batch record mode**: collect dialogue into a list first, then click "整段翻译" to translate the whole segment and store it in the TM.
4. **Review / fix** — the "历史" (History) tab lets you review lines, re-translate a single line, or delete it; the "翻译记忆库" (Translation Memory) tab supports search and export.

> Note: the UI is currently in Chinese only. English UI and more UI languages are on the [roadmap](docs/ROADMAP.md).

---

## ⚙️ Key settings

| Where | Setting | Notes |
|---|---|---|
| Translation source | DeepSeek / LM Studio | Live translation follows the selected source; **re-translate and batch translation are always forced to DeepSeek** |
| Capture region | X/Y/W/H, persistent frame | Auto-filled after drag-selecting |
| Overlay | show / click-through, translation font size, source font size, width (240–900), context lines | Applied immediately |
| Glossary | source → target → #note | Applies to the current game |
| Batch translation | lines per chunk (70–110), concurrent chunks, reasoning effort | Reasoning effort defaults to `low` to avoid long silent stalls |
| History / TM | two-line / compact single-line | List display mode |

---

## 📁 Where data lives

Everything is local (default: `%APPDATA%\OCR 翻译记忆库 v2\ocr-tm-v2\`):

- `settings.json` — settings (including each source's API key / Base / model)
- `records/<game>.json` — session history (one row per sentence)
- `tms/<game>.json` — translation memory
- `glossary.json` — glossary

Delete that folder to fully reset. **No** history or translation is ever uploaded.

---

## 🔧 FAQ

- **OCR does nothing / can't read text** — check the English OCR language pack; verify the box position with "🔍 测试识别"; the live "current OCR text" display helps spot an off-target box.
- **Stuck on "translating…"** — usually a network/service timeout; there is a watchdog that skips the line and marks it failed. Check your API key and connectivity.
- **Local LM Studio produces nothing / is very slow** — make sure LM Studio has a model loaded and its server runs at `http://127.0.0.1:1234/v1`, and that the model name matches your settings.
- **DeepSeek returns the source text untranslated** — the app has echo protection and retries automatically; if it still happens, use "重翻" (re-translate) on that line.
- **Overlay disappeared** — it may have been dragged off-screen or disabled; also check that "显示翻译悬浮层" is ticked.
- **`启动.cmd` flashes and closes** — most likely Node.js isn't installed, or dependency installation failed; run `npm install` manually in a terminal to see the actual error.

---

## 🧪 Developers: self-tests

The self-tests need **no** Electron, screen, or network (pure Node):

```powershell
npm test                 # run everything
node scripts/selftest-data.js    # data layer (TM / history merge / norm)
node scripts/selftest-batch.js   # batch: alignment, bisect fallback, echo guard, concurrency
node scripts/selftest-b.js       # OCR stabilizer / recorder / routing decisions
node scripts/selftest-c.js       # visual-novel prompt + glossary
```

Optional live DeepSeek connectivity test (bring your own key):

```powershell
$env:OCR_TM_DEEPSEEK_KEY="sk-..."
$env:OCR_TM_LIVE="1"
node scripts/selftest-batch.js
```

### Build a portable exe (optional)

To ship it to people who don't have Node.js, build a portable bundle yourself:

```powershell
npx electron-builder --win --x64
```

Artifacts land in `dist/` (a single-file `portable` exe and a zip). The packaging config already lives in the `build` field of `package.json`.
Note: that bundle is built by **you**; it doesn't affect the clone-and-`npm install` workflow.

### Project layout

```
src/main/            main process
  index.js             wiring / windows / IPC
  data/                TM, history, glossary, settings, norm, atomic writes
  ocr/                 screen capture, stabilizer, mode routing, recorder, controller
  translate/           provider abstraction, DeepSeek / LM Studio, batch scheduling, VN prompt
  match/               exact hit, suspected (fuzzy) hit
src/preload/         contextBridge API
src/renderer/        main UI / overlay / picker / region frame
scripts/             offline self-tests
docs/                design notes, verification checklist, roadmap
```

See [`docs/设计说明.md`](docs/设计说明.md) (Chinese) for design details, and [`docs/验证清单.md`](docs/验证清单.md) (Chinese) for the manual on-screen acceptance checklist. See also [`docs/ROADMAP.md`](docs/ROADMAP.md), [`CHANGELOG.md`](CHANGELOG.md), and [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## ⚠️ Disclaimer

This project is intended for **personal study and self-use translation assistance**. Please respect the terms of service of any game/content you use it with, and your local laws. OCR output and machine translation are for reference only. When using third-party services such as DeepSeek, follow their terms and pay any API fees yourself. This project is entirely built using the deepseek harness.

## 📄 License

[MIT](LICENSE)
