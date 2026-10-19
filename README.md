# usj-wait-times

USJ（ユニバーサル・スタジオ・ジャパン）のアトラクション待ち時間を表示・蓄積するローカルダッシュボードです（個人利用向け）。

## 使い方

```powershell
cd usj-wait-times
node server.js
```

ブラウザで http://localhost:8787 を開きます。追加npmパッケージはありません（Node 18以降）。

- **現在**タブ: 現在の待ち時間一覧。アトラクションをクリックすると当日の推移を表示。
- **時間帯分析**タブ: 月・年・全期間を選び、時間帯（日本時間・1時間単位）ごとの平均待ち時間をヒートマップで表示。行をクリックすると、そのアトラクションの時間帯別平均をパーク全体の平均と重ねて表示。

## データ収集（2系統）

| 系統 | 保存先 | 動く条件 |
|---|---|---|
| GitHub Actions（`.github/workflows/collect.yml`） | `data/cloud/` | PCの電源に関係なく、日本時間 7:00〜23:55 に5分ごと |
| ローカル（`server.js` 起動中／`run_collect.bat` をタスクスケジューラに登録） | `data/local/`（Git管理外） | PC起動中 |

- どちらも `collect.js` で Queue-Times.com の公開API（`/parks/284/queue_times.json`、284 = USJ）を取得し、月別CSV（`YYYY-MM.csv`、列 = time(UTC), ride_id, open, wait）に追記します。
- 集計時は両方を読み、同じ5分枠の重複は1件にまとめます。
- `server.js` は、フォルダがGitリポジトリなら1時間ごとに `git pull` して `data/cloud/` を取り込みます。
- 過去データのさかのぼり取得はできません（Queue-Times等の履歴ページはボット対策で取得不可）。記録は収集を始めた時点からです。

### タスクスケジューラ登録（任意）

`run_collect.bat` を「5分ごとに繰り返し」で登録します。`server.js` 起動中と重複しても集計時にまとめられるので問題ありません。

## アトラクション名（日本語）

`names.json` に Queue-Times の ride_id → 公式日本語名を記載しています（2026-10-19 にUSJ公式サイトで確認）。未登録のIDは英語名のまま表示されるので、新アトラクション追加時は `data/*/rides.json`（英語名の台帳）を見て `names.json` に追記してください。

## 注意

- Queue-Times の利用条件として「Powered by Queue-Times.com」の表記とリンクを画面に表示しています。
- 非公式データのため、実際の待ち時間と異なる場合があります。
- GitHub Actionsの定期実行は混雑時に数分〜十数分遅れることがあります。
- ポートは環境変数 `PORT` で変更できます。
