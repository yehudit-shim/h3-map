"""Cancel a running query when the HTTP client goes away (API_SPECIFICATION section 13)."""
from __future__ import annotations

import asyncio
import contextlib
from typing import Protocol

from psycopg import AsyncConnection


class _Req(Protocol):
    async def is_disconnected(self) -> bool: ...


@contextlib.asynccontextmanager
async def cancel_on_disconnect(request: _Req, conn: AsyncConnection, interval: float = 0.2):
    """While the body runs, poll the request; on disconnect send a server-side cancel.
    The running ``execute`` then raises QueryCanceled and the connection stays usable."""
    fired = asyncio.Event()

    async def watch() -> None:
        while True:
            await asyncio.sleep(interval)
            if await request.is_disconnected():
                fired.set()
                with contextlib.suppress(Exception):
                    await conn.cancel_safe()
                return

    task = asyncio.create_task(watch())
    try:
        yield fired
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
