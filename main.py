"""
claude_output – real-time session streaming server.

Exposes two endpoints:
  POST /stream   – accepts a JSON body {prompt, model, system} and returns an
                   SSE stream of the Claude response as it is generated.
  GET  /         – serves the built-in HTML/JS viewer.
"""

import json
import logging
import os
from pathlib import Path
from typing import AsyncIterator

import anthropic
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

_STATIC_DIR = Path(__file__).resolve().parent / "static"

load_dotenv()

app = FastAPI(title="claude_output", description="Stream Claude session content in real-time")

DEFAULT_MODEL = "claude-opus-4-5"
DEFAULT_MAX_TOKENS = 4096


class PromptRequest(BaseModel):
    prompt: str
    model: str = DEFAULT_MODEL
    system: str = "You are a helpful assistant."
    max_tokens: int = DEFAULT_MAX_TOKENS


async def _sse_generator(request: PromptRequest) -> AsyncIterator[str]:
    """Yield SSE-formatted chunks as Claude streams its response."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        yield _sse_event("error", {"message": "ANTHROPIC_API_KEY is not set"})
        return

    client = anthropic.Anthropic(api_key=api_key)

    try:
        with client.messages.stream(
            model=request.model,
            max_tokens=request.max_tokens,
            system=request.system,
            messages=[{"role": "user", "content": request.prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield _sse_event("delta", {"text": text})
            message = stream.get_final_message()
            yield _sse_event(
                "done",
                {
                    "input_tokens": message.usage.input_tokens,
                    "output_tokens": message.usage.output_tokens,
                    "stop_reason": message.stop_reason,
                },
            )
    except anthropic.APIStatusError as exc:
        yield _sse_event("error", {"message": f"API error {exc.status_code}"})
    except anthropic.APIConnectionError:
        yield _sse_event("error", {"message": "Connection to the Anthropic API failed"})
    except anthropic.APIError:
        yield _sse_event("error", {"message": "An error occurred while calling the Anthropic API"})


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/stream")
async def stream_response(request: PromptRequest) -> StreamingResponse:
    """Stream a Claude response for the given prompt via Server-Sent Events."""
    return StreamingResponse(
        _sse_generator(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/", response_class=HTMLResponse)
async def index() -> str:
    """Serve the real-time viewer UI."""
    html_path = (_STATIC_DIR / "index.html").resolve()
    if not html_path.is_relative_to(_STATIC_DIR):
        raise HTTPException(status_code=403, detail="Forbidden")
    try:
        return html_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Frontend file not found")
