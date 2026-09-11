@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

title OCR 翻译记忆库 v2 启动器

:: ---------------------------------------------------------------
:: 一键启动：双击本文件即可。
::   - 已装好依赖 -> 直接启动
::   - 未装依赖   -> 自动执行 npm install（需已安装 Node.js）
:: ---------------------------------------------------------------

:: 某些环境（如自动化工具）会预设该变量，会让 electron 变成纯 Node 模式，须清掉。
set "ELECTRON_RUN_AS_NODE="

set "EXE=%~dp0node_modules\electron\dist\electron.exe"

:: 1) 检查 Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [错误] 没有检测到 Node.js。
  echo.
  echo 请先安装 Node.js（建议 LTS 版）：https://nodejs.org/
  echo 安装后重新双击本文件即可。
  echo.
  pause
  exit /b 1
)

:: 2) 首次运行自动安装依赖
if not exist "%EXE%" (
  echo [1/2] 首次运行，正在下载依赖（Electron，约 100MB）...
  echo       首次可能需要几分钟，请耐心等待。
  echo.
  set "NODE_OPTIONS=--use-system-ca"
  call npm install --no-audit --no-fund
  if not exist "%EXE%" (
    echo.
    echo 首次安装失败，尝试关闭证书校验后重试...
    if exist "node_modules" rmdir /s /q "node_modules"
    set "NODE_OPTIONS="
    set "NODE_TLS_REJECT_UNAUTHORIZED=0"
    call npm install --no-audit --no-fund
  )
  if not exist "%EXE%" (
    echo.
    echo [错误] 依赖安装失败。请检查网络 / 代理后重试，或手动执行：
    echo     npm config set strict-ssl false
    echo     npm install
    echo.
    pause
    exit /b 1
  )
  echo.
  echo 依赖安装完成。
  echo.
)

:: 3) 启动
echo [2/2] 正在启动 OCR 翻译记忆库 v2 ...
start "" "%EXE%" "%~dp0"
exit /b 0
