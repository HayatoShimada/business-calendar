-- 変更の記録（SNS などでのお知らせ文を作るため）
CREATE TABLE changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL CHECK (target IN ('day', 'regular')),
  date TEXT, -- target = 'day' のとき
  kind TEXT CHECK (kind IN ('closed', 'hours', 'default')), -- default = 通常どおりに戻した
  opens TEXT,
  closes TEXT,
  note TEXT,
  closed_weekdays TEXT, -- target = 'regular' のとき（JSON配列）
  changed_at TEXT NOT NULL,
  changed_by TEXT,
  announced_at TEXT -- お知らせ済みにした日時（まだなら NULL）
);

CREATE INDEX changes_pending ON changes (announced_at, id);
