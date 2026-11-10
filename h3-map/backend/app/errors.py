"""Error envelope (API_SPECIFICATION section 2) and exception handlers.

Nothing that reaches a client may contain SQL, host names or credentials, so
database errors are mapped to fixed codes and messages; the raw exception is
only logged (and the log filter redacts secrets).
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

import psycopg
import psycopg_pool
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg import errors as pgerr
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("h3map.errors")

STATUS_CODES = {
    400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found",
    405: "method_not_allowed", 409: "conflict", 413: "payload_too_large", 422: "validation_error",
    429: "rate_limited", 500: "internal_error", 502: "db_unavailable", 504: "query_timeout",
}


class ApiError(Exception):
    def __init__(self, status: int, code: str | None = None, message: str = "", details: dict | None = None,
                 headers: dict[str, str] | None = None):
        self.status = status
        self.code = code or STATUS_CODES.get(status, "error")
        self.message = message or self.code.replace("_", " ")
        self.details = details or {}
        self.headers = headers
        super().__init__(self.message)


def bad_request(message: str, **details: Any) -> ApiError:
    return ApiError(400, "bad_request", message, details)


def not_found(message: str, **details: Any) -> ApiError:
    return ApiError(404, "not_found", message, details)


def invalid_filter(message: str, **details: Any) -> ApiError:
    return ApiError(422, "invalid_filter", message, details)


def validation_error(message: str, **details: Any) -> ApiError:
    return ApiError(422, "validation_error", message, details)


def request_id_of(request: Request) -> str:
    return getattr(request.state, "request_id", None) or uuid.uuid4().hex


def envelope(request: Request, status: int, code: str, message: str, details: dict | None = None,
             headers: dict[str, str] | None = None) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "details": details or {}, "requestId": request_id_of(request)}}
    return JSONResponse(body, status_code=status, headers=headers)


def map_db_error(exc: BaseException) -> ApiError:
    """Translate a driver exception to a fixed, non-leaking API error."""
    if isinstance(exc, pgerr.QueryCanceled):
        return ApiError(504, "query_timeout", "The query took too long. Narrow the bounding box or add a filter.")
    if isinstance(exc, pgerr.InsufficientPrivilege):
        return ApiError(403, "forbidden", "The database role has no access to this object.")
    if isinstance(exc, (pgerr.UndefinedTable, pgerr.UndefinedColumn, pgerr.InvalidSchemaName)):
        return ApiError(404, "not_found", "The requested database object does not exist.")
    if isinstance(exc, (pgerr.DataError, pgerr.InvalidTextRepresentation, pgerr.InvalidParameterValue)):
        return ApiError(422, "invalid_filter", "A value could not be used with the column type.")
    if isinstance(exc, pgerr.ReadOnlySqlTransaction):
        return ApiError(403, "forbidden", "The connection is read-only.")
    if isinstance(exc, (psycopg_pool.PoolTimeout, psycopg_pool.PoolClosed, psycopg.OperationalError)):
        return ApiError(502, "db_unavailable", "The database is not reachable.")
    return ApiError(500, "internal_error", "Internal error.")


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError):
        return envelope(request, exc.status, exc.code, exc.message, exc.details, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        errs = [{"loc": [str(p) for p in e.get("loc", ())], "msg": str(e.get("msg", "")), "type": e.get("type", "")}
                for e in exc.errors()]
        return envelope(request, 422, "validation_error", "Request validation failed", {"errors": errs[:20]})

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        code = STATUS_CODES.get(exc.status_code, "error")
        msg = exc.detail if isinstance(exc.detail, str) and exc.status_code < 500 else code.replace("_", " ")
        return envelope(request, exc.status_code, code, msg, headers=getattr(exc, "headers", None))

    @app.exception_handler(psycopg.Error)
    @app.exception_handler(psycopg_pool.PoolTimeout)
    async def _db(request: Request, exc: Exception):
        mapped = map_db_error(exc)
        log.warning("database error on %s: %s (%s)", request.url.path, type(exc).__name__, mapped.code)
        return envelope(request, mapped.status, mapped.code, mapped.message, mapped.details)

    @app.exception_handler(Exception)
    async def _any(request: Request, exc: Exception):
        log.exception("unhandled error on %s", request.url.path)
        return envelope(request, 500, "internal_error", "Internal error.")
