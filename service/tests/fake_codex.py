"""A stand-in for the Codex client, so tests exercise Tawreed's Codex path without a subscription.

Started the way Tawreed starts `codex exec`: it finds Tawreed's MCP endpoint and the name of the variable holding
the run's token in the -c options, reads the prompt from standard input, calls Tawreed's tools over MCP, and
prints Codex's JSON events. What it does depends on the prompt:

- a model check: reports the code it was given (it can't read the attached image);
- a turn: lists the files and writes to the engineer, or with FAKE_CODEX_WAIT set, waits that many seconds first
  (for Stop), or with FAKE_CODEX_FAIL set, fails the way Codex does when it is signed out.
"""

import asyncio
import json
import os
import re
import sys
import time

from mcp.client.session import ClientSession
from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client


def option(name: str) -> str:
    for index, value in enumerate(sys.argv):
        if value == "-c" and sys.argv[index + 1].startswith(f"{name}="):
            return json.loads(sys.argv[index + 1].split("=", 1)[1])
    raise SystemExit(f"fake codex: no {name}")


def emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


async def main() -> None:
    prompt = sys.stdin.read()
    url = option("mcp_servers.tawreed.url")
    token = os.environ[option("mcp_servers.tawreed.bearer_token_env_var")]
    emit({"type": "thread.started", "thread_id": "fake"})
    emit({"type": "turn.started"})
    if os.environ.get("FAKE_CODEX_FAIL"):
        emit({"type": "turn.failed", "error": {"message": "401 Unauthorized: please sign in again"}})
        sys.exit(1)
    time.sleep(float(os.environ.get("FAKE_CODEX_WAIT", "0")))
    http = create_mcp_http_client(headers={"Authorization": f"Bearer {token}"})
    async with streamable_http_client(url, http_client=http) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        check = re.search(r"report_code with the code (\w+)", prompt)
        calls = (
            [("report_code", {"code": check[1]})]
            if check
            else [("list_files", {}), ("message_engineer", {"text": "Codex here: I read the file list."})]
        )
        for tool, arguments in calls:
            result = await session.call_tool(tool, arguments)
            item = {"type": "mcp_tool_call", "server": "tawreed", "tool": tool}
            item["status"] = "failed" if result.is_error else "completed"
            if result.is_error:
                item["error"] = {"message": result.content[0].text}
            emit({"type": "item.completed", "item": item})
    emit({"type": "item.completed", "item": {"type": "agent_message", "text": "Done."}})
    emit({"type": "turn.completed", "usage": {"input_tokens": 1200, "output_tokens": 80}})


asyncio.run(main())
