import { createBackend, PHASES, phaseIndex, aggregate } from "./backend.js";
import { esc, resultsHTML, revealHTML } from "./render.js";

const CFG = window.APP_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const params = new URLSearchParams(location.search);
const KEY = params.get("key") || "";
if (params.get("s")) CFG.sessionId = params.get("s");

let C, backend, session = { phase: "lobby", reveal_step: 0, q3_enabled: true }, results = { n: 0, q1: {}, q2: {}, q3: {} };
let lastStep = -1;
const PHASE_NOTES = {
  lobby: "觀眾可瀏覽題目與作品。投票鎖定。",
  review: "觀眾瀏覽四份作品（簡報第 12 頁，約 2 分鐘）。",
  voting_open: "手機投票已解鎖。看右側票數，約 60 秒後截止。",
  voting_closed: "投票唯讀。按「顯示現場結果」把結果推到全場手機。",
  results: "全場看現場結果。準備揭曉。",
  reveal: "逐一翻開 A → B → C → D，或一鍵全部揭曉。",
  bridge: "回顧模式：現場手機顯示「理解 → 思考 → 判斷 → 推進」；之後開網址的人可瀏覽作品並看結果，不能投票。",
};

async function boot() {
  C = await (await fetch("content/cases.json")).json();
  $("#pr-session").textContent = `session: ${CFG.sessionId}` + (CFG.backend === "local" ? " · LOCAL (single browser)" : "");
  backend = createBackend(CFG);
  backend.onStatus((s) => { const el = $("#pr-conn"); const d = el.parentElement; d.className = "pr__conn is-" + s; el.textContent = { live: "即時連線", polling: "輪詢同步", off: "離線" }[s] || s; });
  backend.subscribeSession((s) => { session = s; render(); });
  $("#steps").addEventListener("click", onStep);
  $("#btn-reset").addEventListener("click", reset);
  $("#q3-toggle").addEventListener("change", (e) => set({ q3_enabled: e.target.checked }));
  $("#btn-screen").addEventListener("click", () => showScreen(true));
  $("#btn-manual-apply").addEventListener("click", applyManual);
  $("#btn-manual-clear").addEventListener("click", () => set({ manual_results: null }));
  document.addEventListener("keydown", onKey);
  buildManual();
  pollResults();
  setInterval(pollResults, 2000);
}

async function set(patch) {
  try { await backend.presenterSet(patch, KEY); }
  catch (e) { alert("更新失敗：" + e.message + (CFG.backend === "supabase" ? "\n（檢查網址上的 key 是否正確）" : "")); }
}

function onStep(e) {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const act = b.dataset.act;
  if (act === "reveal") {
    const step = session.phase === "reveal" ? Math.min((session.reveal_step || 0) + 1, C.cases.length) : 1;
    return set({ phase: "reveal", reveal_step: step });
  }
  if (act === "reveal_all") return set({ phase: "reveal", reveal_step: C.cases.length });
  if (act === "lobby") return set({ phase: "lobby", reveal_step: 0 });
  set({ phase: act });
}

async function reset() {
  if (!confirm("清空所有票數並回到 Lobby？（彩排結束或重跑時使用）")) return;
  try { await backend.presenterReset(KEY); } catch (e) { alert("Reset 失敗：" + e.message); }
}

async function pollResults() {
  try {
    const r = await backend.presenterResults(KEY);
    if (r) results = r;
    $("#pr-updated").textContent = "更新 " + new Date().toLocaleTimeString("zh-TW", { hour12: false });
  } catch (e) { $("#pr-updated").textContent = "讀取票數失敗：" + e.message; }
  renderResults();
}

function render() {
  $("#pr-phase").textContent = session.phase.toUpperCase().replace("_", " ") + (session.phase === "reveal" ? ` · ${session.reveal_step}/${C.cases.length}` : "");
  $("#pr-phase-note").textContent = PHASE_NOTES[session.phase] || "";
  const cur = phaseIndex(session.phase);
  $("#steps").querySelectorAll("li[data-phase]").forEach((li) => {
    const i = phaseIndex(li.dataset.phase);
    li.classList.toggle("is-done", i < cur);
    li.classList.toggle("is-now", i === cur);
    // "next" = the natural next action; reveal stays next until all four are open
    const next = session.phase === "reveal" && session.reveal_step < C.cases.length ? "reveal" : PHASES[Math.min(cur + 1, PHASES.length - 1)];
    li.classList.toggle("is-next", li.dataset.phase === next && !(session.phase === "bridge"));
  });
  $("#q3-toggle").checked = !!session.q3_enabled;
  renderResults();
  if (!$("#screen").hidden) renderScreen();
}

