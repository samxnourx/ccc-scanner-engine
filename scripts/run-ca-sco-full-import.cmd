@echo off
cd /d C:\Projects\ccc-scanner-engine
echo [%date% %time%] Starting full CA SCO import > C:\Projects\ccc-scanner-engine\ca-sco-import-full.log
npm.cmd run import:ca-sco -- --truncate >> C:\Projects\ccc-scanner-engine\ca-sco-import-full.log 2>&1
echo [%date% %time%] Import process exited with code %ERRORLEVEL% >> C:\Projects\ccc-scanner-engine\ca-sco-import-full.log
