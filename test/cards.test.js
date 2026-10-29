// トランプの処理（点数計算・役判定）のテスト
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeDeck, blackjackValue, evaluate7, compareScore } = require("../server/cards");

// "AS" → { r: 14, s: "S" } のように短く書けるようにする
const R = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
const c = (str) => ({ r: R[str[0]] || Number(str[0]), s: str[1] });
const cards = (s) => s.split(" ").map(c);

test("山札は52枚で、重複がない", () => {
  const deck = makeDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((x) => `${x.r}${x.s}`)).size, 52);
});

test("ブラックジャック：絵札は10、Aは11", () => {
  assert.equal(blackjackValue(cards("AS KH")), 21);
  assert.equal(blackjackValue(cards("QS JH")), 20);
});

test("ブラックジャック：21を超えるときはAを1として数える", () => {
  assert.equal(blackjackValue(cards("AS 9H 5D")), 15);
  assert.equal(blackjackValue(cards("AS AH 9D")), 21);
});

test("ポーカー：7枚から一番強い役を選ぶ", () => {
  const cases = [
    ["AS KS QS JS TS 2H 3D", "ロイヤルストレートフラッシュ"],
    ["9H 9D 9S 9C 2H 3D 5C", "フォーカード"],
    ["KH KD KS 4C 4H 2D 7S", "フルハウス"],
    ["2H 7H 9H JH KH 3D 4C", "フラッシュ"],
    ["AS 2H 3D 4C 5S 9H KD", "ストレート"], // A-2-3-4-5 も数える
    ["QH QD 5S 5C 9H 2D 7S", "ツーペア"],
    ["2H 4D 6S 8C TH QD AS", "ハイカード"],
  ];
  for (const [hand, name] of cases) {
    assert.equal(evaluate7(cards(hand)).name, name, hand);
  }
});

test("ポーカー：同じ役なら数字が大きいほうが勝つ", () => {
  const board = "2D 5C 9H JS 3H";
  const aces = evaluate7(cards(`AS AH ${board}`));
  const kings = evaluate7(cards(`KS KH ${board}`));
  assert.ok(compareScore(aces.score, kings.score) > 0);
});
