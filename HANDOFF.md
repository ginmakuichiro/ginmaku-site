# HANDOFF — 銀幕一楼とTIMECAFE オフィシャルサイト

Claude Codeへの引き継ぎドキュメント。チャットで作ったプロトタイプを本番化し、
Cloudflare Pagesにデプロイするところまで進める。

## プロジェクト概要

- バンド「銀幕一楼とTIMECAFE」のオフィシャルサイト
- 現行のBitfanサイト（https://ginmakuichiro.bitfan.id）からの置き換え
- **会員機能なし。スケジュールとニュースの見やすさが最優先**
- 参考にした構成: https://sekumasi.com（トップに全セクション最新情報が縦に並ぶ）

## 同梱ファイル（プロトタイプ＝現状の完成形）

| ファイル | 内容 |
|---|---|
| `index.html` | サイト本体。**現状はデータをHTML内の `<script type="application/json">` に埋め込み**。デザイン・機能はこれが正 |
| `artist-photo.jpeg` | アー写。index.htmlから相対パスで参照 |
| `schedule.json` / `news.json` | 本番用データファイルのサンプル（スキーマ確定済み） |
| `SPEC.md` | 当初仕様。本ドキュメントと矛盾したらHANDOFF優先 |

## 実装済み（プロトタイプで動作確認済み）

1. **ヘッダー**: 固定ナビ（SCHEDULE / NEWS / PROFILE / VIDEO / CONTACT）
2. **アー写セクション**: 場内の闇背景＋金枠、緞帳に少し重なるレイヤー表現
3. **ヒーロー「NOW SHOWING」**: 直近の未来公演1件を半券チケット風に自動表示。
   予定ゼロなら「次回公演は近日発表」
4. **SCHEDULE**: リスト⇔カレンダーの切替
   - リスト: 未来公演を昇順、過去公演はトグルで降順表示（日付で自動振り分け）
   - カレンダー: 月グリッド自前実装、◀▶で月移動、今日マーク、
     バンド=赤塗り/ソロ=◆枠線タグ、終了公演は減light、グリッド下に月内一覧
5. **NEWS**: 日付降順、カテゴリバッジ付き
6. **PROFILE / VIDEO / CONTACT**: 骨組みのみ（プレースホルダ）
7. レスポンシブ（720px境界）、prefers-reduced-motion対応、JS構文チェック済み

## デザイントークン（変更しないこと）

- コンセプト: 名画座 × 純喫茶（「銀幕」= 映画館のメタファー）
- 色: 緞帳 `#7C2128` / 場内の闇 `#241012` / スクリーン生成り `#F4EDDD` / 金 `#B98F24` / 墨 `#26201A`
- フォント: 見出し Shippori Mincho B1 / 本文 Zen Kaku Gothic New（Google Fonts）
- シグネチャ: NOW SHOWING半券チケット（ミシン目＝dashed border、ADMIT ONE）

## データスキーマ（確定）

```jsonc
// schedule.json — 配列
{
  "date": "2026-07-25",   // ISO。未来/過去の振り分け・カレンダー配置に使用
  "title": "みなすた2周年LIVE！",
  "venue": "みなすた",
  "type": "solo",         // "band" | "solo"（銀幕一楼ソロ出演）
  "link": ""              // 任意
}

// news.json — 配列
{
  "date": "2025-11-08",
  "category": "NEWS",     // NEWS | MEDIA | RELEASE 等の自由文字列
  "title": "『銀幕EXPO』ヴィレッジヴァンガード展開！",
  "link": ""              // 任意
}
```

## やること（Claude Code側のタスク）

### 1. リポジトリ化と本番構成への変換
- [ ] リポジトリ作成（例: `ginmaku-site`）。構成案:
  ```
  /index.html
  /img/artist-photo.jpeg
  /data/schedule.json
  /data/news.json
  ```
- [ ] index.htmlの埋め込みJSONを `fetch('/data/schedule.json')` / `fetch('/data/news.json')` に置換
  （fetch失敗時のフォールバック表示も入れる。file://では動かなくなるので開発は `npx serve` 等で）
- [ ] 画像参照を `img/artist-photo.jpeg` に更新

### 2. Cloudflare Pagesデプロイ
- [ ] Pagesプロジェクト作成、GitHubリポジトリ連携（ビルド工程なし・そのまま配信）
- [ ] 独自ドメインは後日（Kentaに確認）

### 3. 更新フロー: Googleフォーム → GAS → GitHubコミット
採用案は **GAS→GitHub API方式**（静的のみで完結、Pagesが自動再デプロイ）。
- [ ] 「ライブ情報登録」フォーム: 日付/タイトル/会場/出演形態(バンド・ソロ)/リンク
- [ ] 「ニュース登録」フォーム: 日付/カテゴリ/タイトル/リンク
- [ ] GASでonFormSubmitをトリガー → 該当JSONを取得・追記 → GitHub Contents APIでコミット
- [ ] GitHubトークンはGASのスクリプトプロパティに保存（コードに直書きしない）
- 参考: 銀幕一座の経理システムで同じフォーム＋GASパターンを運用中（構成流用可）
- 削除・修正はJSON直編集でOKという運用方針（頻度低のため管理画面は作らない）

### 4. コンテンツ差し替え（Kentaに都度確認）
- [ ] プロフィール文（現状プレースホルダ）
- [ ] YouTubeチャンネルID（現状 `videoseries?list=UU` のダミー）
- [ ] お問い合わせフォームURL（現状 `https://forms.gle/XXXX`）
- [ ] フッターSNSリンク（X / YouTube / Instagram、現状 `#`）
- [ ] OGP画像・meta description・favicon

## 判断済みの方針（再確認不要）

- 会員機能・ブログCMS・DBは作らない。JSONオンリー
- カレンダーは自前実装（実装済み）。FullCalendar等のライブラリは入れない
- フレームワーク・ビルド工程なし。素のHTML/CSS/JSを維持
- スケジュールのデフォルト表示はリスト（カレンダーへの変更はKentaの指示があれば）

## 未決定・Kentaに確認すべきこと

- 独自ドメイン名
- 月刊『銀幕一座』とBLOG（旧サイトのコンテンツ）を新サイトに載せるか
- 旧Bitfanサイトの閉鎖・リダイレクトのタイミング
