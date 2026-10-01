#!/bin/bash
# Google Cloud の無料枠（e2-micro）で tsidp を動かす起動スクリプト。
# インスタンスのメタデータ ts-authkey に Tailscale の認証キー（tag:tsidp 付き）を入れて作成する。
# 起動のたびに実行されるが、2回目以降は何もしない（tsidp は Docker が自動で再起動する）。
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

mkdir -p /opt/tsidp
cd /opt/tsidp

cat > compose.yaml <<'YAML'
services:
  tsidp:
    container_name: tsidp
    image: ghcr.io/tailscale/tsidp:latest
    restart: unless-stopped
    volumes:
      - tsidp-data:/data
    environment:
      - TAILSCALE_USE_WIP_CODE=1
      - TS_STATE_DIR=/data
      - TS_HOSTNAME=idp
      - TSIDP_USE_FUNNEL=1
      - TS_AUTHKEY=${TS_AUTHKEY:-}
volumes:
  tsidp-data:
YAML

# 認証キーは最初の登録にだけ使う（登録後は /data の状態で動く）
TS_AUTHKEY=$(curl -fs -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/ts-authkey" || true)
umask 077
printf 'TS_AUTHKEY=%s\n' "$TS_AUTHKEY" > .env

docker compose up -d
