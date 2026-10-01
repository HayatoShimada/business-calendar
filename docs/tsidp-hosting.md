# tsidp を無料枠で動かす

[ログイン方式 C（Tailscale 内の端末だけ）](auth.md#c-tailscale-内の端末だけtsidp) では、tsidp を **常に動かしておく** 必要があります。tsidp はとても軽く（メモリ数十MB・通信はログイン時だけ）、外から入ってくる通信のためにポートを開ける必要もありません（Tailscale の接続と Funnel はどちらも内側から外へつなぎます）。

## どこで動かすか

| 置き場所 | 費用 | 向いている人 | 注意点 |
|---|---|---|---|
| **[Google Cloud e2-micro](#google-cloud-e2-micro推奨)**（推奨） | 無料（Always Free） | 自宅に常時動く端末がない | 米国リージョンのみ（ログイン時に少し遅れるだけで問題なし）。クレジットカードの登録が必要 |
| [自宅・店の端末](#自宅店の端末) | 電気代のみ | Raspberry Pi・NAS・常時起動の PC がある | 停電・回線断の間はログインできない |
| [Oracle Cloud Always Free](#oracle-cloud-always-free) | 無料 | 東京・大阪リージョンで動かしたい | 使用率が低いと **回収される**（従量課金アカウントにすれば対象外） |
| Fly.io | 約 $2/月 | すでに Fly.io を使っている | 無料枠はない |

> **向かないもの**: Cloud Run・Cloudflare Workers などリクエストのたびに起動するサービスは、tsidp が tailnet に常時つながっていられないため使えません。Cloudflare Containers は有料プラン（$5/月〜）が必要です。

Tailscale は Personal プラン（無料）で Funnel も使えます。

---

## Google Cloud e2-micro（推奨）

Google Cloud の [Always Free](https://cloud.google.com/free/docs/free-cloud-features#compute) には、米国の3リージョン（`us-west1` オレゴン / `us-central1` アイオワ / `us-east1` サウスカロライナ）の **e2-micro 1台・標準永続ディスク 30GB・月 1GB の外向き通信** が含まれます。外部 IP アドレスも無料枠の対象です。tsidp の通信量は月 1GB よりずっと少なく収まります。

### 1. 準備

- [Google Cloud](https://console.cloud.google.com/) でプロジェクトを作り、請求先アカウントを設定（無料枠の範囲なら請求されません）
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) を入れて `gcloud auth login`、`gcloud config set project <プロジェクトID>`
- Compute Engine API を有効にする: `gcloud services enable compute.googleapis.com`
- Tailscale の認証キー（`tag:tsidp` 付き・使い捨て）を作っておく（[auth.md の C-2](auth.md#c-2-認証キーを作りtsidp-を起動する)）

### 2. インスタンスを作る

このリポジトリの [`deploy/gcp-e2-micro/startup.sh`](../deploy/gcp-e2-micro/startup.sh) が、Docker を入れて tsidp を起動します。

```bash
# 認証キーを画面に出さずに入力する
read -rs TS_AUTHKEY

gcloud compute instances create tsidp \
  --zone=us-west1-b \
  --machine-type=e2-micro \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --metadata-from-file=startup-script=deploy/gcp-e2-micro/startup.sh \
  --metadata=ts-authkey="$TS_AUTHKEY"
unset TS_AUTHKEY
```

- **`--boot-disk-type=pd-standard` を必ず付ける**（既定の pd-balanced は無料枠の対象外）
- ゾーンは上の3リージョンのどれか。マシンタイプは e2-micro 以外にしない
- 受け付けるポートを開ける必要はありません（ファイアウォールの設定は不要）

### 3. 起動を確認し、認証キーを消す

```bash
# 起動ログ（Docker のインストールに数分かかる）
gcloud compute instances get-serial-port-output tsidp --zone=us-west1-b | grep -i startup-script | tail

# tailnet に登録されたら、メタデータから認証キーを消す（以後は VM 内の状態で動く）
gcloud compute instances remove-metadata tsidp --zone=us-west1-b --keys=ts-authkey
```

Tailscale の管理コンソールに `idp` が出て、tailnet 内の端末で `https://idp.<tailnet>.ts.net` が開ければ完了です。

### 運用

- VM が再起動しても tsidp は自動で起動します（`restart: unless-stopped`）
- tsidp を更新する: `gcloud compute ssh tsidp --zone=us-west1-b -- 'cd /opt/tsidp && sudo docker compose pull && sudo docker compose up -d'`
- 予算アラート（例: 月 1 円）を設定しておくと、設定ミスで無料枠を超えたときにすぐ気づけます

---

## 自宅・店の端末

Raspberry Pi など常時動いている Linux 端末に Docker があれば、[`tsidp/compose.yaml`](../tsidp/compose.yaml) をそのまま使えます。

```bash
# compose.yaml を置いたディレクトリで
read -rs TS_AUTHKEY && printf 'TS_AUTHKEY=%s\n' "$TS_AUTHKEY" > .env && unset TS_AUTHKEY
chmod 600 .env
docker compose up -d
docker compose logs -f   # "serving" などが出たら Ctrl+C で抜けてOK（tsidp は動き続ける）
```

端末が止まっている間はログインできません（サイトの表示や公開APIには影響しません）。

---

## Oracle Cloud Always Free

Oracle Cloud の Always Free（Ampere A1 / AMD のマイクロインスタンス）は東京・大阪リージョンでも使えます。手順は「Ubuntu か Oracle Linux のインスタンスを作る → Docker を入れる → [自宅・店の端末](#自宅店の端末) と同じ」です。

ただし、Always Free のインスタンスは **7日間の CPU・ネットワーク・メモリの使用率が低いと「アイドル」として回収される** ことがあり、tsidp のような軽いサービスは対象になりやすいです。アカウントを従量課金（Pay As You Go）にアップグレードすると回収の対象外になります（Always Free の範囲なら請求はありません）。
