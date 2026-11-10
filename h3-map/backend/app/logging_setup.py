"""Logging with secret redaction. Secrets (passwords, tokens) are registered at
startup; any log record that contains one has it replaced before output."""
from __future__ import annotations

import logging
import re

_SECRETS: set[str] = set()
_DSN_PASSWORD = re.compile(r"(postgres(?:ql)?://[^:/\s]+:)([^@\s]+)(@)", re.I)
_KV_PASSWORD = re.compile(r"(password\s*=\s*)(\S+)", re.I)


def register_secret(value: str | None) -> None:
    if value and len(value) >= 3:
        _SECRETS.add(value)


def redact(text: str) -> str:
    for s in sorted(_SECRETS, key=len, reverse=True):
        text = text.replace(s, "***")
    text = _DSN_PASSWORD.sub(r"\1***\3", text)
    return _KV_PASSWORD.sub(r"\1***", text)


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # pragma: no cover - malformed log call
            return True
        red = redact(msg)
        if red != msg:
            record.msg, record.args = red, None
        if record.exc_info and record.exc_info[1] is not None:
            record.exc_text = redact(logging.Formatter().formatException(record.exc_info))
            record.exc_info = None
        return True


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.setLevel(level)
    if not any(isinstance(f, RedactingFilter) for f in root.filters):
        root.addFilter(RedactingFilter())
    for h in root.handlers:
        if not any(isinstance(f, RedactingFilter) for f in h.filters):
            h.addFilter(RedactingFilter())
    if not root.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        h.addFilter(RedactingFilter())
        root.addHandler(h)
