import { createBackend, resultsVisible, revealVisible, phaseIndex } from "./backend.js";
import { esc, resultsHTML, revealHTML } from "./render.js";

const CFG = window.APP_CONFIG;
{ const s = new URLSearchParams(location.search).get("s"); if (s) CFG.sessionId = s; }  // ?s=rehearsal
const $ = (s, r = document) => r.querySelector(s);
const view = $("#view");
const tabs = $("#tabs");

// ── per-device state ─────────────────────────────────────────
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const kClient = "ilink:client_id";
const kVote = `ilink:${CFG.sessionId}:myvote`;
const kSeen = `ilink:${CFG.sessionId}:seen`;
const kResetSeen = `ilink:${CFG.sessionId}:reset_seen`;   // last reset this device has already applied
const clientId = LS.get(kClient) || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
LS.set(kClient, clientId);

let C = null;                // content/cases.json
let session = { phase: "lobby", reveal_step: 0, q3_enabled: true };
let myVote = LS.get(kVote, null);   // {q1:[], q2:'', q3:[], sent:true|false, t}
let results = null;
let backend;
let lastRevealStep = -1;
let sessionReady = false;

// ── boot ─────────────────────────────────────────────────────
async function boot() {
  C = await (await fetch("content/cases.json")).json();
  $("#topbar-event").textContent = C.event.label;
  backend = createBackend(CFG);
  backend.onStatus(renderStatus);
  backend.subscribeSession(onSession);
  window.addEventListener("hashchange", route);
  try { await Promise.race([backend.ready, new Promise((r) => setTimeout(r, 6000))]); } catch {}
  sessionReady = true;              // from here on, phase changes are live transitions
  route(true);
  $("#lightbox-close").addEventListener("click", closeLightbox);
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
}

// ── session → auto navigation ────────────────────────────────
function onSession(s) {
  const prev = session;
  session = s;
  // presenter reset → forget this device's vote so everyone starts clean
  if (s.reset_at && s.reset_at > (LS.get(kResetSeen, 0) || 0)) {
    LS.set(kResetSeen, s.reset_at);
    myVote = null; draft = null; results = null; LS.set(kVote, null); LS.set(kSeen, null);
  }
  renderStatus();
  if (!sessionReady) return;        // initial load: route(true) decides where to land
  if (prev.phase !== s.phase) {
    if (s.phase === "voting_open") {
      if (currentRoute() !== "vote") toast("講者已開放投票", "去投票", () => (location.hash = "#/vote"));
      else route();
    } else if (s.phase === "results") { hideToast(); location.hash = "#/results"; route(); }
    else if (s.phase === "reveal") { hideToast(); location.hash = "#/reveal"; route(); }
    else if (s.phase === "bridge") { hideToast(); location.hash = "#/bridge"; route(); }
    else if (s.phase === "lobby") { hideToast(); results = null; if (["results", "reveal", "bridge"].includes(currentRoute())) location.hash = "#/intro"; route(); }
    else route();
  } else if (currentRoute() === "reveal" && s.reveal_step !== prev.reveal_step) {
    route();
  } else if (currentRoute() === "vote") {
    route();
  }
}

const isArchive = () => session.phase === "bridge";

// third tab: 投票 until results are public, then 結果
function renderTabs() {
  const vt = tabs.querySelector('[data-tab="vote"]');
  const showResults = resultsVisible(session);
  vt.href = showResults ? "#/results" : "#/vote";
  vt.lastChild.previousSibling.textContent = showResults ? "結果" : "投票";
  const r = currentRoute();
  vt.classList.toggle("is-active", showResults ? (r === "results" || r === "reveal") : r === "vote");
}

function renderStatus() {
  const el = $("#topbar-status"), t = $("#topbar-status-text");
  el.className = "topbar__status";
  const st = backend?.status;
  if (st === "off") { el.classList.add("is-off"); t.textContent = "離線 · 顯示靜態內容"; return; }
  if (isArchive()) { el.classList.add("is-live"); t.textContent = "講座已結束 · 回顧模式"; }
  else if (session.phase === "voting_open") { el.classList.add("is-open"); t.textContent = "投票開放中"; }
  else if (session.phase === "voting_closed") { el.classList.add("is-live"); t.textContent = "投票已截止"; }
  else if (resultsVisible(session)) { el.classList.add("is-live"); t.textContent = "結果公布"; }
  else { if (st === "live") el.classList.add("is-live"); t.textContent = st === "live" ? "瀏覽中 · 投票尚未開放" : "同步中…"; }
  const vt = tabs.querySelector('[data-tab="vote"]');
  vt.classList.toggle("is-open", session.phase === "voting_open" && !(myVote && myVote.sent));
  renderTabs();
}

