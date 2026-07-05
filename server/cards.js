// トランプの基本処理とポーカー役判定（サーバー・クライアント共通で使える純粋関数）
// ランク: 2..10, 11=J, 12=Q, 13=K, 14=A   スート: S(♠) H(♥) D(♦) C(♣)

const SUITS = ["S", "H", "D", "C"];

function makeDeck() {
  const deck = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) deck.push({ r, s });
  }
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ブラックジャックの点数（Aは11、ただしバーストするなら1として数える）
function blackjackValue(cards) {
  let sum = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 14) { aces++; sum += 11; }
    else if (c.r >= 11) sum += 10; // J,Q,K
    else sum += c.r;
  }
  while (sum > 21 && aces > 0) { sum -= 10; aces--; }
  return sum;
}

const CAT_NAMES = [
  "ハイカード", "ワンペア", "ツーペア", "スリーカード",
  "ストレート", "フラッシュ", "フルハウス", "フォーカード", "ストレートフラッシュ",
];

// 5枚を評価して比較用スコア配列を返す（先頭ほど優先）
function evaluate5(cards) {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const suits = cards.map((c) => c.s);
  const isFlush = suits.every((s) => s === suits[0]);

  const cnt = {};
  for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
  // 出現回数が多い順、同数ならランクが高い順
  const groups = Object.keys(cnt).map(Number).sort((a, b) => (cnt[b] - cnt[a]) || (b - a));
  const counts = groups.map((r) => cnt[r]);

  // ストレート判定（5枚すべて異なるランクのとき）
  let isStraight = false;
  let straightHigh = 0;
  if (new Set(ranks).size === 5) {
    if (ranks[0] - ranks[4] === 4) { isStraight = true; straightHigh = ranks[0]; }
    else if (ranks[0] === 14 && ranks[1] === 5) { isStraight = true; straightHigh = 5; } // A-2-3-4-5
  }

  if (isStraight && isFlush) return [8, straightHigh];
  if (counts[0] === 4) return [7, ...groups];
  if (counts[0] === 3 && counts[1] === 2) return [6, ...groups];
  if (isFlush) return [5, ...ranks];
  if (isStraight) return [4, straightHigh];
  if (counts[0] === 3) return [3, ...groups];
  if (counts[0] === 2 && counts[1] === 2) return [2, ...groups];
  if (counts[0] === 2) return [1, ...groups];
  return [0, ...ranks];
}

function compareScore(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations(arr, k) {
  const res = [];
  const pick = (start, combo) => {
    if (combo.length === k) { res.push(combo.slice()); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      pick(i + 1, combo);
      combo.pop();
    }
  };
  pick(0, []);
  return res;
}

// 7枚（手札2＋場5）から最強の5枚を選び評価
function evaluate7(cards7) {
  let best = null;
  for (const combo of combinations(cards7, 5)) {
    const score = evaluate5(combo);
    if (!best || compareScore(score, best) > 0) best = score;
  }
  const cat = best[0];
  let name = CAT_NAMES[cat];
  if (cat === 8 && best[1] === 14) name = "ロイヤルストレートフラッシュ";
  return { score: best, cat, name };
}

const RANK_LABEL = { 11: "J", 12: "Q", 13: "K", 14: "A" };
function cardLabel(c) {
  const r = RANK_LABEL[c.r] || String(c.r);
  const sym = { S: "♠", H: "♥", D: "♦", C: "♣" }[c.s];
  return r + sym;
}

module.exports = {
  makeDeck, shuffle, blackjackValue,
  evaluate5, evaluate7, compareScore, cardLabel, CAT_NAMES,
};
