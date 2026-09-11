@echo off
setlocal
title Musicful AI Studio
cd /d "%~dp0"
cls
python calistir.py
if errorlevel 1 pause
