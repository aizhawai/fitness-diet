@echo off
chcp 65001 >nul
rem 一键启动：后端 + 前端 + 自动开浏览器；Ctrl+C 一次全停
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没找到 node。请先安装 Node 24 或更高版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)
node scripts\start.mjs
rem 正常关闭后窗口会一闪而过，这里停一下好看到收尾信息
echo.
pause
