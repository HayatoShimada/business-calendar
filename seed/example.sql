-- 例: 臨時休業とその日だけの営業時間をまとめて入れる
--   npx wrangler d1 execute DB --remote --file seed/example.sql
INSERT OR REPLACE INTO days (date, kind, opens, closes, note, updated_at, updated_by) VALUES
  ('2030-01-01', 'closed', NULL, NULL, '年始休業', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'seed'),
  ('2030-01-04', 'hours', '13:00', '17:00', '短縮営業', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'seed');
