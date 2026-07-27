"""In-memory log feed for the current application run.

The regular stream and file handlers remain the source of persistent logs.  This
handler only keeps a bounded, structured copy for the local web UI, so every new
process starts with an empty panel while ``logs/app.log`` keeps its history.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime
import logging
import os
import re
import threading
import uuid
from pathlib import Path


_SENSITIVE_VALUE_RE = re.compile(
    r"(?i)(\b(?:npsso|access[_-]?token|refresh[_-]?token|client[_-]?secret|"
    r"bangumi[_-]?token|steam[_-]?key|api[\s_-]?key|authorization)\b"
    r"\s*[\"']?\s*[:=]\s*[\"']?)([^\"',;\s}]+)"
)
_BEARER_TOKEN_RE = re.compile(r"(?i)(\bbearer\s+)([^\s,;]+)")


def _redact_message(message: str) -> str:
    message = _BEARER_TOKEN_RE.sub(r"\1***", message)
    return _SENSITIVE_VALUE_RE.sub(r"\1***", message)


class RedactingFormatter(logging.Formatter):
    """Redact credentials from complete formatted output, including tracebacks."""

    def format(self, record: logging.LogRecord) -> str:
        return _redact_message(super().format(record))


class SessionLogHandler(logging.Handler):
    """Capture structured log records from this process in a bounded buffer."""

    def __init__(self, max_entries: int = 2000) -> None:
        super().__init__(level=logging.DEBUG)
        self.max_entries = max(1, int(max_entries))
        self.session_id = uuid.uuid4().hex[:12]
        self.started_at = datetime.now().astimezone().isoformat(timespec="seconds")
        self._entries: deque[dict[str, object]] = deque(maxlen=self.max_entries)
        self._next_id = 1
        self._clear_version = 0
        self._lock = threading.RLock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
            if record.exc_info:
                exception_text = self.formatter.formatException(record.exc_info) if self.formatter else logging.Formatter().formatException(record.exc_info)
                if exception_text:
                    message = f"{message}\n{exception_text}"
            message = _redact_message(message)

            timestamp = datetime.fromtimestamp(record.created).astimezone()
            entry = {
                "id": 0,
                "timestamp": timestamp.isoformat(timespec="milliseconds"),
                "time": timestamp.strftime("%H:%M:%S"),
                "level": record.levelname,
                "logger": record.name,
                "message": message,
            }
            with self._lock:
                entry["id"] = self._next_id
                self._next_id += 1
                self._entries.append(entry)
        except Exception:
            self.handleError(record)

    def snapshot(self, after_id: int = 0) -> dict[str, object]:
        """Return entries newer than *after_id* and current session metadata."""
        with self._lock:
            entries = [dict(entry) for entry in self._entries if int(entry["id"]) > after_id]
            return {
                "session_id": self.session_id,
                "started_at": self.started_at,
                "clear_version": self._clear_version,
                "entries": entries,
                "total": len(self._entries),
            }

    def clear_session(self) -> dict[str, object]:
        """Clear only the UI buffer; the persistent log file is untouched."""
        with self._lock:
            self._entries.clear()
            self._clear_version += 1
            return {
                "session_id": self.session_id,
                "clear_version": self._clear_version,
                "total": 0,
            }


session_log_handler = SessionLogHandler()


def clear_persistent_log_file() -> dict[str, int]:
    """Truncate current and legacy app.log files without deleting them."""
    root_path = Path(os.environ.get("GAMELIST_ROOT", Path.cwd()))
    log_paths = (
        root_path / "logs" / "app.log",
        root_path / "config" / "app.log",
    )
    file_handlers = [
        handler
        for handler in logging.getLogger().handlers
        if isinstance(handler, logging.FileHandler)
    ]
    removed_bytes = 0
    cleared_files = 0

    for log_path in log_paths:
        if not log_path.exists() and log_path.parent.name == "config":
            continue
        try:
            removed_bytes += log_path.stat().st_size
        except FileNotFoundError:
            pass

        target = os.path.normcase(os.path.abspath(log_path))
        matching_handlers = [
            handler
            for handler in file_handlers
            if os.path.normcase(os.path.abspath(handler.baseFilename)) == target
        ]
        if matching_handlers:
            for handler in matching_handlers:
                handler.acquire()
                try:
                    handler.flush()
                    handler.stream.seek(0)
                    handler.stream.truncate(0)
                    handler.flush()
                finally:
                    handler.release()
        else:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_path.write_text("", encoding="utf-8")
        cleared_files += 1

    return {"removed_bytes": removed_bytes, "cleared_files": cleared_files}


def install_session_log_handler() -> SessionLogHandler:
    """Attach the session handler to the root logger exactly once."""
    root_logger = logging.getLogger()
    if session_log_handler not in root_logger.handlers:
        root_logger.addHandler(session_log_handler)
    return session_log_handler
