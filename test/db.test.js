// データベース（登録・ログイン・チップ・戦績）のテスト
// ":memory:" を使うので、本物の casino.db には何も書かない
const test = require("node:test");
const assert = require("node:assert/strict");
const store = require("../server/db");

function freshDb() {
  return store.openDb(":memory:");
}

test("登録すると初期チップ1000で作られる", () => {
  const db = freshDb();
  const { user, error } = store.register(db, "taro", "pass1234");
  assert.equal(error, undefined);
  assert.equal(user.name, "taro");
  assert.equal(user.chips, store.START_CHIPS);
});

test("同じ名前では登録できない", () => {
  const db = freshDb();
  store.register(db, "taro", "pass1234");
  assert.match(store.register(db, "taro", "other999").error, /すでに使われています/);
});

test("パスワードはそのまま保存しない", () => {
  const db = freshDb();
  store.register(db, "taro", "pass1234");
  const row = db.prepare("SELECT password_hash FROM users WHERE name = 'taro'").get();
  assert.notEqual(row.password_hash, "pass1234");
});

test("正しいパスワードならログインでき、違えば失敗する", () => {
  const db = freshDb();
  store.register(db, "taro", "pass1234");
  assert.equal(store.login(db, "taro", "pass1234").user.name, "taro");
  assert.ok(store.login(db, "taro", "wrong-pass").error);
  assert.ok(store.login(db, "nobody", "pass1234").error);
});

test("短すぎる名前・パスワードははじく", () => {
  const db = freshDb();
  assert.ok(store.register(db, "", "pass1234").error);
  assert.ok(store.register(db, "taro", "123").error);
});

test("勝負を記録すると、残高と戦績が両方変わる", () => {
  const db = freshDb();
  const { user } = store.register(db, "taro", "pass1234");
  store.recordGames(db, [
    { userId: user.id, gameType: "blackjack", bet: 100, result: "win", delta: 100, chipDelta: 100 },
    { userId: user.id, gameType: "blackjack", bet: 200, result: "lose", delta: -200, chipDelta: -200 },
  ]);
  assert.equal(store.getUser(db, user.id).chips, 900);
  const s = store.getStats(db, user.id).blackjack;
  assert.deepEqual(s, { played: 2, wins: 1, losses: 1, total: -100 });
  assert.equal(store.getRecentGames(db, user.id)[0].result, "lose"); // 新しい順
});

test("途中で失敗したら、それまでの書き込みも取り消される（トランザクション）", () => {
  const db = freshDb();
  const { user } = store.register(db, "taro", "pass1234");
  assert.throws(() =>
    store.recordGames(db, [
      { userId: user.id, gameType: "poker", bet: 50, result: "win", delta: 50, chipDelta: 100 },
      { userId: user.id, gameType: "poker", bet: 50, result: "lose", delta: -9999, chipDelta: -9999 }, // 残高がマイナスになる → エラー
    ])
  );
  assert.equal(store.getUser(db, user.id).chips, 1000); // 1件目も反映されていない
  assert.equal(store.getStats(db, user.id).poker.played, 0);
});

test("チップが100未満でログインすると1000に戻る", () => {
  const db = freshDb();
  const { user } = store.register(db, "taro", "pass1234");
  store.addChips(db, user.id, -950);
  assert.equal(store.login(db, "taro", "pass1234").user.chips, 1000);
});

test("ランキングはチップの多い順", () => {
  const db = freshDb();
  const a = store.register(db, "a", "pass1234").user;
  store.register(db, "b", "pass1234");
  store.addChips(db, a.id, 500);
  assert.deepEqual(store.getRankings(db).map((r) => r.name), ["a", "b"]);
});
