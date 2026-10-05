# Business Calendar（営業日カレンダー）

[English](README.en.md)

お店の **休業日・その日だけの営業時間・通常の営業時間** をスマホから入力し、サイトのカレンダーと「営業中」表示、Googleマップの営業時間に **すぐ反映** する仕組みです。Cloudflare Workers + D1 で動き、**Cloudflare の無料枠だけ** で運用できます。

- 📅 **管理画面**: 月のカレンダーで日付をタップ →「通常どおり / 休業 / 営業時間を変更（メモ付き）」。通常の営業時間・定休曜日も設定できる
- ⚡ **再デプロイ不要**: サイトはブラウザから公開APIを読むので、保存した瞬間に反映される
- 🧩 **どんなサイトにも埋め込める**: `<script>` 1行で「営業状況」と「カレンダー」の部品（Web Components）が使える
- 🔐 **ログインは3方式から選べる**: メール / Google ログイン、登録した端末だけ（Cloudflare One）、Tailscale 内の端末だけ（tsidp）
- 📣 **SNS でお知らせ**: 変更内容から文面とカレンダー画像を作り、スマホの共有シートで X・Instagram に投稿（API・費用は不要）
- 📤 **カレンダー画像の共有**: サイトの訪問者も iOS / Android / Web それぞれ標準の共有シートで共有できる
- 🗺️ **Googleマップに自動反映**（任意）: Google Business Profile API で通常営業時間・特別営業時間を更新
- 🌏 **日本語 / 英語**、お店のタイムゾーンに対応

