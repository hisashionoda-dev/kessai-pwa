/**
 * 決裁アプリ PWA
 * スワイプで承認/差し戻し。バックエンド接続対応版。
 *
 * 環境変数 (Vite想定):
 *   VITE_API_URL  = バックエンドのURL (例: https://kessai.railway.app)
 *   VITE_USER_ID  = ログインユーザーのSlack ID (認証実装までの暫定)
 */
import { useState, useRef, useEffect, useCallback } from "react";

// ── 設定 ─────────────────────────────────────────────────────────
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";
const MY_USER_ID = import.meta.env.VITE_USER_ID || "U_DEMO";

// デモ用モックデータ（APIが繋がらないときのフォールバック）
const MOCK_APPROVALS = [
  { id: "demo-1", type: "経費精算",  requester: "田中 太郎", initials: "田", color: "#6366f1", amount: "¥12,500", title: "クライアント接待費（渋谷 焼肉屋）", detail: "3名参加・領収書添付あり", deadline: "2026/3/25", urgency: "通常", createdAt: "2026/3/20" },
  { id: "demo-2", type: "発注承認",  requester: "佐藤 花子", initials: "佐", color: "#ec4899", amount: "¥85,000", title: "Figma 年間ライセンス更新（5席）",     detail: "更新期限：2026/3/31",           deadline: "2026/3/31", urgency: "急ぎ",  createdAt: "2026/3/21" },
  { id: "demo-3", type: "出張申請",  requester: "鈴木 一郎", initials: "鈴", color: "#f59e0b", amount: "¥45,000", title: "東京→大阪 日帰り出張（新幹線）",   detail: "〇〇社様 定例打ち合わせ",       deadline: "",          urgency: "通常", createdAt: "2026/3/25" },
  { id: "demo-4", type: "採用承認",  requester: "山本 美咲", initials: "山", color: "#10b981", amount: "—",       title: "エンジニア採用（最終面接通過者）", detail: "内定承諾返答期限：3/24",        deadline: "2026/3/24", urgency: "急ぎ",  createdAt: "2026/3/22" },
  { id: "demo-5", type: "経費精算",  requester: "中村 健",   initials: "中", color: "#0ea5e9", amount: "¥3,200",  title: "書籍購入費（技術書2冊）",         detail: "社内共有図書として登録予定",     deadline: "",          urgency: "通常", createdAt: "2026/3/19" },
];

const INITIAL_MAP = { 田: "#6366f1", 佐: "#ec4899", 鈴: "#f59e0b", 山: "#10b981", 中: "#0ea5e9" };
const COLORS = ["#6366f1","#ec4899","#f59e0b","#10b981","#0ea5e9","#f43f5e","#8b5cf6","#14b8a6"];
let colorIdx = 0;
function colorFor(key) {
  if (!INITIAL_MAP[key]) INITIAL_MAP[key] = COLORS[colorIdx++ % COLORS.length];
  return INITIAL_MAP[key];
}

// テキストからカード表示用にパース
function parseApproval(raw) {
  const first = raw.requester || "";
  const initials = first.charAt(0) || "?";
  // 構造化フィールドを優先、なければ text を改行分割してフォールバック
  const lines = (raw.text || "").split("\n").filter(Boolean);
  return {
    ...raw,
    initials,
    color: colorFor(initials),
    amount: raw.amount || "—",
    title: raw.title || lines[0] || "（タイトルなし）",
    detail: raw.detail || lines[1] || "",
    deadline: raw.deadline || "",
    other: raw.other || "",
    urgency: raw.urgency || "通常",
    date: raw.createdAt ? raw.createdAt.slice(0, 10) : "",
    requester: raw.requester || "不明",
  };
}

const THRESHOLD = 80;
const font = "'Helvetica Neue', Arial, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif";

