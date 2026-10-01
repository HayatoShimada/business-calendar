// サーバーが返すメッセージ（日本語 / 英語）。言語は環境変数 LANGUAGE で選ぶ
export type Language = "ja" | "en";

const messages = {
  ja: {
    timeFormat: (label: string) => `${label}は HH:MM の形式で入力してください`,
    opensLabel: "開店時刻",
    closesLabel: "閉店時刻",
    closesAfterOpens: "閉店時刻は開店時刻より後にしてください",
    noteType: "メモは文字列で入力してください",
    noteLength: (max: number) => `メモは${max}文字以内にしてください`,
    kind: "kind は closed か hours を指定してください",
    weekdays: "定休曜日は 0〜6 の配列で指定してください",
    rangeFormat: "from / to は YYYY-MM-DD で指定してください",
    rangeOrder: "from は to 以前の日付にしてください",
    rangeLength: (max: number) => `期間は${max}日以内にしてください`,
    invalidDate: "日付が正しくありません",
    invalidJson: "JSON が正しくありません",
    googleAuth: (detail: string) => `Googleの認証に失敗しました（${detail}）`,
    googlePatch: (status: number, detail: string) => `Googleマップへの反映に失敗しました（${status}）: ${detail}`,
  },
  en: {
    timeFormat: (label: string) => `${label} must be in HH:MM format`,
    opensLabel: "Opening time",
    closesLabel: "Closing time",
    closesAfterOpens: "Closing time must be later than opening time",
    noteType: "Note must be a string",
    noteLength: (max: number) => `Note must be ${max} characters or fewer`,
    kind: "kind must be either closed or hours",
    weekdays: "Closed weekdays must be an array of 0-6",
    rangeFormat: "from / to must be YYYY-MM-DD",
    rangeOrder: "from must be on or before to",
    rangeLength: (max: number) => `The range must be ${max} days or fewer`,
    invalidDate: "Invalid date",
    invalidJson: "Invalid JSON",
    googleAuth: (detail: string) => `Google authentication failed (${detail})`,
    googlePatch: (status: number, detail: string) => `Failed to update Google Maps (${status}): ${detail}`,
  },
} satisfies Record<Language, Record<string, unknown>>;

export type Messages = (typeof messages)["ja"];

export function getMessages(language: string | undefined): Messages {
  return language === "en" ? messages.en : messages.ja;
}
