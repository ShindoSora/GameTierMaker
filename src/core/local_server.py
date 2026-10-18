"""Reserve the local listener before startup and verify the owning server."""
from __future__ import annotations

from dataclasses import dataclass
import errno
import hashlib
from http.client import HTTPConnection, HTTPException
import json
import os
from pathlib import Path
import socket
import time
from urllib.parse import urlsplit

SERVICE_NAME = "GameTierMaker"


def workspace_identity(root):
    normalized = os.path.normcase(str(Path(root).resolve()))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


@dataclass
class LocalBinding:
    listener: socket.socket | None
    port: int
    reused: bool = False
    fallback_error: OSError | None = None


def _bind_socket(host, port):
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.set_inheritable(False)
        listener.bind((host, port))
        listener.listen(128)
        return listener
    except BaseException:
        listener.close()
        raise


def _port_unavailable(error):
    return (error.errno in {errno.EACCES, errno.EADDRINUSE}
            or getattr(error, "winerror", None) in {10013, 10048})


def _same_service(host, port, identity):
    connection = HTTPConnection(host, port, timeout=.5)
    try:
        connection.request("GET", "/api/health")
        response = connection.getresponse()
        body = json.loads(response.read(4097))
        return (response.status == 200 and isinstance(body, dict)
                and body.get("status") == "ok" and body.get("service") == SERVICE_NAME
                and body.get("workspace_id") == identity)
    except (OSError, HTTPException, ValueError):
        return False
    finally:
        connection.close()


def reserve_listener(host, port, *, allow_fallback=False, identity=None):
    """Keep the socket open; an explicit requested port is never substituted."""
    if not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("端口必须在 0 到 65535 之间")
    try:
        listener = _bind_socket(host, port)
        return LocalBinding(listener, listener.getsockname()[1])
    except OSError as first_error:
        if not _port_unavailable(first_error) or port == 0:
            raise
        if identity and _same_service(host, port, identity):
            return LocalBinding(None, port, reused=True)
        if not allow_fallback:
            raise
        candidates = [*range(port + 1, min(port + 10, 65535) + 1), 0]
        for candidate in candidates:
            try:
                listener = _bind_socket(host, candidate)
                return LocalBinding(listener, listener.getsockname()[1], fallback_error=first_error)
            except OSError as error:
                if not _port_unavailable(error) or candidate == 0:
                    raise
        raise first_error


def wait_for_local_server(url, thread, get_server, timeout=15):
    """A healthy unrelated listener cannot stand in for the new server thread."""
    parsed = urlsplit(url)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not thread.is_alive():
            return False
        server = get_server()
        if server is None or not server.started:
            time.sleep(.05)
            continue
        connection = HTTPConnection(parsed.hostname, parsed.port, timeout=.5)
        try:
            connection.request("GET", "/api/health")
            response = connection.getresponse()
            response.read()
            if response.status == 200 and thread.is_alive():
                return True
        except (OSError, HTTPException):
            pass
        finally:
            connection.close()
        time.sleep(.05)
    return False
