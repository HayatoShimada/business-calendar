# 管理画面のログイン（Cloudflare Access）

管理画面 `calendar-admin.<あなたのドメイン>` は Cloudflare Access で保護します。Cloudflare Zero Trust は **50ユーザーまで無料** です。ログイン方法は次の3つから選べます（組み合わせも可）。

| 方式 | 誰がログインできるか | 追加のサーバー | 手間 |
|---|---|---|---|
| [A. メール / Google ログイン](#a-メール--google-ログイン) | 許可したメールアドレスの人（どの端末からでも） | 不要 | ★ |
| [B. 登録した端末だけ（Cloudflare One）](#b-登録した端末だけcloudflare-one) | 許可した人が、登録した端末を使っているときだけ | 不要 | ★★ |
| [C. Tailscale 内の端末だけ（tsidp）](#c-tailscale-内の端末だけtsidp) | 許可した人が、tailnet に入っている端末を使っているときだけ | tsidp を動かす端末（[無料枠で動かす](tsidp-hosting.md)） | ★★★ |

どの方式でも、Worker 側で Access の JWT（署名・AUD・発行者）と `ADMIN_EMAILS` を検証するので、Access の設定ミスがあっても許可していない人は書き込めません。

---

## 共通: Access アプリを作る

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) を開く（初回はチーム名を決める。Free プランを選ぶ）
2. **Access → Applications → Add an application → Self-hosted**
   - Application domain: `calendar-admin.<あなたのドメイン>`
   - Identity providers: 使うログイン方法だけにチェック（1つなら Instant Auth をオン）
   - Policy: Action **Allow**、Include → **Emails** → 管理者のメールアドレス
3. 作成後、アプリの **Application Audience (AUD) Tag** をコピー
4. `wrangler.jsonc` の `ACCESS_TEAM_DOMAIN`（`<チーム名>.cloudflareaccess.com`）と `ACCESS_AUD` に書いて `npm run deploy`

---

## A. メール / Google ログイン

一番かんたんな方法です。サーバーは要りません。

- **メールのワンタイムコード**: Zero Trust → Settings → Authentication → Login methods に最初から入っている **One-time PIN** を使う。ログイン時にメールで届く6桁のコードを入力します
- **Google ログイン**: Login methods → Add new → **Google**。画面の案内に沿って Google Cloud で OAuth クライアントを作り、Client ID / Secret を入れる

Access アプリの Identity providers でどちらか（または両方）にチェックし、Policy の Include → Emails に管理者のアドレスを入れれば完了です。

---

## B. 登録した端末だけ（Cloudflare One）

店のスマホ・PCなど、**登録した端末からだけ** ログインできるようにします。端末に Cloudflare One クライアント（旧 WARP）を入れ、Access のポリシーで「その端末であること」を必須にします。サーバーは要りません。

1. **端末の登録を許可する**: Zero Trust → Settings → WARP Client → Device enrollment permissions → Policy で、管理者のメールアドレスを Allow
2. **端末にクライアントを入れる**: 各端末に [Cloudflare One クライアント](https://developers.cloudflare.com/cloudflare-one/connections/connect-devices/warp/download-warp/) を入れ、チーム名でログイン（A の方法でメール確認）
3. **端末のチェックを作る**: Settings → WARP Client → Device posture → Add new
   - **WARP**（Cloudflare One クライアントが接続中であること）を追加する
   - さらに絞るなら **Serial number list**（登録した端末のシリアル番号）など
4. **Access のポリシーに足す**: 管理画面の Access アプリの Policy に **Require → Device posture** で 3 のチェックを追加
5. ログイン方法は A（メール / Google）のまま。「メールが正しい」かつ「登録した端末」でないと入れません

> **Tailscale など他の VPN と一緒に使う場合**: Cloudflare One クライアントには、通信を経由させず端末の情報だけを送る **Posture only（Device information only）モード** があります（Settings → WARP Client → Device settings → Service mode）。このモードではほかの VPN と同時に使えますが、通信が Cloudflare を通らないため「WARP」のチェックは通りません。Serial number list など端末の情報で判定するチェックを使ってください。組み合わせによって動きが変わるので、導入前に一度ご自身の端末で確認してください。

---

## C. Tailscale 内の端末だけ（tsidp）

すでに Tailscale を使っているなら、**tailnet に入っている端末からだけ** ログインできるようにできます。Tailscale の ID でログインする OIDC プロバイダー [tsidp](https://github.com/tailscale/tsidp) を動かし、Cloudflare Access のログイン方法にします。

```
管理者の端末（tailnet 内）→ calendar-admin → Cloudflare Access → https://idp.<tailnet>.ts.net/authorize（tailnet 内からしか開けない）
                                                   ↑ トークン交換だけ Funnel 経由で Cloudflare から届く
```

**なぜ tailnet の外からはログインできないか**: tsidp は Funnel（インターネット）経由の `/authorize` を "not allowed over funnel" で拒否します（[`server/authorize.go`](https://github.com/tailscale/tsidp/blob/main/server/authorize.go)）。ログイン画面は tailnet 内からしか開けず、Cloudflare からのトークン交換（`/token`）だけが Funnel を通ります。

tsidp は常に動いている必要があります。自宅の端末（Raspberry Pi など）か、クラウドの無料枠で動かします → **[tsidp を無料枠で動かす](tsidp-hosting.md)**

### C-1. Tailscale の ACL

管理コンソール → Access controls に追加します（既存の設定は残す。`grants` がすでにあれば中身を足す）。

```jsonc
"tagOwners": {
  "tag:tsidp": ["autogroup:admin"],
},
"nodeAttrs": [
  // tsidp を Funnel で公開できるようにする（Cloudflare がトークンを取りに来るため）
  { "target": ["tag:tsidp"], "attr": ["funnel"] },
],
"grants": [
  {
    // tsidp の管理画面（クライアント登録）を管理者だけに許可
    "src": ["you@example.com"],
    "dst": ["tag:tsidp"],
    "app": { "tailscale.com/cap/tsidp": [{ "allow_admin_ui": true }] },
  },
],
```

### C-2. 認証キーを作り、tsidp を起動する

管理コンソール → Settings → Keys → **Generate auth key**。Tags に `tag:tsidp` を付けます（使い捨て・有効期限ありで OK。最初の登録にだけ使います）。

起動方法は [tsidp-hosting.md](tsidp-hosting.md)。tailnet 内の端末で `https://idp.<tailnet>.ts.net` を開き、tsidp の画面が出れば OK です（証明書の発行に数分かかることがあります）。

### C-3. Cloudflare 用のクライアントを登録

tsidp の管理画面で新しいクライアントを追加します。

- 名前: `Cloudflare Access`
- Redirect URI: `https://<チーム名>.cloudflareaccess.com/cdn-cgi/access/callback`

表示された **Client ID / Client Secret** を控えます。

### C-4. Cloudflare にログイン方法を追加

Zero Trust → Settings → Authentication → Login methods → Add new → **OpenID Connect**

| 項目 | 値 |
|---|---|
| Name | `Tailscale` |
| App ID / Client secret | C-3 で控えた値 |
| Auth URL | `https://idp.<tailnet>.ts.net/authorize` |
| Token URL | `https://idp.<tailnet>.ts.net/token` |
| Certificate URL | `https://idp.<tailnet>.ts.net/.well-known/jwks.json` |
| PKCE | オフ |
| Email claim | `email` |
| OIDC Claims（scopes） | `openid` `email` `profile` |

「Test」で tsidp のログインが通ることを確認します（tailnet 内の端末で）。Access アプリの Identity providers を **Tailscale だけ** にします。

### C-5. 確認

- tailnet 内の管理者の端末 → Tailscale でログイン → 管理画面が出る
- Tailscale を切った端末 → tsidp のログインが「not allowed over funnel」で拒否される
- 別の Tailscale ユーザー → Access のポリシーで拒否される
