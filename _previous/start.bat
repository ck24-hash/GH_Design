@echo off
cd /d "%~dp0"
echo Voltiris LED Lab: http://localhost:8080   (close this window to stop)
start "" http://localhost:8080
where node >nul 2>nul
if %errorlevel%==0 (
  node serve.mjs 8080
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  py -m http.server 8080 --bind 127.0.0.1
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8080 --bind 127.0.0.1
  goto :eof
)
echo Install Node.js or Python 3, then run this again.
pause
