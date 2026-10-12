@echo off
rem 一键安装 Contest Publisher 环境：KooCLI + STS SDK 依赖 + AK/SK 环境变量 + 端到端校验
rem 双击即运行；窗口执行完会停住显示结果，按回车关闭。
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-contest-publisher.ps1"
