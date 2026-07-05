// ====================================================================
// ゲームサーバー（WebSocket / TCPベースのリアルタイム通信）
//   - チャット      : 1 : n（ブロードキャスト）
//   - ポーカー卓    : n : m（複数人が同じ卓で同時に対戦）
//   - ブラックジャック: 1 : 1（プレイヤー対ディーラー＝サーバー）
//   ※ ローカル実行用。データは起動中だけメモリ上に保持します。
// ====================================================================

const { WebSocketServer } = require("ws");
const {
  makeDeck, shuffle, blackjackValue, evaluate7,
} = require("./cards");

const PORT = process.env.GAME_PORT ? Number(process.env.GAME_PORT) : 3001;
const START_CHIPS = 1000;
const POKER_ANTE = 50;
const POKER_MAX_SEATS = 6;

const wss = new WebSocketServer({ port: PORT });
const clients = new Map(); // ws -> player { id, name, chips, ws, bj }
let nextId = 1;

// ---- 共通ユーティリティ ----
function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function broadcastAll(obj) {
  for (const ws of clients.keys()) send(ws, obj);
}
function pickTalk(list) {
  return list[Math.floor(Math.random() * list.length)];
}
function findPlayerById(id) {
  for (const p of clients.values()) if (p.id === id) return p;
  return null;
}

function sendChips(player) {
  send(player.ws, { type: "chips", chips: player.chips });
}
function broadcastRankings() {
  const list = [...clients.values()]
    .map((p) => ({ name: p.name, chips: p.chips }))
    .sort((a, b) => b.chips - a.chips)
    .slice(0, 10);
  broadcastAll({ type: "rankings", list });
}
function broadcastPlayers() {
  const list = [...clients.values()].map((p) => ({ id: p.id, name: p.name, chips: p.chips }));
  broadcastAll({ type: "players", list });
}
function systemChat(text) {
  broadcastAll({ type: "chat", system: true, from: "システム", text, ts: Date.now() });
}

// ====================================================================
// ブラックジャック（1 : 1）
// ====================================================================
const BJ_TALK = {
  start: ["さあ、勝負と参りましょう！", "良い手が来ますように。", "ベット、確かに受け取りました。"],
  win: ["お見事！あなたの勝ちです。", "やりますね！チップを受け取ってください。", "完璧な引き際でした！"],
  lose: ["残念、今回は私の勝ちです。", "惜しい！次に期待しましょう。", "またの挑戦をお待ちしています。"],
  push: ["引き分けですね。チップはお返しします。", "互角の勝負でした。"],
  blackjack: ["ブラックジャック！おめでとうございます！🎉", "見事な21、配当は1.5倍です！"],
  bust: ["バースト！21を超えてしまいました。", "おっと、引きすぎましたね。"],
};

function bjStart(player, bet) {
  bet = Math.floor(Number(bet));
  if (!Number.isFinite(bet) || bet < 1) return send(player.ws, { type: "error", message: "ベット額が正しくありません。" });
  if (bet > player.chips) return send(player.ws, { type: "error", message: "チップが足りません。" });
  if (player.bj && player.bj.status === "playing") return send(player.ws, { type: "error", message: "進行中のゲームがあります。" });

  const deck = shuffle(makeDeck());
  const hand = [deck.pop(), deck.pop()];
  const dealer = [deck.pop(), deck.pop()];
  player.bj = { deck, hand, dealer, bet, status: "playing" };

  const pv = blackjackValue(hand);
  if (pv === 21) {
    // 配られた時点でブラックジャック
    const dv = blackjackValue(dealer);
    if (dv === 21) return bjResolve(player, "push");
    return bjResolve(player, "blackjack");
  }
  bjSend(player, { talk: pickTalk(BJ_TALK.start) });
}

function bjHit(player) {
  const g = player.bj;
  if (!g || g.status !== "playing") return;
  g.hand.push(g.deck.pop());
  if (blackjackValue(g.hand) > 21) return bjResolve(player, "bust");
  bjSend(player, {});
}

function bjStand(player) {
  const g = player.bj;
  if (!g || g.status !== "playing") return;
  while (blackjackValue(g.dealer) < 17) g.dealer.push(g.deck.pop());
  const pv = blackjackValue(g.hand);
  const dv = blackjackValue(g.dealer);
  if (dv > 21 || pv > dv) return bjResolve(player, "win");
  if (pv < dv) return bjResolve(player, "lose");
  return bjResolve(player, "push");
}

