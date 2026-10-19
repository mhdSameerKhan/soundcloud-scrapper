@echo off
title SoundCloud Scraper & Player
echo ====================================================
echo Starting SoundCloud Scraper Suite (Backend + Frontend)
echo ====================================================

start "Backend Server (Port 5000)" cmd /k "cd backend && npm start"
timeout /t 2 >nul
start "Frontend UI (Port 5173)" cmd /k "cd frontend && npm run dev"

echo.
echo Backend running at:  http://localhost:5000
echo Frontend running at: http://localhost:5173
echo.
echo Opening browser...
start http://localhost:5173
pause
