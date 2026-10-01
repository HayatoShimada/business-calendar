# API

## 公開（ログイン不要）

| メソッド・パス | 説明 |
|---|---|
| `GET /v1/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` | 通常の営業時間と、期間内の例外日。省略時は「7日前〜120日後」、最大400日。CORS は全オリジン許可、`Cache-Control: no-store` |
| `GET /widget.js` | 埋め込み部品（`<business-status>` / `<business-calendar>`）。5分キャッシュ |

```json
{
  "regular": { "opens": "12:00", "closes": "18:00", "closedWeekdays": [4] },
  "days": {
    "2026-10-05": { "kind": "hours", "opens": "13:30", "closes": "18:00", "note": "イベント出店のため" },
    "2026-10-07": { "kind": "closed" }
  },
  "updatedAt": "2026-10-01T08:28:58.015Z",
  "timezone": "Asia/Tokyo"
}
```

- `closedWeekdays`: 0=日曜 … 6=土曜
- 日付・時刻はお店のタイムゾーン（`timezone`）でのもの
- 判定の順序: `days` にその日があればそれを使う → なければ `closedWeekdays` に含まれる曜日は休み → それ以外は `regular` の時間で営業

## 管理（`ADMIN_HOST` のみ・Cloudflare Access のログインが必要）

| メソッド・パス | 説明 |
|---|---|
| `GET /` | 管理画面 |
| `GET /api/me` | ログイン中のメール |
| `GET /api/calendar?from=&to=` | 公開APIと同じ形式（`timezone` なし） |
| `PUT /api/days/:date` | `{ "kind": "closed", "note"? }` または `{ "kind": "hours", "opens": "13:30", "closes": "18:00", "note"? }`。メモは100文字まで |
| `DELETE /api/days/:date` | その日を通常どおりに戻す |
| `PUT /api/settings` | `{ "opens": "12:00", "closes": "18:00", "closedWeekdays": [4] }` |
| `GET /api/sync-status` | Googleマップへの反映状況（未連携 / 最終成功時刻 / エラー） |
| `POST /api/sync` | Googleマップへの反映をやり直す |

書き込みは管理画面と同じオリジンの JSON リクエストだけを受け付けます（CSRF 対策）。エラーは `{ "error": "..." }`（`LANGUAGE` の言語）で返します。