// ── サブコンポーネント ──────────────────────────────────────────
function Avatar({ initials, color, size = 52 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: size * 0.38, fontWeight: 700, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

function HistoryItem({ item }) {
  const ok = item.action === "approved";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #1e293b" }}>
      <Avatar initials={item.initials} color={item.color} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.requester}・{item.title || "決裁依頼"}
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>{item.amount !== "—" ? item.amount : "金額なし"}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: ok ? "#22c55e" : "#ef4444", background: ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)", padding: "4px 10px", borderRadius: 20, flexShrink: 0 }}>
        {ok ? "✓ 承認" : "✕ 差戻"}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "80px 0" }}>
      <div style={{ width: 40, height: 40, border: "3px solid #1e293b", borderTop: "3px solid #fbbf24", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <div style={{ color: "#475569", fontSize: 14 }}>承認案件を読み込み中…</div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── メインコンポーネント ───────────────────────────────────────
export default function App() {
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(0);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState([]);
  const [animating, setAnimating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDemo, setIsDemo] = useState(false);
  const startX = useRef(null);
  const startY = useRef(null);
  const isHorizontal = useRef(null); // null=未判定, true=横, false=縦

  // API からデータ取得
  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/approvals`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setQueue(data.map(parseApproval));
      setIsDemo(false);
    } catch {
      setQueue(MOCK_APPROVALS.map(parseApproval));
      setIsDemo(true);
    } finally {
      setLoading(false);
      setIndex(0);
    }
  }, []);

  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("approval");
    if (target && queue.length > 0) {
      const idx = queue.findIndex((a) => a.id === target);
      if (idx > 0) setIndex(idx);
    }
  }, [queue]);

  const card = queue[index];
  const remaining = Math.max(0, queue.length - index);
  const allDone = !loading && index >= queue.length;

  const onStart = (clientX, clientY) => {
    if (animating || allDone) return;
    startX.current = clientX;
    startY.current = clientY;
    isHorizontal.current = null;
    setDragging(true);
  };

  const onMove = (clientX, clientY, e) => {
    if (!dragging || startX.current === null) return;
    const deltaX = clientX - startX.current;
    const deltaY = clientY - startY.current;

    // 最初の動きで方向を確定
    if (isHorizontal.current === null) {
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        isHorizontal.current = Math.abs(deltaX) >= Math.abs(deltaY);
      }
    }

    if (isHorizontal.current) {
      // 横スワイプ → カード移動、スクロールをブロック
      e?.preventDefault();
      setDx(deltaX);
    }
    // 縦方向の場合は何もしない（ネイティブスクロールに任せる）
  };

  const onEnd = () => {
    if (!dragging) return;
    setDragging(false);
    if (isHorizontal.current && Math.abs(dx) >= THRESHOLD) {
      triggerSwipe(dx > 0 ? "approved" : "rejected");
    } else {
      setDx(0);
    }
    startX.current = null;
    startY.current = null;
    isHorizontal.current = null;
  };

  const triggerSwipe = async (action) => {
    if (animating || !card) return;
    setAnimating(true);
    setDx(action === "approved" ? 700 : -700);

    if (!isDemo) {
      try {
        await fetch(`${API_URL}/api/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ approvalId: card.id, action, decidedBy: MY_USER_ID }),
        });
      } catch {
        console.warn("API送信失敗（オフライン？）");
      }
    }

    setTimeout(() => {
      setHistory((h) => [{ ...card, action }, ...h]);
      setIndex((i) => i + 1);
      setDx(0);
      setAnimating(false);
    }, 320);
  };

  const approveAlpha = Math.min(1, Math.max(0, dx / THRESHOLD));
  const rejectAlpha  = Math.min(1, Math.max(0, -dx / THRESHOLD));
  const cardGlow =
    dx > 20  ? `0 0 50px rgba(34,197,94,${approveAlpha * 0.6}), 0 24px 60px rgba(0,0,0,0.5)` :
    dx < -20 ? `0 0 50px rgba(239,68,68,${rejectAlpha * 0.6}), 0 24px 60px rgba(0,0,0,0.5)` :
               "0 24px 60px rgba(0,0,0,0.5)";

  return (
    <div
      style={{ maxWidth: 390, margin: "0 auto", minHeight: "100vh", background: "#0b1120", fontFamily: font, userSelect: "none", WebkitUserSelect: "none" }}
      onMouseMove={(e) => { if (dragging) onMove(e.clientX, e.clientY, e); }}
      onMouseUp={onEnd}
      onMouseLeave={onEnd}
    >
      {/* ── ヘッダー ── */}
      <div style={{ padding: "22px 22px 10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ color: "white", fontSize: 22, fontWeight: 800, letterSpacing: "-0.5px", display: "flex", alignItems: "center", gap: 8 }}>
            <span>⚡</span> 決裁
          </div>
          <div style={{ color: "#475569", fontSize: 12, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: isDemo ? "#f59e0b" : "#22c55e", display: "inline-block", boxShadow: isDemo ? "0 0 6px #f59e0b" : "0 0 6px #22c55e" }} />
            {isDemo ? "デモモード（APIオフライン）" : "#dotd_kessai をウォッチ中"}
          </div>
        </div>
        {!loading && !allDone && (
          <div style={{ background: "#1e293b", borderRadius: 20, padding: "6px 16px", display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>残り <span style={{ color: "#fbbf24", fontWeight: 700 }}>{remaining}</span> 件</span>
          </div>
        )}
      </div>

      {/* ── ローディング ── */}
      {loading && <Spinner />}

      {/* ── 全件完了 ── */}
      {!loading && allDone && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 22px 24px" }}>
          <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(34,197,94,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, marginBottom: 20 }}>🎉</div>
          <div style={{ color: "white", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>すべて完了！</div>
          <div style={{ color: "#64748b", fontSize: 14, marginBottom: 32, textAlign: "center" }}>承認待ちの案件はありません</div>
          <div style={{ display: "flex", gap: 12, marginBottom: 32 }}>
            <div style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 12, padding: "12px 20px", textAlign: "center" }}>
              <div style={{ color: "#22c55e", fontSize: 24, fontWeight: 800 }}>{history.filter((h) => h.action === "approved").length}</div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>承認</div>
            </div>
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 20px", textAlign: "center" }}>
              <div style={{ color: "#ef4444", fontSize: 24, fontWeight: 800 }}>{history.filter((h) => h.action === "rejected").length}</div>
              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>差戻</div>
            </div>
          </div>
          {history.length > 0 && (
            <>
              <div style={{ color: "#475569", fontSize: 11, fontWeight: 600, marginBottom: 8, alignSelf: "flex-start", letterSpacing: 1 }}>処理履歴</div>
              <div style={{ width: "100%" }}>{history.map((item, i) => <HistoryItem key={i} item={item} />)}</div>
            </>
          )}
          <button onClick={fetchApprovals} style={{ marginTop: 32, background: "#1e293b", color: "#94a3b8", border: "none", borderRadius: 12, padding: "12px 28px", fontSize: 13, cursor: "pointer", fontFamily: font }}>
            ↺ 再読み込み
          </button>
        </div>
      )}

      {/* ── カードとボタン ── */}
      {!loading && !allDone && card && (
        <>
          <div style={{ padding: "4px 22px 0", position: "relative" }}>
            {/* スタック影（高さを動的にするためabsoluteではなくdecorative） */}
            {queue[index + 2] && (
              <div style={{ position: "absolute", left: "10%", right: "10%", top: 16, bottom: -8, background: "#1a2744", borderRadius: 24, zIndex: 1 }} />
            )}
            {queue[index + 1] && (
              <div style={{ position: "absolute", left: "5%", right: "5%", top: 8, bottom: -4, background: "#1e2f52", borderRadius: 24, zIndex: 2 }} />
            )}

            {/* メインカード */}
            <div
              onMouseDown={(e) => { e.preventDefault(); onStart(e.clientX, e.clientY); }}
              onTouchStart={(e) => onStart(e.touches[0].clientX, e.touches[0].clientY)}
              onTouchMove={(e) => onMove(e.touches[0].clientX, e.touches[0].clientY, e)}
              onTouchEnd={onEnd}
              style={{
                position: "relative", zIndex: 10,
                background: dx > 20  ? `linear-gradient(135deg, rgba(34,197,94,${approveAlpha * 0.14}) 0%, #fff 50%)` :
                            dx < -20 ? `linear-gradient(225deg, rgba(239,68,68,${rejectAlpha * 0.14}) 0%, #fff 50%)` : "#fff",
                borderRadius: 24,
                cursor: dragging ? "grabbing" : "grab",
                transform: `translateX(${dx}px) rotate(${dx * 0.035}deg)`,
                transition: dragging ? "none" : "transform 0.32s cubic-bezier(0.25,0.46,0.45,0.94)",
                boxShadow: cardGlow,
                overflow: "hidden",
              }}
            >
              {/* 承認スタンプ */}
              <div style={{ position: "absolute", top: 32, left: 22, opacity: approveAlpha, transform: "rotate(-18deg)", border: "4px solid #22c55e", borderRadius: 10, padding: "6px 18px", color: "#22c55e", fontSize: 30, fontWeight: 900, letterSpacing: 4, pointerEvents: "none", zIndex: 20 }}>承認</div>
              {/* 差戻スタンプ */}
              <div style={{ position: "absolute", top: 32, right: 22, opacity: rejectAlpha, transform: "rotate(18deg)", border: "4px solid #ef4444", borderRadius: 10, padding: "6px 18px", color: "#ef4444", fontSize: 30, fontWeight: 900, letterSpacing: 4, pointerEvents: "none", zIndex: 20 }}>差戻</div>

              {/* ── スクロール可能なカード内容 ── */}
              <div
                style={{
                  overflowY: "auto",
                  maxHeight: "65vh",
                  WebkitOverflowScrolling: "touch",
                  padding: "28px 26px 24px",
                }}
              >
                {/* バッジ */}
                <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
                  <span style={{ background: "#f1f5f9", color: "#475569", fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 20 }}>決裁依頼</span>
                  {card.urgency === "急ぎ" && <span style={{ background: "#fef2f2", color: "#ef4444", fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 20 }}>🔴 急ぎ</span>}
                </div>

                {/* 申請者 */}
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
                  <Avatar initials={card.initials} color={card.color} size={54} />
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: "#0f172a" }}>{card.requester}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 3 }}>申請日：{card.date}</div>
                  </div>
                </div>

                {/* 金額 */}
                {card.amount !== "—" && (
                  <div style={{ background: "#f8fafc", borderRadius: 16, padding: "14px 18px", marginBottom: 16, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 600, letterSpacing: 1 }}>金額（税込）</div>
                    <div style={{ fontSize: 34, fontWeight: 800, color: "#0f172a", letterSpacing: "-1px" }}>{card.amount}</div>
                  </div>
                )}

                {/* 依頼タイトル */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 600, letterSpacing: 1 }}>依頼タイトル</div>
                  <div style={{ fontSize: 15, color: "#1e293b", fontWeight: 600, lineHeight: 1.6 }}>{card.title}</div>
                </div>

                {/* 詳細 */}
                {card.detail && (
                  <div style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 15px", marginBottom: 14, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 600, letterSpacing: 1 }}>詳細・内訳</div>
                    <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>{card.detail}</div>
                  </div>
                )}

                {/* 期限 */}
                {card.deadline && (
                  <div style={{ background: "#fff7ed", borderRadius: 12, padding: "12px 15px", marginBottom: 14, border: "1px solid #fed7aa", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 18 }}>📅</span>
                    <div>
                      <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 600, letterSpacing: 1 }}>期限</div>
                      <div style={{ fontSize: 14, color: "#ea580c", fontWeight: 700 }}>{card.deadline}</div>
                    </div>
                  </div>
                )}

                {/* その他 */}
                {card.other && (
                  <div style={{ background: "#f8fafc", borderRadius: 12, padding: "12px 15px", marginBottom: 14, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4, fontWeight: 600, letterSpacing: 1 }}>その他</div>
                    <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.7 }}>{card.other}</div>
                  </div>
                )}

                {/* ヒント */}
                <div style={{ marginTop: 16, textAlign: "center", color: "#cbd5e1", fontSize: 12, opacity: Math.max(0, 1 - Math.abs(dx) / 50), letterSpacing: 1 }}>
                  ← 差し戻し　　承認 →
                </div>
              </div>
            </div>
          </div>

          {/* アクションボタン */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 52, padding: "18px 0 14px" }}>
            <button onClick={() => triggerSwipe("rejected")} style={{ width: 66, height: 66, borderRadius: "50%", background: "#1e293b", border: "2px solid #ef4444", color: "#ef4444", fontSize: 26, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 20px rgba(239,68,68,0.25)", fontFamily: font }}>✕</button>
            <button onClick={() => triggerSwipe("approved")} style={{ width: 66, height: 66, borderRadius: "50%", background: "#1e293b", border: "2px solid #22c55e", color: "#22c55e", fontSize: 26, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 20px rgba(34,197,94,0.25)", fontFamily: font }}>✓</button>
          </div>

          {/* 処理済み */}
          {history.length > 0 && (
            <div style={{ padding: "4px 22px 24px" }}>
              <div style={{ color: "#475569", fontSize: 11, fontWeight: 600, marginBottom: 8, letterSpacing: 1 }}>処理済み</div>
              {history.slice(0, 3).map((item, i) => <HistoryItem key={i} item={item} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
