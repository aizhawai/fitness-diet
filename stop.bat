@echo off
chcp 65001 >nul
rem 停掉 start.bat 拉起的整套服务（窗口找不到也能停）
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没找到 node。请先安装 Node 24 或更高版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)
node scripts\stop.mjs
echo.
pause