function bjResolve(player, result) {
  const g = player.bj;
  g.status = "done";
  g.result = result;
  let delta = 0;
  if (result === "win") delta = g.bet;
  else if (result === "blackjack") delta = Math.floor(g.bet * 1.5);
  else if (result === "lose" || result === "bust") delta = -g.bet;
  player.chips += delta;
  g.delta = delta;

  let talk;
  if (result === "win") talk = pickTalk(BJ_TALK.win);
  else if (result === "blackjack") talk = pickTalk(BJ_TALK.blackjack);
  else if (result === "push") talk = pickTalk(BJ_TALK.push);
  else if (result === "bust") talk = pickTalk(BJ_TALK.bust);
  else talk = pickTalk(BJ_TALK.lose);

  bjSend(player, { talk, revealDealer: true });
  sendChips(player);
  broadcastRankings();
}

function bjSend(player, extra) {
  const g = player.bj;
  if (!g) return;
  const reveal = g.status === "done" || extra.revealDealer;
  send(player.ws, {
    type: "bj",
    state: {
      hand: g.hand,
      dealer: reveal ? g.dealer : [g.dealer[0], { hidden: true }],
      playerValue: blackjackValue(g.hand),
      dealerValue: reveal ? blackjackValue(g.dealer) : null,
      bet: g.bet,
      status: g.status,
      result: g.result || null,
      delta: g.delta || 0,
      talk: extra.talk || null,
    },
  });
}

// ====================================================================
// ポーカー（n : m）— ショーダウン式の簡易ポーカー
//   参加者は全員アンティを払い、手札2枚＋場札5枚を見て「勝負(Stay)」か「降りる(Fold)」を選択。
//   全員の選択がそろったら役を比較し、最も強い人がポットを総取り。
// ====================================================================
const table = {
  phase: "waiting",      // waiting | playing | showdown
  seats: [],             // player.id の配列（着席）
  participants: [],      // 今ラウンドの参加者id
  hands: {},             // id -> [2枚]
  community: [],         // 場札5枚
  pot: 0,
  acted: {},             // id -> 'stay' | 'fold'
  results: null,         // showdown結果
  resetTimer: null,
};

const POKER_TALK = {
  start: ["ポーカー、スタートです！良い役を狙ってください。", "全員に手札を配りました。勝負の時間です！"],
  showdown: ["ショーダウン！手札を見せ合いましょう。", "さあ、結果を発表します！"],
};

function seatedPlayers() {
  return table.seats.map(findPlayerById).filter(Boolean);
}

function pokerSit(player) {
  if (table.seats.includes(player.id)) return;
  if (table.seats.length >= POKER_MAX_SEATS) return send(player.ws, { type: "error", message: "卓が満席です。" });
  table.seats.push(player.id);
  systemChat(`${player.name} さんがポーカー卓に着席しました。`);
  broadcastPoker();
}

function pokerLeave(player) {
  const i = table.seats.indexOf(player.id);
  if (i === -1) return;
  table.seats.splice(i, 1);
  if (table.phase === "playing" && table.participants.includes(player.id)) {
    table.acted[player.id] = "fold"; // 退席は自動フォールド
    maybeShowdown();
  }
  broadcastPoker();
}

function pokerStart(player) {
  if (table.phase !== "waiting") return send(player.ws, { type: "error", message: "ラウンドは既に進行中です。" });
  const players = seatedPlayers().filter((p) => p.chips >= POKER_ANTE);
  if (players.length < 2) return send(player.ws, { type: "error", message: "開始には参加可能な人が2人以上必要です（アンティ50）。" });

  const deck = shuffle(makeDeck());
  table.participants = [];
  table.hands = {};
  table.acted = {};
  table.pot = 0;
  for (const p of players) {
    p.chips -= POKER_ANTE;
    table.pot += POKER_ANTE;
    table.hands[p.id] = [deck.pop(), deck.pop()];
    table.participants.push(p.id);
    sendChips(p);
  }
  table.community = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
  table.phase = "playing";
  table.results = null;
  systemChat(pickTalk(POKER_TALK.start));
  broadcastPoker();
  broadcastRankings();
}

function pokerAction(player, action) {
  if (table.phase !== "playing") return;
  if (!table.participants.includes(player.id)) return;
  if (table.acted[player.id]) return; // すでに選択済み
  if (action !== "stay" && action !== "fold") return;
  table.acted[player.id] = action;
  broadcastPoker();
  maybeShowdown();
}

