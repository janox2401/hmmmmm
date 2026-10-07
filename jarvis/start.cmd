@echo off
rem Startet Jarvis OS und oeffnet den Browser auf http://127.0.0.1:4711
cd /d "%~dp0"
node server.mjs --open
pause
