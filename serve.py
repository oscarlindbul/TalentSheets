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
import webbrowser


def main():
    parser = argparse.ArgumentParser(description="Serve the Talent Sheet Generator")
    parser.add_argument(
        "--port", "-p",
        type=int,
        default=8001,
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

    handler = http.server.SimpleHTTPRequestHandler

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