function maybeShowdown() {
  const allActed = table.participants.every((id) => table.acted[id]);
  if (!allActed) return;

  const contenders = table.participants.filter((id) => table.acted[id] === "stay");
  const evals = {};
  let winners = [];

  if (contenders.length === 0) {
    // 全員フォールド → アンティを参加者で山分け
    winners = table.participants.slice();
  } else {
    let bestScore = null;
    for (const id of contenders) {
      const p = findPlayerById(id);
      if (!p) continue;
      const ev = evaluate7([...table.hands[id], ...table.community]);
      evals[id] = ev;
      if (!bestScore || compareScoreArr(ev.score, bestScore) > 0) {
        bestScore = ev.score;
        winners = [id];
      } else if (compareScoreArr(ev.score, bestScore) === 0) {
        winners.push(id);
      }
    }
  }

  const share = Math.floor(table.pot / winners.length);
  const winnerInfo = [];
  for (const id of winners) {
    const p = findPlayerById(id);
    if (p) { p.chips += share; sendChips(p); }
    winnerInfo.push({ id, name: p ? p.name : "?", amount: share });
  }

  table.phase = "showdown";
  table.results = {
    winners: winnerInfo,
    evals: Object.fromEntries(Object.entries(evals).map(([id, ev]) => [id, ev.name])),
  };
  systemChat(pickTalk(POKER_TALK.showdown));
  broadcastPoker();
  broadcastRankings();

  // 数秒後に次ラウンドへ
  if (table.resetTimer) clearTimeout(table.resetTimer);
  table.resetTimer = setTimeout(() => {
    table.phase = "waiting";
    table.participants = [];
    table.hands = {};
    table.acted = {};
    table.community = [];
    table.pot = 0;
    table.results = null;
    broadcastPoker();
  }, 7000);
}

// cards.jsのcompareScoreを使用
const { compareScore: compareScoreArr } = require("./cards");

// 各クライアントに、その人の視点でポーカー卓の状態を送る（手札は本人にだけ見せる）
function broadcastPoker() {
  const reveal = table.phase === "showdown";
  for (const [ws, viewer] of clients.entries()) {
    const seats = table.seats.map((id) => {
      const p = findPlayerById(id);
      const inRound = table.participants.includes(id);
      const seat = {
        id,
        name: p ? p.name : "?",
        chips: p ? p.chips : 0,
        isYou: id === viewer.id,
        inRound,
        action: table.acted[id] || null,
      };
      // ショーダウン時は降りていない人の手札を公開
      if (reveal && inRound && table.acted[id] === "stay") {
        seat.hole = table.hands[id];
        seat.handName = table.results && table.results.evals[id] ? table.results.evals[id] : null;
      }
      if (reveal && table.results) {
        seat.isWinner = table.results.winners.some((w) => w.id === id);
      }
      return seat;
    });
    send(ws, {
      type: "poker",
      state: {
        phase: table.phase,
        pot: table.pot,
        ante: POKER_ANTE,
        community: table.community,
        seats,
        yourHole: table.participants.includes(viewer.id) ? table.hands[viewer.id] : null,
        youSeated: table.seats.includes(viewer.id),
        youActed: table.acted[viewer.id] || null,
        winners: reveal && table.results ? table.results.winners : null,
      },
    });
  }
}

// ====================================================================
// 接続ハンドラ
// ====================================================================
wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const player = clients.get(ws);

    if (msg.type === "join") {
      const name = String(msg.name || "").trim().slice(0, 16) || "ゲスト";
      const p = { id: nextId++, name, chips: START_CHIPS, ws, bj: null };
      clients.set(ws, p);
      send(ws, { type: "welcome", you: { id: p.id, name: p.name, chips: p.chips } });
      systemChat(`${name} さんが入室しました。`);
      broadcastPlayers();
      broadcastRankings();
      broadcastPoker();
      return;
    }

    if (!player) return; // join前は無視

    switch (msg.type) {
      case "chat": {
        const text = String(msg.text || "").trim().slice(0, 300);
        if (text) broadcastAll({ type: "chat", from: player.name, text, ts: Date.now() });
        break;
      }
      case "bj_start": bjStart(player, msg.bet); break;
      case "bj_hit": bjHit(player); break;
      case "bj_stand": bjStand(player); break;
      case "poker_sit": pokerSit(player); break;
      case "poker_leave": pokerLeave(player); break;
      case "poker_start": pokerStart(player); break;
      case "poker_action": pokerAction(player, msg.action); break;
      default: break;
    }
  });

  ws.on("close", () => {
    const player = clients.get(ws);
    if (!player) return;
    pokerLeave(player);
    clients.delete(ws);
    systemChat(`${player.name} さんが退室しました。`);
    broadcastPlayers();
    broadcastRankings();
    broadcastPoker();
  });
});

console.log(`🎰 ゲームサーバー起動: ws://localhost:${PORT}`);
console.log(`   通信形態 → チャット:1:n / ポーカー:n:m / ブラックジャック:1:1`);