実際に [85-Store](https://85-store.com) で使っています。

## しくみ

```
管理者 ──▶ calendar-admin.example.com ──▶ Cloudflare Access（ログイン）──▶ Worker ──▶ D1
                                                                              └─▶ Googleマップ（任意）
サイトの訪問者 ──▶ calendar.example.com/v1/calendar（公開・GETのみ・キャッシュなし）──▶ Worker ──▶ D1
               └─▶ calendar.example.com/widget.js（埋め込み部品）
```

| ホスト | 役割 | 保護 |
|---|---|---|
| `calendar-admin.<あなたのドメイン>` | 管理画面と書き込みAPI | Cloudflare Access。Worker 側でも Access の JWT（署名・AUD・発行者）と許可メールを検証 |
| `calendar.<あなたのドメイン>` | 公開の読み取りAPIと埋め込み部品 | なし（営業日は公開情報。GET のみ） |

## 必要なもの

- Cloudflare アカウント（無料）と、Cloudflare で DNS を管理しているドメイン
- Node.js 20 以上
- 任意: Google Business Profile API の利用承認（Googleマップへの自動反映）
- 任意: Tailscale（tailnet 内の端末だけに限定したい場合）

## セットアップ

### 1. Worker をデプロイする

```bash
git clone https://github.com/HayatoShimada/business-calendar.git
cd business-calendar
npm install
npx wrangler login

npx wrangler d1 create business-calendar   # 表示された database_id を wrangler.jsonc に書く
```

`wrangler.jsonc` の `routes`・`ADMIN_HOST`・`ADMIN_EMAILS`・`TIMEZONE`・`LANGUAGE`・`STORE_NAME` を自分のものに書き換えてから:

```bash
npm run db:migrate:remote
npm run deploy
```

`https://calendar.<あなたのドメイン>/v1/calendar` で JSON が返れば OK。管理画面は手順2が終わるまで 401 になります（正常）。

> 設定ファイルをこのリポジトリの外に置きたい場合は `npx wrangler deploy --config ../my-store/wrangler.jsonc` のように `--config` を使えます（`main` と `migrations_dir` のパスは設定ファイルからの相対パス）。

### 2. 管理画面にログインを付ける（Cloudflare Access）

Cloudflare Zero Trust（無料・50ユーザーまで）で `calendar-admin.<あなたのドメイン>` を保護します。ログイン方法は次の3つから選べます。詳しい手順は **[docs/auth.md](docs/auth.md)**。

| 方式 | こんな人に | 追加のサーバー |
|---|---|---|
| **A. メール / Google ログイン** | まず動かしたい。一番かんたん | 不要 |
| **B. 登録した端末だけ（Cloudflare One）** | 店のスマホ・PCからだけ使わせたい | 不要 |
| **C. Tailscale 内の端末だけ（tsidp）** | すでに Tailscale を使っている | tsidp を常時動かす端末（[無料枠で動かす方法](docs/tsidp-hosting.md)） |

Access アプリを作ったら、`wrangler.jsonc` の `ACCESS_TEAM_DOMAIN`（例: `your-team.cloudflareaccess.com`）と `ACCESS_AUD` を設定して `npm run deploy`。

### 3. サイトに埋め込む

```html
<script src="https://calendar.example.com/widget.js" defer></script>

<!-- 営業状況（「営業中 18:00まで」「本日はお休みです」など） -->
<business-status></business-status>

<!-- 今月と来月のカレンダー -->
<business-calendar months="2"></business-calendar>
```

| 属性 | 説明 |
|---|---|
| `months` | 表示する月数（1〜6、既定 2） |
| `lang` | `ja` / `en`（既定はページの `<html lang>`） |
| `closed-mark` | 休業日の印。`cat`（丸くなった猫）か、省略で丸 |
| `src` | APIのURL（既定は widget.js を読み込んだドメイン） |
| `share` | 「カレンダーを共有」ボタンを出す（[docs/share.md](docs/share.md)） |

見た目は CSS 変数で変えられます: `--bc-ink`（文字）、`--bc-muted`（補助）、`--bc-rule`（罫線）、`--bc-surface`（空欄の面）、`--bc-closed`（休業の印）、`--bc-open-bg` / `--bc-open-ink`（営業中の表示）。部品は Shadow DOM の中にあり、`::part(status)` `::part(table)` などでも調整できます。

React / Next.js などで独自に表示したい場合は、公開API（下記）を直接読んでください。[85-Store の実装例](https://github.com/HayatoShimada/85store/blob/main/lib/business-calendar.ts) もあります。

### 4. SNS でお知らせする

管理画面の「お知らせを作る」で、変更内容（または月のまとめ）から文面とカレンダー画像（フィード 4:5 / ストーリーズ 9:16）を作り、共有シートで X・Instagram などに投稿します。詳しくは **[docs/share.md](docs/share.md)**。

### 5. （任意）Googleマップに自動反映する

保存のたびに、Googleマップの通常営業時間と特別営業時間（今日から180日先まで）を管理画面の内容に合わせます。手順は **[docs/google.md](docs/google.md)**。

### 6. （任意）保存のたびにサイトへ知らせる（webhook）

サイトがカレンダーをサーバー側でキャッシュしている場合（AI・検索向けの構造化データや llms.txt に休業日を出しているときなど）、保存のたびに知らせて、すぐ取り直してもらえます。

- `WEBHOOK_URL`（vars）: 知らせる先の URL。POST で JSON を送ります
- `WEBHOOK_SECRET`（secret。`npx wrangler secret put WEBHOOK_SECRET`）: 本文の HMAC-SHA256（16進）の署名に使います
- `WEBHOOK_SIGNATURE_HEADER`（vars、既定 `x-signature`）: 署名を入れるヘッダー名
- `WEBHOOK_BODY`（vars、任意）: 本文に足す JSON（例: `{"api":"business-calendar"}`）。本文にはほかに `event: "calendar.updated"` と `updatedAt` が入ります

送れなくても保存は止めません（サイトは自分のキャッシュの期限で取り直します）。

## 公開API

`GET https://calendar.example.com/v1/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`（省略時は「7日前〜120日後」、最大400日）

```json
{
  "regular": { "opens": "12:00", "closes": "18:00", "closedWeekdays": [4] },
  "days": {
    "2026-10-05": { "kind": "hours", "opens": "13:30", "closes": "18:00" },
    "2026-10-07": { "kind": "closed", "note": "仕入れのため" }
  },
  "updatedAt": "2026-10-01T08:28:58.015Z",
  "timezone": "Asia/Tokyo",
  "store": { "name": "My Store", "url": "https://example.com/hours", "closedMark": "cat" }
}
```

`closedWeekdays` は 0=日曜〜6=土曜。日付はお店のタイムゾーンでの日付です。CORS は全オリジン許可、`Cache-Control: no-store`。

管理API（要ログイン）は [docs/api.md](docs/api.md) を参照してください。

## 設定（`wrangler.jsonc` の vars）

| 変数 | 説明 |
|---|---|
| `ADMIN_HOST` | 管理画面のホスト名。これ以外のホストでは管理画面・書き込みAPIを出さない |
| `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` | Cloudflare Access のチームドメインとアプリの AUD タグ |
| `ADMIN_EMAILS` | 管理画面を使えるメールアドレス（カンマ区切り） |
| `TIMEZONE` | お店のタイムゾーン（IANA 名、既定 `Asia/Tokyo`） |
| `LANGUAGE` | 管理画面とメッセージの言語（`ja` / `en`） |
| `STORE_NAME` | 管理画面の見出し・お知らせ文・カレンダー画像に出す店名 |
| `SHARE_URL` | お知らせ文・カレンダー画像に載せるURL（営業日カレンダーを載せたページ） |
| `IMAGE_CLOSED_MARK` | カレンダー画像の休業日の印（`cat` / `dot`） |
| `WEBHOOK_URL` / `WEBHOOK_SIGNATURE_HEADER` / `WEBHOOK_BODY` | 任意。保存のたびに知らせる先（上の「6.」）。署名の秘密は secret の `WEBHOOK_SECRET` |

Googleマップ連携の値（`GOOGLE_CLIENT_ID` など）は secret として登録します（[docs/google.md](docs/google.md)）。

## 開発・テスト

```bash
npm test                 # 単体テスト
npm run typecheck

# ローカルで Worker を動かし、管理API・公開APIをまとめて確認
npm run db:migrate:local
node test/access-mock.mjs /tmp/tokens.json &          # テスト用の Access 鍵とトークン
npx wrangler dev --local --env-file test/dev.vars --ip 127.0.0.1 --port 8787
bash test/api-test.sh /tmp/tokens.json
```

Googleマップ連携は `test/google-mock.mjs` と `test/dev-google.vars` で、本物の Google を使わずに確認できます。

## ライセンス

[MIT](LICENSE)
