// Runtime config — plain script so it can be edited on the host without a build.
window.APP_CONFIG = {
  // "local"    : no backend; state lives in this browser (BroadcastChannel syncs tabs). For dev / demo.
  // "supabase" : live voting across devices. Fill in the two keys below.
  backend: "local",
  supabaseUrl: "",
  supabaseAnonKey: "",
  // Session id shared by audience + presenter. Use "rehearsal" for run-throughs.
  sessionId: "ilink-0918",
  // Poll every N ms as a fallback when realtime is unavailable.
  pollMs: 5000,
};
