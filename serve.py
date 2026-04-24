#!/usr/bin/env python3
"""
Simple HTTP server for the Talent Sheet Generator.

Usage:
    python serve.py
    python serve.py --port 8080

Then open http://localhost:8000 (or your chosen port) in a browser.
"""

import http.server
import socketserver
import argparse
import os
import sys
import json
from urllib.parse import urlparse


class TalentSheetHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path

        if path in ("/api/genesys-symbols", "/api/genesys-dice"):
            subfolder = "Symbols" if path == "/api/genesys-symbols" else "Dice"
            base_dir = os.path.join(os.getcwd(), "resources", "Genesys", subfolder)
            symbols = []

            if os.path.isdir(base_dir):
                for filename in sorted(os.listdir(base_dir), key=str.lower):
                    if not filename.lower().endswith(".png"):
                        continue
                    symbols.append({
                        "filename": filename,
                        "name": os.path.splitext(filename)[0],
                        "path": f"resources/Genesys/{subfolder}/{filename}",
                    })

            payload = json.dumps(symbols).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description="Serve the Talent Sheet Generator")
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=8000,
        help="Port to listen on (default: 8001)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Deprecated; browser auto-open is disabled by default",
    )
    args = parser.parse_args()

    # Serve from the directory where this script lives
    serve_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(serve_dir)

    handler = TalentSheetHandler

    with socketserver.TCPServer(("", args.port), handler) as httpd:
        url = f"http://localhost:{args.port}"
        print(f"Serving Talent Sheet Generator at {url}")
        print("Press Ctrl+C to stop.\n")

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")
            sys.exit(0)


if __name__ == "__main__":
    main()
