@echo off
rem タスクスケジューラ登録用：待ち時間を1回取得して data\local に追記する
cd /d "%~dp0"
node collect.js --dir data/local >> data\collect.log 2>&1
