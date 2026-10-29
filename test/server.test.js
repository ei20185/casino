// 通信サーバーを実際に起動して、WebSocketでつないで確かめるテスト
const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { startServer } = require("../server/game-server");

const PORT = 3901; // 本番(3001)とぶつからない番号

// 1人分の接続。届いたメッセージをためておき、欲しい種類が来るまで待てるようにする
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    const inbox = [];
    const waiters = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = waiters.findIndex((w) => w.type === msg.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else inbox.push(msg);
    });
    ws.on("open", () =>
      resolve({
        send: (obj) => ws.send(JSON.stringify(obj)),
        // 指定した種類のメッセージが届くまで待つ（3秒来なければ失敗にして、テストが止まらないようにする）
        next(type) {
          const i = inbox.findIndex((m) => m.type === type);
          if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`${type} が届きません`)), 3000);
            waiters.push({ type, resolve: (m) => { clearTimeout(timer); res(m); } });
          });
        },
        // 条件に合うメッセージが来るまで読み進める
        async until(type, ok) {
          for (;;) {
            const m = await this.next(type);
            if (ok(m)) return m;
          }
        },
        close: () => ws.close(),
      })
    );
    ws.on("error", reject);
  });
}

test("通信サーバー", async (t) => {
  const server = startServer({ port: PORT, dbFile: ":memory:" });
  t.after(() => server.close());

  await t.test("登録するとwelcomeが返り、チップは1000", async () => {
    const a = await connect();
    a.send({ type: "register", name: "alice", password: "pass1234" });
    const w = await a.next("welcome");
    assert.equal(w.you.name, "alice");
    assert.equal(w.you.chips, 1000);
    a.close();
  });

  await t.test("パスワードが違うとログインできない", async () => {
    const b = await connect();
    b.send({ type: "login", name: "alice", password: "wrong" });
    const e = await b.next("auth_error");
    assert.match(e.message, /違います/);
    b.close();
  });

  await t.test("ログイン前はゲームを操作できない", async () => {
    const c = await connect();
    c.send({ type: "bj_start", bet: 100 });
    c.send({ type: "register", name: "carol", password: "pass1234" });
    await c.next("welcome"); // bj_start には返事がなく、無視されている
    c.close();
  });

  await t.test("ブラックジャックの結果がDBの残高と戦績に入る", async () => {
    const d = await connect();
    d.send({ type: "register", name: "dave", password: "pass1234" });
    await d.next("welcome");
    await d.next("stats"); // ログイン直後の戦績（0件）

    d.send({ type: "bj_start", bet: 100 });
    let bj = (await d.next("bj")).state;
    if (bj.status === "playing") {
      d.send({ type: "bj_stand" });
      bj = (await d.next("bj")).state;
    }
    assert.equal(bj.status, "done");

    const { chips } = await d.next("chips");
    assert.equal(chips, 1000 + bj.delta);

    const { stats, recent } = await d.next("stats");
    assert.equal(stats.blackjack.played, 1);
    assert.equal(recent[0].delta, bj.delta);

    const row = server.db.prepare("SELECT chips FROM users WHERE name = 'dave'").get();
    assert.equal(row.chips, 1000 + bj.delta); // DBにも保存されている
    d.close();
  });

  await t.test("ポーカー：2人で勝負すると、勝った人がポットをもらい、2人とも戦績に残る", async () => {
    const p1 = await connect();
    const p2 = await connect();
    p1.send({ type: "register", name: "poker1", password: "pass1234" });
    p2.send({ type: "register", name: "poker2", password: "pass1234" });
    await p1.next("welcome");
    await p2.next("welcome");
    await p1.next("stats");
    await p2.next("stats");

    p1.send({ type: "poker_sit" });
    p2.send({ type: "poker_sit" });
    await p1.until("poker", (m) => m.state.seats.length === 2); // 2人とも座るまで待つ
    p1.send({ type: "poker_start" });
    await p1.until("poker", (m) => m.state.phase === "playing");
    p1.send({ type: "poker_action", action: "stay" });
    p2.send({ type: "poker_action", action: "fold" }); // 2人目は降りる → 1人目の勝ち

    const s1 = (await p1.next("stats")).recent[0];
    const s2 = (await p2.next("stats")).recent[0];
    assert.deepEqual([s1.result, s1.delta], ["win", 50]);   // アンティ50を払って100もらう
    assert.deepEqual([s2.result, s2.delta], ["fold", -50]);

    const rows = server.db.prepare("SELECT name, chips FROM users WHERE name LIKE 'poker%' ORDER BY name").all();
    assert.deepEqual(rows.map((r) => r.chips), [1050, 950]); // チップの合計は増えも減りもしない
    p1.close();
    p2.close();
  });

  await t.test("同じアカウントで2か所から同時にログインできない", async () => {
    const e1 = await connect();
    e1.send({ type: "register", name: "eve", password: "pass1234" });
    await e1.next("welcome");
    const e2 = await connect();
    e2.send({ type: "login", name: "eve", password: "pass1234" });
    assert.match((await e2.next("auth_error")).message, /ログイン中/);
    e1.close();
    e2.close();
  });
});
