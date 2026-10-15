@echo off
chcp 65001 >nul
rem 首次配置：装依赖 + 建 .env + 引导填 LLM 配置
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没找到 node。请先安装 Node 24 或更高版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)
node scripts\setup.mjs
echo.
pause
