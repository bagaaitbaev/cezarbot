@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules\" (
  echo [1/2] npm install...
  call npm install
  if errorlevel 1 (
    echo Ошибка установки. Установите Node.js 18+ с https://nodejs.org
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy /Y ".env.example" ".env" >nul
  echo Создан файл .env — откройте его и вставьте BOT_TOKEN от @BotFather.
  start notepad ".env"
  echo Сохраните файл и снова запустите start.bat
  pause
  exit /b 0
)

echo [2/2] Запуск бота...
echo Пока это окно ОТКРЫТО — бот работает в Telegram. Закрыли окно = бот выключен.
echo Остановка: Ctrl+C
node src/index.js
if errorlevel 1 echo.
pause
