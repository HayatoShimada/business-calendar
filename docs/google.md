# Googleマップ（ビジネスプロフィール）に自動反映する

管理画面で保存するたびに、Googleマップの **通常の営業時間** と **特別営業時間**（今日から180日先まで）を管理画面の内容に合わせます（[`src/google.ts`](../src/google.ts)）。設定しなければ何もしません。

> 同期を始めると、Googleマップで直接編集した特別営業時間は上書きされます。編集は管理画面に一本化してください。

## 1. Business Profile API の利用申請

Business Profile API は申請制です。[申請フォーム](https://developers.google.com/my-business/content/prereqs#request-access) から、Google Cloud のプロジェクトを指定して申請します（ビジネスプロフィールのオーナーまたは管理者で、60日以上前から確認済みのプロフィールが必要）。

Google Cloud Console の「API とサービス → 割り当て」で Business Profile 関連の API が **0 QPM → 300 QPM** になっていれば承認済みです。

## 2. API と OAuth クライアント

1. 申請したプロジェクトで次の API を有効にする
   - My Business Account Management API
   - My Business Business Information API
   - Business Profile Performance API（`/v1/insights` を使うときだけ。表示回数・ルート検索などの数値）
2. 「API とサービス → OAuth 同意画面」を設定（外部、テストユーザーにビジネスプロフィールのオーナーのアカウント）
3. 「認証情報 → OAuth クライアント ID を作成」で種類 **デスクトップ アプリ** を作る

## 3. セットアップ

ブラウザで許可 → 店舗を選ぶ → Worker の secret を登録、までを対話形式で行います。トークンなどの値は画面に表示されません。

```bash
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... TIMEZONE=Asia/Tokyo node scripts/google-setup.mjs --import
```

| オプション | 説明 |
|---|---|
| `--import` | Googleマップに今ある「今日以降の特別営業時間」（祝日の営業時間など）を管理画面に取り込む。管理画面で設定済みの日は上書きしない |
| `--config <path>` | 別の wrangler 設定ファイルを使う（設定をこのリポジトリの外に置いている場合） |

登録される secret: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `GOOGLE_LOCATION_ID`

## 4. 確認

管理画面の「Googleマップ」の欄で「今すぐ反映する」を押し、「反映済み」になること、Googleマップの特別営業時間に出ることを確認します。失敗したときは理由が表示され、「もう一度反映する」でやり直せます。

OAuth 同意画面が「テスト」のままだとリフレッシュトークンが7日で切れるので、動作確認後に「本番環境」に公開してください（自分だけが使うアプリなので審査は不要です）。

## ローカルで試す

本物の Google の代わりにテストサーバーを使えます。

```bash
node test/google-mock.mjs /tmp/google.log &
npx wrangler dev --local --env-file test/dev.vars --env-file test/dev-google.vars --ip 127.0.0.1 --port 8787
# 保存すると /tmp/google.log に Google へ送った内容が記録される
```

## 数値を CRM などに渡す（任意）

`GET /v1/insights` と `/v1/insights/keywords` で、Googleマップの表示回数・ルート検索・電話・Webクリック・
検索語句をサーバー間で読めます（[api.md](api.md)）。スコープは上と同じ `business.manage` なので再承認は不要です。

1. 上の「2.」で Business Profile Performance API を有効にする
2. 推測されない長いトークンを作り（例: `openssl rand -hex 32`）、`npx wrangler secret put INSIGHTS_TOKEN` で Worker の secret にする
3. 同じ値を呼び出す側（CRM なら `CALENDAR_INSIGHTS_TOKEN`）に設定する

`INSIGHTS_TOKEN` を消すと API は 404 に戻ります。
