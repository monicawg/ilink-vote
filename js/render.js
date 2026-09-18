// Shared renderers for audience phones and the presenter's fullscreen view.
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function resultsHTML(C, r, s) {
  const P = C.polls, n = Math.max(r.n, 1);
  const pct = (v) => Math.round(((v || 0) / n) * 100);
  const q3 = Object.entries(r.q3 || {}).sort((a, b) => b[1] - a[1]);
  return `
    <div class="q"><div class="q__k"><b>Q1</b> · ${esc(P.q1.hint)}</div><p class="q__t">${esc(P.q1.text)}</p>
      <div class="bars">${P.q1.options.map((k) => `<div class="bar"><span class="bar__k">${k}</span><div class="bar__track"><div class="bar__fill" data-w="${pct(r.q1[k])}%" style="width:${pct(r.q1[k])}%"></div></div><span class="bar__v"><b>${pct(r.q1[k])}%</b>${r.q1[k] || 0} 人</span></div>`).join("")}</div></div>
    <div class="q"><div class="q__k"><b>Q2</b> · ${esc(P.q2.hint)}</div><p class="q__t">${esc(P.q2.text)}</p>
      <div class="bignums">${P.q2.options.map((k) => `<div class="bignum"><div class="bignum__k">${k}</div><div class="bignum__v">${pct(r.q2[k])}<small>%</small></div><div class="bignum__n">${r.q2[k] || 0} 人</div></div>`).join("")}</div></div>
    ${s.q3_enabled && q3.length ? `<div class="q"><div class="q__k"><b>Q3</b> · ${esc(P.q3.hint)}</div><p class="q__t">${esc(P.q3.text)}</p>
      <div class="bars">${q3.map(([k, v]) => `<div class="bar" style="grid-template-columns:110px 1fr 48px"><span style="font-size:14px;font-weight:500">${esc(k)}</span><div class="bar__track" style="height:18px"><div class="bar__fill" data-w="${pct(v)}%" style="width:${pct(v)}%"></div></div><span class="bar__v">${v}</span></div>`).join("")}</div></div>` : ""}`;
}

export function revealHTML(C, step, flipIdx = -1) {
  const R = C.reveal;
  return `
    <div class="rv">${C.cases.map((c, i) => {
      const open = step > i;
      return `<div class="rcard ${open ? "is-open" : ""} ${open && i === flipIdx ? "is-flip" : ""}">
        <div class="rcard__idx">${c.id}</div>
        <div class="rcard__sum">${esc(c.summary)}</div>
        <div class="rcard__body">
          <div class="rcard__path">${esc(c.reveal.path)}</div>
          <div class="rcard__label">${esc(c.reveal.label)}</div>
          ${c.reveal.sublabel ? `<div class="rcard__sublabel">${esc(c.reveal.sublabel)}</div>` : ""}
          <div class="rcard__why">${esc(c.reveal.why)}</div>
          <div class="rcard__line">${esc(c.reveal.line)}</div>
        </div>
        ${open ? "" : `<div class="rcard__wait">${esc(R.wait)}</div>`}
      </div>`;
    }).join("")}</div>
    ${step >= C.cases.length ? `<div class="reveal__closing">${esc(R.closing)}</div>` : ""}`;
}
