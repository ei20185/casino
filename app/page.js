"use client";

import { useEffect, useRef, useState, useCallback } from "react";

const RANK_LABEL = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const SUIT_SYM = { S: "♠", H: "♥", D: "♦", C: "♣" };
const isRed = (s) => s === "H" || s === "D";

function Card({ c, sm }) {
  if (!c || c.hidden) {
    return <div className={`card back ${sm ? "sm" : ""}`} />;
  }
  const rank = RANK_LABEL[c.r] || String(c.r);
  return (
    <div className={`card ${sm ? "sm" : ""} ${isRed(c.s) ? "red" : ""}`}>
      <div className="rank">{rank}</div>
      <div className="suit">{SUIT_SYM[c.s]}</div>
    </div>
  );
}

export default function Page() {
  const [me, setMe] = useState(null);            // {id,name,chips}
  const [nameInput, setNameInput] = useState("");
  const [view, setView] = useState("lobby");     // lobby | blackjack | poker
  const [connected, setConnected] = useState(false);
  const [lostConnection, setLostConnection] = useState(false);

  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [rankings, setRankings] = useState([]);
  const [players, setPlayers] = useState([]);

  const [bj, setBj] = useState(null);
  const [bet, setBet] = useState(100);
  const [poker, setPoker] = useState(null);

  const wsRef = useRef(null);
  const chatLogRef = useRef(null);

  const sendMsg = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  // 入室（WebSocket接続）
  const join = useCallback(() => {
    const name = nameInput.trim() || "ゲスト";
    const url = `ws://${window.location.hostname}:3001`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "join", name }));
    };
    ws.onclose = () => { setConnected(false); setLostConnection(true); };
    ws.onerror = () => { setLostConnection(true); };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case "welcome": setMe(msg.you); break;
        case "chips": setMe((m) => (m ? { ...m, chips: msg.chips } : m)); break;
        case "players": setPlayers(msg.list); break;
        case "rankings": setRankings(msg.list); break;
        case "chat": setChat((c) => [...c.slice(-150), msg]); break;
        case "bj": setBj(msg.state); break;
        case "poker": setPoker(msg.state); break;
        case "error": setChat((c) => [...c, { system: true, from: "エラー", text: msg.message, ts: Date.now() }]); break;
        default: break;
      }
    };
  }, [nameInput]);

  useEffect(() => {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [chat]);

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    sendMsg({ type: "chat", text });
    setChatInput("");
  };

  // ---------- ログイン画面 ----------
  if (!me) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>オンラインカジノ</h1>
          <div className="suits">
            <span style={{ color: "#fff" }}>♠</span>{" "}
            <span style={{ color: "var(--red)" }}>♥</span>{" "}
            <span style={{ color: "#fff" }}>♣</span>{" "}
            <span style={{ color: "var(--red)" }}>♦</span>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>架空チップ専用・換金なし／ローカル通信版</p>
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
            placeholder="ニックネームを入力"
            maxLength={16}
          />
          <button className="btn-gold" onClick={join}>入室する</button>
          <div className="comm-badges">
            <span>チャット = 1:n ブロードキャスト</span>
            <span>ポーカー = n:m リアルタイム</span>
            <span>ブラックジャック = 1:1</span>
          </div>
          <p className="note">
            ※ 別のブラウザのタブやスマホでも同じ画面を開くと、複数人で同時に遊べます（WebSocket通信）。
          </p>
        </div>
      </div>
    );
  }

  // ---------- メイン ----------
  return (
    <div className="app">
      {lostConnection && (
        <div className="disconnected">サーバーとの接続が切れました。ページを再読み込みしてください。</div>
      )}

      <div className="topbar">
        <div className="brand">🎰 オンラインカジノ <small>ローカル通信版</small></div>
        <div className="nav">
          {[["lobby", "ロビー"], ["blackjack", "ブラックジャック"], ["poker", "ポーカー"]].map(([v, label]) => (
            <button key={v} className={`btn-ghost ${view === v ? "active" : ""}`} onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="chip-badge">🪙 <b>{me.chips.toLocaleString()}</b> チップ</div>
        <div className="muted">{me.name} さん</div>
      </div>

      <div className="main">
        <div className="stage">
          {view === "lobby" && <Lobby players={players} setView={setView} />}
          {view === "blackjack" && (
            <Blackjack bj={bj} bet={bet} setBet={setBet} chips={me.chips} sendMsg={sendMsg} />
          )}
          {view === "poker" && <Poker poker={poker} sendMsg={sendMsg} />}
        </div>

        <div className="sidebar">
          <div className="chat-head">💬 チャット（全員に配信）</div>
          <div className="chat-log" ref={chatLogRef}>
            {chat.map((m, i) => (
              <div key={i} className={`chat-line ${m.system ? "sys" : ""}`}>
                {!m.system && <span className="who">{m.from}</span>}
                {m.system ? `— ${m.text}` : m.text}
              </div>
            ))}
          </div>
          <div className="chat-input">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="メッセージを入力…"
              maxLength={300}
            />
            <button className="btn-gold" onClick={sendChat}>送信</button>
          </div>
          <div className="chat-head">🏆 ランキング</div>
          <div className="rank-list">
            {rankings.length === 0 && <div className="muted">まだデータがありません</div>}
            {rankings.map((r, i) => (
              <div className="row" key={i}>
                <span>{["🥇", "🥈", "🥉"][i] || `${i + 1}`} {r.name}</span>
                <b>{r.chips.toLocaleString()}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ ロビー ============
function Lobby({ players, setView }) {
  return (
    <div>
      <div className="panel">
        <h2>ようこそ！</h2>
        <p>左上のメニューからゲームを選んで遊べます。チャットとランキングは右側に常に表示されます。</p>
        <p className="muted">
          このアプリは <b>WebSocket（TCPベースの通信）</b> で複数人がリアルタイムにつながっています。
          通信形態は3種類：チャット＝<b>1:n（ブロードキャスト）</b>、ポーカー＝<b>n:m</b>、ブラックジャック＝<b>1:1</b>。
        </p>
      </div>
      <div className="panel">
        <h2>ゲームを選ぶ</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button className="btn-gold" onClick={() => setView("blackjack")}>🃏 ブラックジャックで遊ぶ</button>
          <button className="btn-blue" onClick={() => setView("poker")}>♠ ポーカー卓に行く</button>
        </div>
      </div>
      <div className="panel">
        <h2>接続中のプレイヤー（{players.length}人）</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {players.map((p) => (
            <span key={p.id} className="chip-badge">{p.name}：{p.chips.toLocaleString()}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ ブラックジャック ============
function Blackjack({ bj, bet, setBet, chips, sendMsg }) {
  const playing = bj && bj.status === "playing";
  const done = bj && bj.status === "done";

  const resultClass =
    !done ? "" :
    (bj.result === "win" || bj.result === "blackjack") ? "result-win" :
    bj.result === "push" ? "result-push" : "result-lose";
  const resultText =
    !done ? "" :
    bj.result === "blackjack" ? "ブラックジャック！ 勝ち（配当1.5倍）" :
    bj.result === "win" ? "あなたの勝ち！" :
    bj.result === "push" ? "引き分け" :
    bj.result === "bust" ? "バースト（負け）" : "あなたの負け";

  return (
    <div className="panel">
      <h2>🃏 ブラックジャック（1 : 1 ／ 対ディーラー）</h2>

      {!playing && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
          <span>ベット額：</span>
          <input
            type="number" min={1} max={chips} value={bet}
            onChange={(e) => setBet(Number(e.target.value))}
            style={{ width: 110 }}
          />
          {[50, 100, 500].map((v) => (
            <button key={v} className="btn-ghost" onClick={() => setBet(v)}>{v}</button>
          ))}
          <button
            className="btn-gold"
            disabled={bet < 1 || bet > chips}
            onClick={() => sendMsg({ type: "bj_start", bet })}
          >
            このベットを賭ける
          </button>
        </div>
      )}

      {bj && (
        <>
          <div className="hand-row">
            <div className="label">
              ディーラー
              {bj.dealerValue != null && <span className="value-pill">合計 {bj.dealerValue}</span>}
            </div>
            <div className="cards">{bj.dealer.map((c, i) => <Card key={i} c={c} />)}</div>
          </div>
          <div className="hand-row">
            <div className="label">
              あなた <span className="value-pill">合計 {bj.playerValue}</span>
            </div>
            <div className="cards">{bj.hand.map((c, i) => <Card key={i} c={c} />)}</div>
          </div>

          {playing && (
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <button className="btn-blue" onClick={() => sendMsg({ type: "bj_hit" })}>カードを引く（ヒット）</button>
              <button className="btn-gold" onClick={() => sendMsg({ type: "bj_stand" })}>勝負する（スタンド）</button>
            </div>
          )}

          {done && (
            <div style={{ marginTop: 12 }}>
              <span className={resultClass}>{resultText}</span>
              <span className="muted" style={{ marginLeft: 12 }}>
                （チップ {bj.delta >= 0 ? "+" : ""}{bj.delta}）
              </span>
            </div>
          )}

          {bj.talk && <div className="dealer-talk">🤵 ディーラー：{bj.talk}</div>}
        </>
      )}

      {!bj && <p className="muted">ベット額を決めて「賭ける」を押すとゲームが始まります。</p>}
    </div>
  );
}

// ============ ポーカー ============
function Poker({ poker, sendMsg }) {
  if (!poker) return <div className="panel"><h2>♠ ポーカー</h2><p className="muted">読み込み中…</p></div>;

  const { phase, pot, ante, community, seats, youSeated, youActed, yourHole, winners } = poker;

  return (
    <div>
      <div className="panel">
        <h2>♠ ポーカー卓（n : m ／ 複数人リアルタイム対戦）</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          着席してアンティ（{ante}チップ）を払い、手札2枚＋場札5枚で最強の役を競います。「勝負」か「降りる」を選択 → 全員そろうと結果発表。
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          {!youSeated && <button className="btn-blue" onClick={() => sendMsg({ type: "poker_sit" })}>卓に着席する</button>}
          {youSeated && phase === "waiting" && (
            <>
              <button className="btn-gold" onClick={() => sendMsg({ type: "poker_start" })}>ラウンド開始</button>
              <button className="btn-ghost" onClick={() => sendMsg({ type: "poker_leave" })}>卓を離れる</button>
            </>
          )}
          {youSeated && phase === "playing" && yourHole && !youActed && (
            <>
              <button className="btn-gold" onClick={() => sendMsg({ type: "poker_action", action: "stay" })}>勝負する（Stay）</button>
              <button className="btn-red" onClick={() => sendMsg({ type: "poker_action", action: "fold" })}>降りる（Fold）</button>
            </>
          )}
          {youSeated && phase === "playing" && youActed && <span className="muted">他の人の選択を待っています…（あなた：{youActed === "stay" ? "勝負" : "降り"}）</span>}
          {phase === "showdown" && <span className="muted">結果発表中… まもなく次のラウンドへ</span>}
        </div>

        <div className="poker-table">
          <div className="pot">💰 ポット：{pot} チップ ／ 状態：{phase === "waiting" ? "待機中" : phase === "playing" ? "プレイ中" : "結果発表"}</div>
          <div className="community">
            {community && community.length > 0
              ? community.map((c, i) => <Card key={i} c={c} />)
              : <span className="muted">（場札はラウンド開始で公開）</span>}
          </div>
        </div>

        {yourHole && (
          <div className="hand-row">
            <div className="label">あなたの手札</div>
            <div className="cards">{yourHole.map((c, i) => <Card key={i} c={c} />)}</div>
          </div>
        )}

        <h2 style={{ fontSize: 16 }}>着席者</h2>
        <div className="seats">
          {seats.length === 0 && <span className="muted">まだ誰も着席していません。</span>}
          {seats.map((s) => (
            <div key={s.id} className={`seat ${s.isYou ? "you" : ""} ${s.isWinner ? "winner" : ""}`}>
              <div className="name">
                {s.name}{s.isYou && "（あなた）"}
                {s.isWinner && <span className="tag tag-stay">WIN</span>}
                {!s.isWinner && phase === "playing" && s.inRound && (
                  <span className={`tag ${s.action === "stay" ? "tag-stay" : s.action === "fold" ? "tag-fold" : "tag-wait"}`}>
                    {s.action === "stay" ? "勝負" : s.action === "fold" ? "降り" : "選択中"}
                  </span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>🪙 {s.chips.toLocaleString()}</div>
              {s.hole && (
                <div className="cards" style={{ marginTop: 6 }}>
                  {s.hole.map((c, i) => <Card key={i} c={c} sm />)}
                </div>
              )}
              {s.handName && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>役：{s.handName}</div>}
            </div>
          ))}
        </div>

        {winners && winners.length > 0 && (
          <div className="dealer-talk" style={{ marginTop: 14 }}>
            🏆 勝者：{winners.map((w) => `${w.name}（+${w.amount}）`).join("、")}
          </div>
        )}
      </div>
    </div>
  );
}
