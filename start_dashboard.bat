@echo off
REM Double-click this file to view the dashboard locally.
REM It starts a small local web server and opens the dashboard in your browser.
REM Close this black window when you are done to stop the server.
cd /d "%~dp0"
start "" "http://localhost:8000"
python -m http.server 8000
