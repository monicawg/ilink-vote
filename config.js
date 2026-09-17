// Runtime config — plain script so it can be edited on the host without a build.
window.APP_CONFIG = {
  // "local"    : no backend; state lives in this browser (BroadcastChannel syncs tabs). For dev / demo.
  // "supabase" : live voting across devices. Fill in the two keys below.
  backend: "supabase",
  supabaseUrl: "https://oqaaipywacrhulkphvgz.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xYWFpcHl3YWNyaHVsa3Bodmd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2NjgyNjIsImV4cCI6MjEwNTI0NDI2Mn0.8LqKkCb0M1h4j8xB0wNlb3_ahFszGSV2Ha5VqpltMxI",
  // Session id shared by audience + presenter. Use "rehearsal" for run-throughs.
  sessionId: "ilink-0918",
  // Poll every N ms as a fallback when realtime is unavailable.
  pollMs: 5000,
};
