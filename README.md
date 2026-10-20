# usj-wait-times

USJ（ユニバーサル・スタジオ・ジャパン）のアトラクション待ち時間を表示・蓄積するダッシュボードです。ローカル版（`server.js`）と、GitHub Pages の公開版（https://yahut891-dev.github.io/usj-wait-times/ ）があります。

## 使い方

```powershell
cd usj-wait-times
node server.js
```

ブラウザで http://localhost:8787 を開きます。追加npmパッケージはありません（Node 18以降）。

- **現在**タブ: 現在の待ち時間一覧。アトラクションをクリックすると当日の推移を表示。
- **時間帯分析**タブ: 月・年・全期間を選び、時間帯（日本時間・1時間単位）ごとの平均待ち時間をヒートマップで表示。行をクリックすると、そのアトラクションの時間帯別平均をパーク全体の平均と重ねて表示。

## 公開版（GitHub Pages）

- Actions の収集ジョブが `build-public.js` で `data/cloud/` から静的JSON（`site-data/now.json`・`periods.json`・`hourly-<期間>.json`）を生成し、`index.html` と一緒に Pages へデプロイします（ブランチには生成物をコミットしません）。
- `index.html` はホスト名が `localhost` 等ならローカル版（`/api/*`）、それ以外なら公開版（`site-data/*.json`）として動きます。
- 公開版の「現在」は Actions 実行時点の値です。PC側の記録（`data/local/`）は含まれません。
- 初回のみ、リポジトリの Settings → Pages → Build and deployment の Source を「GitHub Actions」にする必要があります。
- 手元で公開版を作る場合: `node build-public.js --out _site`（`_site/` はGit管理外）。

## データ収集（2系統）

| 系統 | 保存先 | 動く条件 |
|---|---|---|
| GitHub Actions（`.github/workflows/collect.yml`） | `data/cloud/` | PCの電源に関係なく、日本時間 7:00〜23:55 に5分ごと |
| ローカル（`server.js` 起動中／`run_collect.bat` をタスクスケジューラに登録） | `data/local/`（Git管理外） | PC起動中 |

- どちらも `collect.js` で Queue-Times.com の公開API（`/parks/284/queue_times.json`、284 = USJ）を取得し、月別CSV（`YYYY-MM.csv`、列 = time(UTC), ride_id, open, wait）に追記します。
- 集計（`aggregate.js`、server.js と build-public.js で共用）では両方を読み、同じ5分枠の重複は1件にまとめます。
- 閉園後も Queue-Times に最後の値が「運営中」で残るため、最終更新から60分以上経った値は休止（open=0）として記録します。
- `server.js` は、フォルダがGitリポジトリなら1時間ごとに `git pull` して `data/cloud/` を取り込みます。
- 過去データのさかのぼり取得はできません（Queue-Times等の履歴ページはボット対策で取得不可）。記録は収集を始めた時点からです。

### 外部cronで5分ごとに実行する（cron-job.org）

GitHub の `schedule` は混雑時に後回しにされ、実行間隔が数時間空くことがあります（2026-10-20 時点で約20時間に2回）。cron-job.org（無料）から5分ごとに `workflow_dispatch` を呼び出して補います。`schedule` は予備として残します。

**1. GitHubでトークンを作成**

1. GitHub右上のアイコン → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. 次のとおり設定して Generate token
   - Token name: `cron-job-usj-wait-times`（任意）
   - Expiration: 任意（期限が切れたら作り直して cron-job.org 側を差し替える）
   - Repository access: **Only select repositories** → `usj-wait-times`
   - Permissions → Repository permissions → **Actions: Read and write**（他は変更しない）
3. 表示されたトークンを控える（再表示されません。チャット等には貼らないこと）

**2. cron-job.org でジョブを作成**

1. https://cron-job.org/ でアカウントを作成し、ダッシュボードの **CREATE CRONJOB**
2. COMMON タブ
   - Title: `usj-wait-times collect`
   - URL: `https://api.github.com/repos/yahut891-dev/usj-wait-times/actions/workflows/collect.yml/dispatches`
   - Execution schedule: Custom → 分 `*/5`（5分ごと）、時 `7-23`、タイムゾーン `Asia/Tokyo`
3. ADVANCED タブ
   - Request method: **POST**
   - Headers（4つ）
     - `Accept`: `application/vnd.github+json`
     - `Authorization`: `Bearer <1で作成したトークン>`
     - `X-GitHub-Api-Version`: `2022-11-28`
     - `Content-Type`: `application/json`
   - Request body: `{"ref":"main"}`
4. 通知設定で「実行失敗時に通知」を有効にして保存

**3. 動作確認**

- cron-job.org の TEST RUN で、応答が **204** なら成功です（401/403はトークンか権限、404はURLかトークンの対象リポジトリの誤り）。
- GitHub の Actions タブに、event が `workflow_dispatch` の実行が追加されていることを確認します。

### タスクスケジューラ登録（任意）

`run_collect.bat` を「5分ごとに繰り返し」で登録します。`server.js` 起動中と重複しても集計時にまとめられるので問題ありません。

## アトラクション名（日本語）

`names.json` に Queue-Times の ride_id → 公式日本語名を記載しています（2026-10-19 にUSJ公式サイトで確認）。未登録のIDは英語名のまま表示されるので、新アトラクション追加時は `data/*/rides.json`（英語名の台帳）を見て `names.json` に追記してください。

## 注意

- Queue-Times の利用条件として「Powered by Queue-Times.com」の表記とリンクを画面に表示しています。
- 非公式データのため、実際の待ち時間と異なる場合があります。
- GitHub Actionsの定期実行は混雑時に数分〜十数分遅れることがあります。
- ポートは環境変数 `PORT` で変更できます。
