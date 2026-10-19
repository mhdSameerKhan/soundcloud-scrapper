@echo off
title Push to GitHub
echo ========================================================
echo Pushing SoundCloud Scraper code to your repository:
echo https://github.com/mhdSameerKhan/soundcloud-scrapper
echo ========================================================
echo.
echo Staging and committing changes...
.\bin\git\cmd\git.exe add -A
.\bin\git\cmd\git.exe commit -m "Configure Vercel deployment and root build settings" || echo No new changes to commit.
echo.
echo If prompted, please sign in to GitHub in the popup window.
echo.
.\bin\git\cmd\git.exe push -u origin main
echo.
echo ========================================================
echo Push complete! Check: https://github.com/mhdSameerKhan/soundcloud-scrapper
echo ========================================================
pause