// ── router ───────────────────────────────────────────────────
function currentRoute() { return (location.hash.replace(/^#\/?/, "") || "").split("/")[0]; }

function route(initial) {
  let [r, arg] = location.hash.replace(/^#\/?/, "").split("/");
  if (initial) {
    if (isArchive()) r = r || "intro";            // talk is over: free browsing, results under the 3rd tab
    else if (revealVisible(session)) r = "reveal";
    else if (session.phase === "results") r = "results";
    else if (!r) r = "intro";   // fresh open always starts at the intro
  }
  if (!r) r = "intro";
  // pages the presenter has not unlocked fall back gracefully
  if (r === "results" && !resultsVisible(session)) r = "vote";
  if (r === "reveal" && !revealVisible(session)) r = resultsVisible(session) ? "results" : "vote";
  const R = { intro, brief, cases, case: caseView, vote, results: resultsView, reveal, bridge };
  (R[r] || intro)(arg);
  tabs.querySelectorAll("a").forEach((a) => a.classList.toggle("is-active", a.dataset.tab === r || (r === "case" && a.dataset.tab === "cases")));
  tabs.classList.toggle("is-hidden", r === "bridge");
  renderTabs();
  view.className = "view" + (r === "case" || r === "reveal" || r === "cases" ? " view--wide" : "");
  window.scrollTo(0, 0);
}

// ── screens ──────────────────────────────────────────────────
function intro() {
  const I = C.intro;
  view.innerHTML = `
    <section class="intro">
      <div class="eyebrow">${I.eyebrow}</div>
      <h1>${esc(I.h1)}</h1>
      <ul class="intro__setup">${I.setup.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
      ${isArchive() ? `<div class="notice"><b>${esc(I.archive_title)}</b>${esc(I.archive_note)}</div>` : `<p class="intro__note">${esc(I.note)}</p>`}
      <p class="intro__foot">${esc(I.footnote)}</p>
      ${isArchive() ? `<div class="btn-row"><a class="btn" href="#/brief">${esc(I.cta)}</a><a class="btn btn--ghost" href="#/results">${esc(I.archive_cta)}</a></div>` : `<a class="btn" href="#/brief">${esc(I.cta)}</a>`}
    </section>`;
}

function brief() {
  const B = C.brief;
  prefetch(C.cases.flatMap((c) => [`assets/cases/${c.id}/thumb.webp`, qrUrl(c, 0)]));
  view.innerHTML = `
    <section class="brief">
      <div class="eyebrow">${B.eyebrow}</div>
      <h1>${esc(B.h1)}</h1>
      <p class="sub"></p>
      ${B.sections.map((s) => `
        <div class="brief__sec">
          <div class="brief__k">${esc(s.k)}</div>
          <div class="brief__v">${s.list
            ? `<ul>${s.list.map((li) => { const [b, rest] = li.split("｜"); return rest ? `<li><b>${esc(b)}</b>｜${esc(rest)}</li>` : `<li>${esc(li)}</li>`; }).join("")}</ul>`
            : `<p class="brief__v">${esc(s.v)}</p>`}</div>
        </div>`).join("")}
      <a class="btn" href="#/cases">${esc(B.cta)}</a>
    </section>`;
}

function cases() {
  LS.set(kSeen, true);
  const G = C.gallery;
  prefetch(C.cases.flatMap((c) => [qrUrl(c, 0), qrUrl(c, 1)]));
  view.innerHTML = `
    <div class="eyebrow">${G.eyebrow}</div>
    <h1>${esc(G.h1)}</h1>
    <p class="sub">${esc(G.sub)}</p>
    <div class="grid">${C.cases.map((c) => `
      <a class="card" href="#/case/${c.id}">
        <div class="card__thumb">${pic(c.id, "thumb", `Candidate ${c.id} 第 1 頁`)}</div>
        <div class="card__body">
          <div class="card__head"><span class="card__idx">${c.id}</span><span class="card__pages">${c.pages} 頁</span></div>
          <ul class="card__tags">${c.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
          <span class="card__cta">${esc(G.open)}</span>
        </div>
      </a>`).join("")}</div>
    <p class="gallery__hint">${esc(isArchive() ? G.hint_archive : G.hint)}</p>`;
}

function caseView(id) {
  const c = C.cases.find((x) => x.id === id);
  if (!c) return cases();
  const idx = C.cases.indexOf(c);
  const next = C.cases[idx + 1];
  view.innerHTML = `
    <div class="case__head">
      <div><div class="eyebrow">CASE ${c.id}</div><div class="case__idx">${c.id}</div></div>
      <div class="case__meta"><b>${c.pages} 頁</b></div>
    </div>
    <p class="case__sum">${esc(c.summary)}</p>
    <ul class="case__tags">${c.tags.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>

    <div class="qr-label"><span>Quick Review</span><span>重點節錄 · ${c.quick_review.length} / ${c.pages} 頁</span></div>
    <div class="strip" id="strip">${c.quick_review.map((q, i) => `
      <figure class="strip__item" style="margin:0">
        <div class="strip__img" data-page="${q.page}">${pic(c.id, `p${String(q.page).padStart(2, "0")}`, `第 ${q.page} 頁`, i > 1)}</div>
        <figcaption class="strip__cap"><b>P${q.page}</b><span>${esc(q.caption)}</span></figcaption>
      </figure>`).join("")}</div>
    <div class="strip__dots" id="dots">${c.quick_review.map((_, i) => `<i class="${i === 0 ? "is-on" : ""}"></i>`).join("")}</div>
    <p class="tap-hint">左右滑動瀏覽 · 點圖放大</p>

    <hr class="rule">
    <div class="qr-label"><span>Full Case</span><span>完整匿名版 · ${c.pages} 頁</span></div>
    <div id="full"><button type="button" class="btn btn--ghost" id="btn-full">查看完整匿名版（${c.pages} 頁）</button></div>

    <div class="case__nav">
      <a class="btn btn--ghost" href="#/cases">返回作品列表</a>
      ${next ? `<a class="btn" href="#/case/${next.id}">下一位：${next.id} →</a>` : `<a class="btn" href="#/vote">前往投票 →</a>`}
    </div>`;
  prefetch(c.quick_review.map((_, i) => qrUrl(c, i)).concat(next ? [qrUrl(next, 0), qrUrl(next, 1)] : []));
  const strip = $("#strip"), dots = $("#dots").children;
  strip.addEventListener("scroll", () => {
    const i = Math.round(strip.scrollLeft / (strip.firstElementChild.offsetWidth + 10));
    [...dots].forEach((d, j) => d.classList.toggle("is-on", j === i));
  }, { passive: true });
  $("#btn-full").addEventListener("click", () => {
    $("#full").innerHTML = fullPages(c) + `<button type="button" class="btn btn--ghost" id="btn-full-close" style="margin-top:12px">收合完整版</button>`;
    $("#btn-full-close").addEventListener("click", () => { $("#full").scrollIntoView({ block: "start" }); caseView(id); });
  });
  view.addEventListener("click", (e) => {
    const img = e.target.closest(".strip__img img, .page img");
    if (img) openLightbox((img.currentSrc || img.src).replace(".s.webp", ".webp"));
  });
}

function fullPages(c) {
  return `<div class="pages">${Array.from({ length: c.pages }, (_, i) => i + 1).map((p) => `
    <div class="page">${pic(c.id, `p${String(p).padStart(2, "0")}`, `第 ${p} 頁`, true)}<div class="page__num">${c.id} · ${p} / ${c.pages}</div></div>`).join("")}</div>`;
}

function pic(id, name, alt, lazy = true) {
  const base = `assets/cases/${id}/${name}`;
  const srcset = name === "thumb" ? `${base}.webp` : `${base}.s.webp 900w, ${base}.webp 1600w`;
  return `<picture><source type="image/webp" srcset="${srcset}" sizes="(min-width: 768px) 560px, 88vw"><img src="${base}.jpg" alt="${esc(alt)}" ${lazy ? 'loading="lazy"' : ""} decoding="async"></picture>`;
}

// warm the cache for what the viewer will most likely open next
const prefetched = new Set();
function prefetch(urls) {
  for (const u of urls) {
    if (prefetched.has(u)) continue; prefetched.add(u);
    const l = document.createElement("link"); l.rel = "prefetch"; l.as = "image"; l.href = u; document.head.appendChild(l);
  }
}
const qrUrl = (c, i) => `assets/cases/${c.id}/p${String(c.quick_review[i].page).padStart(2, "0")}.s.webp`;

// ── vote ─────────────────────────────────────────────────────
let draft = null;
function vote() {
  const V = C.vote, P = C.polls;
  const open = session.phase === "voting_open";
  const closed = phaseIndex(session.phase) > phaseIndex("voting_open");
  const sent = myVote && myVote.sent;
  if (!open && !closed && !sent) {
    view.innerHTML = `
      <div class="eyebrow">VOTE</div>
      <div class="locked">
        <div class="locked__icon">03</div>
        <h1>${esc(V.locked_title)}</h1>
        <p class="sub">${esc(V.locked_note)}</p>
        <a class="btn btn--ghost" href="#/cases">回去再看一次作品</a>
      </div>`;
    return;
  }
  if (sent && !draft) {
    view.innerHTML = `
      <div class="eyebrow">VOTE</div>
      <h1>${esc(closed ? V.closed_title : V.submitted_title)}</h1>
      <p class="sub">${esc(closed ? V.closed_note : V.submitted_note)}</p>
      ${summary(myVote)}
      ${open ? `<button type="button" class="btn btn--ghost" id="btn-change">${esc(V.change)}</button>` : ""}
      ${resultsVisible(session) ? `<a class="btn" href="#/results">看現場結果 →</a>` : ""}`;
    $("#btn-change")?.addEventListener("click", () => { draft = { ...myVote }; vote(); });
    return;
  }
  if (closed && !sent) {
    view.innerHTML = `
      <div class="eyebrow">VOTE</div>
      <div class="locked"><h1>${esc(isArchive() ? "投票已關閉" : V.closed_title)}</h1><p class="sub">${esc(isArchive() ? "講座已結束。看看當天的現場投票與真實結果。" : V.missed_note)}</p>
      ${resultsVisible(session) ? `<a class="btn" href="#/results">看現場結果 →</a>` : ""}</div>`;
    return;
  }
  draft = draft || { q1: [], q2: "", q3: [] };
  if (!Array.isArray(draft.q3)) draft.q3 = draft.q3 ? [draft.q3] : [];
  const opts = (name, options, multi, cls = "opt") => `<div class="${cls === "opt" ? "opts" : "chips"}" data-q="${name}">${options.map((o) => {
    const on = multi ? draft[name].includes(o) : draft[name] === o;
    return `<button type="button" class="${cls}" data-v="${esc(o)}" aria-pressed="${on}">${esc(o)}</button>`;
  }).join("")}</div>`;
  view.innerHTML = `
    <div class="eyebrow">VOTE</div>
    <h1>${esc(V.h1)}</h1>
    <p class="vote__prompt">${esc(V.prompt)}</p>
    <div class="q"><div class="q__k"><b>Q1</b> · ${esc(P.q1.hint)}</div><p class="q__t">${esc(P.q1.text)}</p>${opts("q1", P.q1.options, true)}</div>
    <div class="q"><div class="q__k"><b>Q2</b> · ${esc(P.q2.hint)}</div><p class="q__t">${esc(P.q2.text)}</p>${opts("q2", P.q2.options, false)}</div>
    ${session.q3_enabled ? `<div class="q"><div class="q__k"><b>Q3</b> · ${esc(P.q3.hint)}</div><p class="q__t">${esc(P.q3.text)}</p>${opts("q3", P.q3.options, true, "chip")}</div>` : ""}
    <button type="button" class="btn btn--yellow" id="btn-submit" disabled>${esc(V.submit)}</button>
    <p class="vote__err" id="vote-err" hidden></p>`;
  const refresh = () => {
    view.querySelectorAll("[data-q]").forEach((g) => {
      const q = g.dataset.q;
      g.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", Array.isArray(draft[q]) ? draft[q].includes(b.dataset.v) : draft[q] === b.dataset.v));
    });
    $("#btn-submit").disabled = !(draft.q1.length && draft.q2);
  };
  view.querySelectorAll("[data-q] button").forEach((b) => b.addEventListener("click", () => {
    const q = b.closest("[data-q]").dataset.q, v = b.dataset.v;
    if (q === "q1") draft.q1 = draft.q1.includes(v) ? draft.q1.filter((x) => x !== v) : [...draft.q1, v].sort();
    else if (q === "q3") {
      if (draft.q3.includes(v)) draft.q3 = draft.q3.filter((x) => x !== v);
      else if (draft.q3.length < (P.q3.max || 3)) draft.q3 = [...draft.q3, v];
      else return;
    }
    else draft[q] = draft[q] === v ? "" : v;
    refresh();
  }));
  refresh();
  $("#btn-submit").addEventListener("click", submitVote);
}

function summary(v) {
  const L = C.vote.labels, q3 = Array.isArray(v.q3) ? v.q3 : (v.q3 ? [v.q3] : []);
  return `<div class="vote__summary"><dl>
    <dt>${esc(L.q1)}</dt><dd>${v.q1.join(" · ")}</dd>
    <dt>${esc(L.q2)}</dt><dd>${esc(v.q2)}</dd>
    ${q3.length ? `<dt>${esc(L.q3)}</dt><dd class="tc">${esc(q3.join("、"))}</dd>` : ""}
  </dl></div>`;
}

async function submitVote() {
  const btn = $("#btn-submit"), err = $("#vote-err");
  btn.disabled = true; btn.textContent = "送出中…"; err.hidden = true;
  const payload = { client_id: clientId, q1: draft.q1, q2: draft.q2, q3: draft.q3.length ? draft.q3 : null };
  let ok = false;
  for (let i = 0; i < 3 && !ok; i++) {
    try { await backend.castVote(payload); ok = true; }
    catch (e) { if (String(e.message).includes("voting_closed")) break; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  myVote = { ...payload, sent: ok, t: Date.now() };
  LS.set(kVote, myVote);
  draft = null;
  if (ok) { renderStatus(); vote(); }
  else {
    btn.disabled = false; btn.textContent = C.vote.submit;
    err.hidden = false; err.textContent = session.phase !== "voting_open" ? C.vote.closed_title : C.vote.offline_note;
    draft = { q1: payload.q1, q2: payload.q2, q3: payload.q3 || [] };
  }
}

// ── results ──────────────────────────────────────────────────
async function resultsView() {
  const R = C.results;
  view.innerHTML = `<div class="eyebrow">${R.eyebrow}</div><h1>${esc(R.h1)}</h1><p class="results__n" id="res-n">載入中…</p><div id="res"></div>`;
  try { results = await backend.getResults(); } catch { results = null; }
  if (!results) { $("#res-n").textContent = "結果載入中，請看講者畫面。"; return; }
  $("#res-n").textContent = `${results.n} 人已投票`;
  $("#res").innerHTML = resultsHTML(C, results, session) + `<p class="muted" style="margin-top:20px">${esc(R.note)}</p>` +
    (revealVisible(session) ? `<a class="btn" href="#/reveal" style="margin-top:20px">看真實結果 →</a>` : `<p class="results__wait">${esc(R.wait)}</p>`);
  if (isArchive()) $("#res-n").textContent += " · 講座當天的現場投票";
  view.querySelectorAll(".bar__fill").forEach((b) => { b.style.width = "0"; requestAnimationFrame(() => (b.style.width = b.dataset.w)); });
}

// ── reveal ───────────────────────────────────────────────────
function reveal() {
  const R = C.reveal, step = session.reveal_step || 0;
  const flipIdx = lastRevealStep !== step ? step - 1 : -1;
  view.innerHTML = `
    <div class="eyebrow">${R.eyebrow}</div>
    <h1>${esc(R.h1)}</h1>
    <p class="sub">${esc(R.sub)}</p>
    ${revealHTML(C, step, flipIdx)}`;
  lastRevealStep = step;
}

function bridge() {
  const B = C.bridge;
  const parts = B.line.split(" → ");
  view.innerHTML = `<section class="bridge"><div class="eyebrow">${esc(B.eyebrow)}</div>
    <div class="bridge__line">${parts.map((p, i) => (i === parts.length - 1 ? `<b>${esc(p)}</b>` : esc(p))).join(" → ")}</div>
    <div class="bridge__en">${esc(B.en)}</div>
    <p class="bridge__note">${esc(B.note)}</p></section>`;
}

// ── toast / lightbox ─────────────────────────────────────────
let toastTimer;
function toast(text, btnText, onClick) {
  const t = $("#toast"); $("#toast-text").textContent = text;
  const b = $("#toast-btn"); b.textContent = btnText; b.onclick = () => { hideToast(); onClick && onClick(); };
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(hideToast, 15000);
}
function hideToast() { $("#toast").hidden = true; }
function openLightbox(src) { $("#lightbox-img").src = src; $("#lightbox").hidden = false; document.body.style.overflow = "hidden"; }
function closeLightbox() { $("#lightbox").hidden = true; document.body.style.overflow = ""; }

boot().catch((e) => { view.innerHTML = `<p class="vote__err">載入失敗：${esc(e.message)}</p>`; console.error(e); });
