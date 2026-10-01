# SNS でのお知らせとカレンダー画像の共有

営業日を変えたら、カレンダーの画像と文面を作って X・Instagram などに投稿できます。投稿は各 OS 標準の共有のしくみ（共有シート）で行うので、**X や Instagram の API・開発者登録・費用は不要** です。

| 環境 | 使われるしくみ |
|---|---|
| iOS（Safari など） | 共有シート（Web Share API） |
| Android（Chrome など） | Android Sharesheet（Web Share API） |
| デスクトップ（Windows・macOS・ChromeOS の Chrome / Edge / Safari） | OS の共有（Web Share API） |
| 上記に対応していないブラウザ（Firefox・Linux など） | 画像を保存・文面をコピー・X の投稿画面を開く |

画像はブラウザの canvas で作ります（Cloudflare Workers の無料プランは1リクエストの CPU 時間が 10ms までで、サーバーでは画像を作れないため）。

> **X・Instagram の API を使わない理由**: X の API は 2026年2月から無料枠がなく、投稿ごとに課金されます（前払い）。Instagram の API は無料ですが、プロアカウントと Meta の開発者アプリの設定が必要です。共有シートなら追加の設定なしで、どちらにも画像付きで投稿できます。

## 管理画面: お知らせを作る

1. 日付や通常の営業時間を保存すると、上部に「まだお知らせしていない変更があります」と出る
2. 「お知らせを作る」を押す
   - **変更のお知らせ**: まだお知らせしていない変更から文面を作る（今日より前の日は除く・同じ日を何度か変えたときは最後の内容だけ）
   - **月のカレンダー**: その月のお休み・営業時間の変更をまとめた文面を作る（月は ‹ › で切り替え）
   - 画像の形: **フィード・X（4:5、1080×1350）** / **ストーリーズ（9:16、1080×1920）**
   - 文面は自由に直せます。X の文字数（日本語は2文字、URL は23文字として数える）も表示します
3. 共有する
   - **画像と文面を共有（X・LINE など）**: 共有シートで X を選ぶと、画像と文面が入った投稿画面が開く
   - **画像だけ共有（Instagram 用・文面はコピー）**: 共有シートで Instagram を選び、フィード / ストーリーズを選ぶ。キャプションにはコピー済みの文面を貼り付ける
4. 共有すると、その時点までの変更は「お知らせ済み」になります（共有シートが使えないときは「お知らせ済みにする」を押す）

保存し直しただけで内容が変わっていない日は、変更として数えません。

## サイトの訪問者: カレンダーを共有

埋め込み部品に `share` を付けると「カレンダーを共有」ボタンが出ます。表示している月の画像（4:5）とページの URL を共有シートで渡します。共有シートが使えないブラウザでは、画像を保存してリンクをコピーします。

```html
<business-calendar months="2" share></business-calendar>
```

| 属性 | 説明 |
|---|---|
| `share` | 共有ボタンを出す |
| `share-url` | 共有する URL（既定は今のページ） |
| `share-text` | 共有する文面（既定は「<店名>の営業日カレンダー」） |
| `store-name` | 画像と文面の店名（既定は `STORE_NAME`） |
| `image-font` / `image-display-font` | 画像の書体（CSS の font-family。既定はページの書体） |

画像の色は CSS 変数 `--bc-image-closed`（休業日の面）・`--bc-image-hours`（営業時間を変更した日の面）で変えられます。

## 自分のサイトで画像を作る

React などで独自に表示している場合は、Worker が配信する ES モジュールを読み込んで使えます（CORS 許可済み）。

```js
const lib = await import("https://calendar.example.com/calendar-image.js");
const data = await (await fetch("https://calendar.example.com/v1/calendar")).json();
const blob = await lib.renderCalendarImage({ data, month: "2026-10", format: "feed", storeName: "My Store", footer: "example.com", closedMark: "cat" });
const result = await lib.shareFiles({ files: [lib.toFile(blob, "calendar.png")], text: "営業日カレンダー", url: location.href });
if (result === "unsupported") lib.downloadBlob(blob, "calendar.png");
```

| 関数 | 説明 |
|---|---|
| `renderCalendarImage(options)` | 画像（Blob）を作る。`data` / `month`（YYYY-MM）/ `format`（feed・story）/ `language`（ja・en）/ `storeName` / `footer` / `closedMark`（cat・dot）/ `colors` / `fonts`（{ sans, display }）/ `type`（image/png・image/jpeg） |
| `shareFiles({ files, text, url })` | 共有シートを開く。`"shared"` / `"cancelled"` / `"unsupported"` を返す |
| `canShareFiles(files)` | ファイルを共有できるブラウザか |
| `toFile(blob, name)` / `downloadBlob(blob, name)` / `copyImage(blob)` | ファイルにする / 保存する / クリップボードにコピーする |

> 共有シートはタップの直後にしか開けません（ブラウザの制限）。画像は先に作っておき、ボタンを押したらすぐ `shareFiles` を呼んでください。[85-Store の実装例](https://github.com/HayatoShimada/85store/blob/main/components/ShareCalendarButton.tsx)

## 設定（`wrangler.jsonc` の vars）

| 変数 | 説明 |
|---|---|
| `STORE_NAME` | 文面と画像の店名 |
| `SHARE_URL` | 文面と画像に載せる URL（営業日カレンダーを載せたページ） |
| `IMAGE_CLOSED_MARK` | 画像の休業日の印（`cat` / `dot`） |
