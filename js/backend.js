// Backend abstraction. Two implementations share one interface:
//
//   subscribeSession(cb) -> unsubscribe     cb({phase, reveal_step, q3_enabled, manual_results, updated_at})
//   castVote({client_id, q1, q2, q3})       -> Promise<void>   (rejects unless phase === 'voting_open')
//   getResults()                            -> Promise<Results> (audience: only once phase >= results)
//   presenterSet(patch, key) / presenterReset(key) / presenterResults(key)
//   onStatus(cb)                            'live' | 'polling' | 'off'
//
// Results = { n, q1: {A,B,C,D}, q2: {A,B,C,D}, q3: {label: count} }

export const PHASES = ["lobby", "review", "voting_open", "voting_closed", "results", "reveal", "bridge"];
export const DEFAULT_SESSION = { phase: "lobby", reveal_step: 0, q3_enabled: true, manual_results: null, updated_at: 0, reset_at: 0 };

export function phaseIndex(p) { return PHASES.indexOf(p); }
export function resultsVisible(s) { return phaseIndex(s.phase) >= phaseIndex("results"); }
export function revealVisible(s) { return phaseIndex(s.phase) >= phaseIndex("reveal"); }

export function aggregate(votes) {
  const zero = () => ({ A: 0, B: 0, C: 0, D: 0 });
  const r = { n: votes.length, q1: zero(), q2: zero(), q3: {} };
  for (const v of votes) {
    for (const k of v.q1 || []) if (k in r.q1) r.q1[k]++;
    if (v.q2 in r.q2) r.q2[v.q2]++;
    for (const k of (Array.isArray(v.q3) ? v.q3 : (v.q3 ? [v.q3] : []))) r.q3[k] = (r.q3[k] || 0) + 1;
  }
  return r;
}

// ── Local (single browser; tabs sync via BroadcastChannel + storage events) ──
class LocalBackend {
  constructor(cfg) {
    this.sid = cfg.sessionId;
    this.kS = `ilink:${this.sid}:session`;
    this.kV = `ilink:${this.sid}:votes`;
    this.subs = new Set();
    this.statusCbs = new Set();
    this.chan = "BroadcastChannel" in window ? new BroadcastChannel(`ilink:${this.sid}`) : null;
    if (this.chan) this.chan.onmessage = () => this._emit();
    window.addEventListener("storage", (e) => { if (e.key === this.kS) this._emit(); });
    setTimeout(() => this._status("live"), 0);
    this.ready = Promise.resolve();
  }
  _read(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }
  _write(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  _emit() { const s = this.getSessionSync(); this.subs.forEach((cb) => cb(s)); }
  _notify() { this._emit(); this.chan && this.chan.postMessage("update"); }
  _status(s) { this.status = s; this.statusCbs.forEach((cb) => cb(s)); }
  onStatus(cb) { this.statusCbs.add(cb); if (this.status) cb(this.status); }
  getSessionSync() { return { ...DEFAULT_SESSION, ...this._read(this.kS, {}) }; }
  async getSession() { return this.getSessionSync(); }
  subscribeSession(cb) { this.subs.add(cb); cb(this.getSessionSync()); return () => this.subs.delete(cb); }
  async castVote(v) {
    const s = this.getSessionSync();
    if (s.phase !== "voting_open") throw new Error("voting_closed");
    const votes = this._read(this.kV, []).filter((x) => x.client_id !== v.client_id);
    votes.push({ ...v, t: Date.now() });
    this._write(this.kV, votes);
    this._notify();
  }
  async getResults() {
    const s = this.getSessionSync();
    if (s.manual_results) return s.manual_results;
    return aggregate(this._read(this.kV, []));
  }
  // presenter (no key needed locally)
  async presenterSet(patch) { this._write(this.kS, { ...this.getSessionSync(), ...patch, updated_at: Date.now() }); this._notify(); }
  async presenterReset() { this._write(this.kV, []); this._write(this.kS, { ...DEFAULT_SESSION, updated_at: Date.now(), reset_at: Date.now() }); this._notify(); }
  async presenterResults() { return aggregate(this._read(this.kV, [])); }
}

// ── Supabase (live, cross-device) ──
class SupabaseBackend {
  constructor(cfg) {
    this.cfg = cfg;
    this.sid = cfg.sessionId;
    this.subs = new Set();
    this.statusCbs = new Set();
    this.session = { ...DEFAULT_SESSION };
    this.ready = this._init();
  }
  async _init() {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    this.sb = createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, { realtime: { params: { eventsPerSecond: 2 } } });
    await this._fetch();
    this._status("polling");
    // realtime on the session row; polling always runs as the safety net
    this.sb.channel(`session:${this.sid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "sessions", filter: `id=eq.${this.sid}` },
        (payload) => { if (payload.new) this._apply(payload.new); })
      .subscribe((state) => { this._status(state === "SUBSCRIBED" ? "live" : "polling"); });
    this.timer = setInterval(() => this._fetch().catch(() => this._status("off")), this.cfg.pollMs || 5000);
  }
  async _fetch() {
    const { data, error } = await this.sb.from("sessions").select("*").eq("id", this.sid).maybeSingle();
    if (error) throw error;
    if (data) this._apply(data); else this._apply({ ...DEFAULT_SESSION });
    if (this.status === "off") this._status("polling");
  }
  _apply(row) {
    const s = { ...DEFAULT_SESSION, ...row, updated_at: row.updated_at ? Date.parse(row.updated_at) : 0, reset_at: row.reset_at ? Date.parse(row.reset_at) : 0 };
    if (JSON.stringify(s) !== JSON.stringify(this.session)) { this.session = s; this.subs.forEach((cb) => cb(s)); }
  }
  _status(s) { if (this.status !== s) { this.status = s; this.statusCbs.forEach((cb) => cb(s)); } }
  onStatus(cb) { this.statusCbs.add(cb); if (this.status) cb(this.status); }
  async getSession() { await this.ready; return this.session; }
  subscribeSession(cb) { this.subs.add(cb); cb(this.session); this.ready.then(() => cb(this.session)); return () => this.subs.delete(cb); }
  async _rpc(fn, args) {
    await this.ready;
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  }
  castVote(v) { return this._rpc("cast_vote", { p_session: this.sid, p_client: v.client_id, p_q1: v.q1, p_q2: v.q2, p_q3: v.q3 || null }); }
  getResults() { return this._rpc("get_results", { p_session: this.sid, p_key: null }); }
  presenterSet(patch, key) { return this._rpc("presenter_set", { p_session: this.sid, p_key: key, p_patch: patch }); }
  presenterReset(key) { return this._rpc("presenter_reset", { p_session: this.sid, p_key: key }); }
  presenterResults(key) { return this._rpc("get_results", { p_session: this.sid, p_key: key }); }
}

export function createBackend(cfg) {
  if (cfg.backend === "supabase") {
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error("config.js: supabaseUrl / supabaseAnonKey missing");
    return new SupabaseBackend(cfg);
  }
  return new LocalBackend(cfg);
}
