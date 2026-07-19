# スケジュール管理システム セットアップ手順

Googleフォームに入力すると、オフィシャルサイトのSCHEDULEに自動反映される仕組み。
「公開日時」を指定すれば情報解禁までサイトに載らない（予約公開）。

## 1. GitHubトークンを発行する（バンドのGitHubアカウントで）

1. https://github.com/settings/personal-access-tokens/new を開く
2. Token name: `ginmaku-gas` / Expiration: **1年**（切れたら再発行）
3. Repository access: **Only select repositories** → `ginmaku-site`
4. Permissions → Repository permissions → **Contents: Read and write**
5. Generate token → 表示された `github_pat_...` をコピー（この画面でしか見られない）

## 2. GASプロジェクトを作る（バンドのGoogleアカウントで）

1. https://script.google.com → 新しいプロジェクト
2. プロジェクト名を「銀幕サイト更新」などに変更
3. `Code.gs` の中身をこのフォルダの `Code.gs` で丸ごと置き換えて保存
4. 左メニュー⚙️「プロジェクトの設定」→ スクリプト プロパティ → プロパティを追加
   - プロパティ: `GITHUB_TOKEN` / 値: 手順1でコピーしたトークン → 保存

## 3. 初回セットアップを実行

1. エディタ上部の関数選択で `setup` を選び「実行」
2. 権限の承認画面が出たら許可（「安全でないページ」警告が出たら「詳細」→「移動」）
3. 実行ログにフォームURLが2つ出る:
   - **入力用URL** … スマホのホーム画面に追加しておくと便利。メンバーに共有してもOK
   - 編集用URL … フォームの項目を直したいとき用

## 4. 動作テスト

1. 入力用URLからテスト公演を登録（公開日時は空欄）
2. 数分後に https://ginmakuichiro.net/#schedule に反映されるのを確認
3. テストデータの削除は `data/schedule.json` を直接編集（Claude Codeに頼むのが早い）

## 運用メモ

- 公開日時を入れると、その時刻を過ぎた最初のチェック（10分間隔）で自動公開
- 登録・公開のたびにGoogleアカウントのメールに通知が届く
- 修正・削除はフォームからはできない。`data/schedule.json` を直接編集する運用
