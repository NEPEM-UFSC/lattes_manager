@echo off
rem Publica uma nova versao: update_app v1.3.0  (opcoes: -SkipTests -Force -DryRun)
rem Detalhes em scripts\release.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\release.ps1" %*