function renderResults() {
  const r = session.manual_results || results;
  $("#pr-n").textContent = r.n || 0;
  $("#pr-results").innerHTML = (session.manual_results ? `<p class="muted">⚠ 目前顯示的是手動輸入票數</p>` : "") + resultsHTML(C, r, session);
}

// ── manual fallback ──
function buildManual() {
  const P = C.polls;
  $("#manual").innerHTML = `
    <label class="full">投票人數 N<input type="number" min="0" id="m-n" placeholder="例如 42"></label>
    ${P.q1.options.map((k) => `<label>Q1 · ${k}<input type="number" min="0" id="m-q1-${k}"></label>`).join("")}
    ${P.q2.options.map((k) => `<label>Q2 · ${k}<input type="number" min="0" id="m-q2-${k}"></label>`).join("")}`;
}
function applyManual() {
  const P = C.polls, v = (id) => Math.max(0, parseInt($(id).value || "0", 10));
  const m = { n: v("#m-n"), q1: {}, q2: {}, q3: {} };
  P.q1.options.forEach((k) => (m.q1[k] = v(`#m-q1-${k}`)));
  P.q2.options.forEach((k) => (m.q2[k] = v(`#m-q2-${k}`)));
  if (!m.n) m.n = Math.max(...Object.values(m.q2), 1);
  set({ manual_results: m });
}

// ── fullscreen view (screen share) ──
function showScreen(on) { $("#screen").hidden = !on; if (on) renderScreen(); }
function renderScreen() {
  const r = session.manual_results || results;
  const el = $("#screen-inner");
  let html;
  if (session.phase === "reveal") {
    const flip = lastStep !== session.reveal_step ? session.reveal_step - 1 : -1;
    lastStep = session.reveal_step;
    html = `<div class="eyebrow">THE RESULT</div><h1>${esc(C.reveal.h1)}</h1><p class="sub">${esc(C.reveal.sub)}</p>${revealHTML(C, session.reveal_step, flip)}`;
  } else if (session.phase === "bridge") {
    const parts = C.bridge.line.split(" → ");
    html = `<section class="bridge"><div class="eyebrow">${esc(C.bridge.eyebrow)}</div><div class="bridge__line">${parts.map((p, i) => (i === parts.length - 1 ? `<b>${esc(p)}</b>` : esc(p))).join(" → ")}</div><div class="bridge__en">${esc(C.bridge.en)}</div></section>`;
  } else if (phaseIndex(session.phase) >= phaseIndex("results") || session.phase === "voting_closed") {
    html = `<div class="eyebrow">LIVE RESULT</div><h1>${esc(C.results.h1)}</h1><p class="results__n">${r.n || 0} 人已投票</p><div class="screen__two">${resultsHTML(C, r, session)}</div>`;
  } else if (session.phase === "voting_open") {
    html = `<div class="eyebrow">VOTE</div><h1>${esc(C.vote.h1)}</h1><p class="sub">Q1｜${esc(C.polls.q1.text)}（${esc(C.polls.q1.hint)}）<br>Q2｜${esc(C.polls.q2.text)}（${esc(C.polls.q2.hint)}）</p><p class="results__n" style="font-size:40px;margin-top:40px"><b>${r.n || 0}</b> 人已投票</p>`;
  } else {
    html = `<div class="eyebrow">FOUR CANDIDATES</div><h1>${esc(C.gallery.h1)}</h1><p class="sub">${esc(C.gallery.sub)}</p>`;
  }
  el.innerHTML = html;
}
function onKey(e) {
  if ($("#screen").hidden) return;
  if (e.key === "Escape") showScreen(false);
  if (e.key === "ArrowRight") { const next = $("#steps li.is-next > button"); next && next.click(); }
  if (e.key === "ArrowLeft") {
    if (session.phase === "reveal" && session.reveal_step > 1) set({ reveal_step: session.reveal_step - 1 });
    else { const i = phaseIndex(session.phase); if (i > 0) set({ phase: PHASES[i - 1], reveal_step: 0 }); }
  }
}

boot().catch((e) => { document.body.innerHTML = `<p style="padding:20px;color:#C8321E">載入失敗：${esc(e.message)}</p>`; });
