"""Security policy for the loopback-only desktop HTTP server."""

from urllib.parse import urlsplit


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https:; "
        "connect-src 'self'; "
        "font-src 'self' data:; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


def is_allowed_local_origin(origin: str, expected_port: int | None) -> bool:
    """Return True only for this application's loopback HTTP origin."""
    try:
        parsed = urlsplit(origin)
        if parsed.scheme != "http" or parsed.hostname not in LOOPBACK_HOSTS:
            return False
        origin_port = parsed.port or 80
        return expected_port is not None and origin_port == expected_port
    except (TypeError, ValueError):
        return False


def apply_security_headers(response):
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    return response
