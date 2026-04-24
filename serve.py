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
import webbrowser


class TalentSheetHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/genesys-symbols":
            genesys_dir = os.path.join(os.getcwd(), "resources", "Genesys")
            symbols = []

            if os.path.isdir(genesys_dir):
                for filename in sorted(os.listdir(genesys_dir), key=str.lower):
                    if filename.lower().endswith(".png"):
                        symbols.append({
                            "filename": filename,
                            "name": os.path.splitext(filename)[0],
                            "path": f"resources/Genesys/{filename}",
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
        help="Don't open a browser automatically",
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

        if not args.no_browser:
            webbrowser.open(url)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")
            sys.exit(0)


if __name__ == "__main__":
    main()
