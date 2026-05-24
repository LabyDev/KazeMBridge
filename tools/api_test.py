#!/usr/bin/env python3
"""Probe a Mitsubishi AC adapter over HTTP. Prints raw response."""

import argparse
import urllib.request
import urllib.error


def main():
    parser = argparse.ArgumentParser(description="Fire an HTTP request at an AC adapter.")
    parser.add_argument("--host", required=True, help="AC adapter IP, e.g. 192.168.1.50")
    parser.add_argument("--path", default="/", help="URL path to request")
    parser.add_argument("--port", type=int, default=80)
    parser.add_argument("--method", default="GET", choices=["GET", "POST"])
    parser.add_argument("--body", default=None, help="POST body string")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}{args.path}"
    print(f">>> {args.method} {url}")

    data = args.body.encode() if args.body else None
    req = urllib.request.Request(url, data=data, method=args.method)

    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"Status : {resp.status}")
            print(f"Headers: {dict(resp.headers)}")
            print(f"Body   :\n{resp.read().decode(errors='replace')}")
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.reason}")
        print(e.read().decode(errors="replace"))
    except OSError as e:
        print(f"Connection error: {e}")


if __name__ == "__main__":
    main()
