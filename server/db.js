// ====================================================================
// データベース（SQLite）
//   - users : アカウント（名前・パスワードのハッシュ・チップ残高）
//   - games : 1回ごとの勝負の記録（戦績）
//   Node.js 標準の node:sqlite を使うので、追加のインストールは不要。
// ====================================================================

const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");

const START_CHIPS = 1000;
const RESCUE_LINE = 100; // ログイン時にこれ未満なら START_CHIPS に戻す（遊べなくなるのを防ぐ）

function openDb(file = "casino.db") {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      salt          TEXT    NOT NULL,
      chips         INTEGER NOT NULL DEFAULT ${START_CHIPS} CHECK (chips >= 0),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS games (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL REFERENCES users(id),
      game_type TEXT    NOT NULL CHECK (game_type IN ('blackjack', 'poker')),
      bet       INTEGER NOT NULL,
      result    TEXT    NOT NULL,  -- win / lose / push / blackjack / bust / fold
      delta     INTEGER NOT NULL,  -- チップの増減（負けはマイナス）
      played_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 「この人の戦績」を早く取り出すための索引
    CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id);
  `);
  return db;
}

// ---- パスワード（そのまま保存せず、ソルト付きハッシュにする） ----
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function validateAccountInput(name, password) {
  name = String(name || "").trim();
  password = String(password || "");
  if (name.length < 1 || name.length > 16) return { error: "名前は1〜16文字にしてください。" };
  if (password.length < 4 || password.length > 64) return { error: "パスワードは4〜64文字にしてください。" };
  return { name, password };
}

// 新規登録。成功なら { user }、失敗なら { error }
function register(db, rawName, rawPassword) {
  const v = validateAccountInput(rawName, rawPassword);
  if (v.error) return v;
  const exists = db.prepare("SELECT 1 FROM users WHERE name = ?").get(v.name);
  if (exists) return { error: "その名前はすでに使われています。" };

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(v.password, salt);
  const info = db
    .prepare("INSERT INTO users (name, password_hash, salt) VALUES (?, ?, ?)")
    .run(v.name, hash, salt);
  return { user: getUser(db, Number(info.lastInsertRowid)) };
}

// ログイン。成功なら { user }、失敗なら { error }
function login(db, rawName, rawPassword) {
  const v = validateAccountInput(rawName, rawPassword);
  if (v.error) return v;
  const row = db.prepare("SELECT * FROM users WHERE name = ?").get(v.name);
  // 「名前が違う」「パスワードが違う」を区別しない（どちらが合っているかを教えないため）
  if (!row) return { error: "名前かパスワードが違います。" };
  const hash = hashPassword(v.password, row.salt);
  const ok = crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(row.password_hash, "hex"));
  if (!ok) return { error: "名前かパスワードが違います。" };

  if (row.chips < RESCUE_LINE) {
    db.prepare("UPDATE users SET chips = ? WHERE id = ?").run(START_CHIPS, row.id);
  }
  return { user: getUser(db, row.id) };
}

function getUser(db, userId) {
  const row = db.prepare("SELECT id, name, chips FROM users WHERE id = ?").get(userId);
  return row ? { id: row.id, name: row.name, chips: row.chips } : null;
}

// ---- まとめて確実に書き込む（途中で失敗したら全部取り消す） ----
function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// チップを増減する（記録は残さない：ポーカーのアンティ先払いなどで使う）
// 戻り値：変更後の残高
function addChips(db, userId, delta) {
  db.prepare("UPDATE users SET chips = chips + ? WHERE id = ?").run(delta, userId);
  return getUser(db, userId).chips;
}

// 勝負の結果を記録する。chipDelta はこの時点で残高に足す額（アンティ先払い済みなら払い戻し分だけ）
//   records: [{ userId, gameType, bet, result, delta, chipDelta }]
// 戻り値：{ userId: 変更後の残高 }
function recordGames(db, records) {
  return transaction(db, () => {
    const insert = db.prepare(
      "INSERT INTO games (user_id, game_type, bet, result, delta) VALUES (?, ?, ?, ?, ?)"
    );
    const update = db.prepare("UPDATE users SET chips = chips + ? WHERE id = ?");
    const balances = {};
    for (const r of records) {
      insert.run(r.userId, r.gameType, r.bet, r.result, r.delta);
      if (r.chipDelta) update.run(r.chipDelta, r.userId);
      balances[r.userId] = getUser(db, r.userId).chips;
    }
    return balances;
  });
}

// 戦績（ゲームごとの回数・勝ち数・合計増減）
function getStats(db, userId) {
  const rows = db
    .prepare(`
      SELECT game_type,
             COUNT(*)                                             AS played,
             SUM(CASE WHEN delta > 0 THEN 1 ELSE 0 END)           AS wins,
             SUM(CASE WHEN delta < 0 THEN 1 ELSE 0 END)           AS losses,
             SUM(delta)                                           AS total
      FROM games
      WHERE user_id = ?
      GROUP BY game_type
    `)
    .all(userId);
  const empty = { played: 0, wins: 0, losses: 0, total: 0 };
  const stats = { blackjack: { ...empty }, poker: { ...empty } };
  for (const r of rows) {
    stats[r.game_type] = { played: r.played, wins: r.wins, losses: r.losses, total: r.total };
  }
  return stats;
}

// 最近の勝負（新しい順）
function getRecentGames(db, userId, limit = 10) {
  return db
    .prepare(`
      SELECT game_type AS gameType, bet, result, delta, played_at AS playedAt
      FROM games WHERE user_id = ?
      ORDER BY id DESC LIMIT ?
    `)
    .all(userId, limit)
    .map((r) => ({ ...r }));
}

// ランキング（ログインしていない人も含めた全員の上位）
function getRankings(db, limit = 10) {
  return db
    .prepare("SELECT name, chips FROM users ORDER BY chips DESC, id ASC LIMIT ?")
    .all(limit)
    .map((r) => ({ name: r.name, chips: r.chips }));
}

module.exports = {
  START_CHIPS, RESCUE_LINE,
  openDb, register, login, getUser, addChips, recordGames,
  getStats, getRecentGames, getRankings,
};
