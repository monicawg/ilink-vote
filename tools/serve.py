#!/usr/bin/env python3
"""Tiny static server for local testing: python3 tools/serve.py [port]"""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class H(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".webp": "image/webp", ".js": "text/javascript", ".json": "application/json"}
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a): pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
print(f"serving {ROOT} on http://127.0.0.1:{port}", flush=True)
ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
