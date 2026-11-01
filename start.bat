@echo off
chcp 65001 >nul
rem Запуск лабораторной №5 двойным щелчком: mock-сервер и клиент в двух окнах.
rem Используется npm.cmd, поэтому ограничение PowerShell на запуск скриптов не мешает.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js 22 LTS с https://nodejs.org и запустите снова.
  pause
  exit /b 1
)

if not exist "client\node_modules" (
  echo Первый запуск: устанавливаю зависимости клиента...
  pushd client
  call npm.cmd install
  if errorlevel 1 (
    popd
    echo Не удалось установить зависимости. Проверьте интернет и запустите снова.
    pause
    exit /b 1
  )
  popd
)

start "mock-server :3000" cmd /k "cd /d ""%~dp0mock-server"" && node server.js"
start "client :5173" cmd /k "cd /d ""%~dp0client"" && npm.cmd run dev"

echo Жду запуска клиента...
timeout /t 4 /nobreak >nul
start "" http://localhost:5173

echo.
echo Сервер: http://localhost:3000/api/courses
echo Клиент: http://localhost:5173
echo Чтобы остановить, закройте два открывшихся окна.
