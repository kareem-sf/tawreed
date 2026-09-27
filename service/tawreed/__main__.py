"""Run the service on loopback: python -m tawreed --port 8765, with the access token in TAWREED_TOKEN.

The data home is ~/.tawreed, or TAWREED_HOME when set (for example, a scratch folder for testing)."""

import argparse
import logging
import os

import uvicorn

from tawreed.api.app import create_app
from tawreed.core.home import data_home


def main() -> None:
    parser = argparse.ArgumentParser(prog="tawreed")
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    token = os.environ.get("TAWREED_TOKEN")
    if not token:
        raise SystemExit("TAWREED_TOKEN must be set.")
    logging.basicConfig(format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("tawreed").setLevel(logging.INFO)
    uvicorn.run(create_app(data_home(), token), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
