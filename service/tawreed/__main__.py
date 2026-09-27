"""Run the service on loopback: python -m tawreed --port 8765, with the access token in TAWREED_TOKEN.

The data home is ~/.tawreed, or TAWREED_HOME when set (for example, a scratch folder for testing)."""

import argparse
import logging
import os
import sys
import threading

import uvicorn

from tawreed.api.app import create_app
from tawreed.core.home import data_home


def exit_with_stdin() -> None:
    """Stop when standard input closes. The desktop app holds that pipe open while it runs, so when it exits, or
    crashes, the system closes the pipe and the service stops with it."""

    def watch() -> None:
        sys.stdin.read()
        os._exit(0)

    threading.Thread(target=watch, name="tawreed-parent", daemon=True).start()


def main() -> None:
    parser = argparse.ArgumentParser(prog="tawreed")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--exit-with-stdin", action="store_true", help="stop when standard input closes")
    args = parser.parse_args()
    token = os.environ.get("TAWREED_TOKEN")
    if not token:
        raise SystemExit("TAWREED_TOKEN must be set.")
    if args.exit_with_stdin:
        exit_with_stdin()
    logging.basicConfig(format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("tawreed").setLevel(logging.INFO)
    uvicorn.run(create_app(data_home(), token), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
