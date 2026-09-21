"""Security helpers for accepting and downloading image files.

The local API receives both browser uploads and cover URLs returned by remote
services.  Keep all size, format, and network-boundary checks in one place so
that callers cannot accidentally bypass them.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re
import socket
import uuid
import warnings
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import requests
from PIL import Image, UnidentifiedImageError

from .errors import (
    ImageImportError,
    InvalidInputError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
MAX_IMAGE_DIMENSION = 20_000
MAX_REDIRECTS = 5
STREAM_CHUNK_SIZE = 64 * 1024
TRANSPARENT_PROXY_FAKE_IP_RANGE = ipaddress.ip_network("198.18.0.0/15")

ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP", "GIF", "BMP"}
FORMAT_EXTENSIONS = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
    "GIF": ".gif",
    "BMP": ".bmp",
}
ALLOWED_REMOTE_CONTENT_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/x-ms-bmp",
}

# These are the CDNs currently used by the built-in integrations.  Other
# public image hosts remain supported, but are still subject to DNS/IP checks.
KNOWN_COVER_HOST_SUFFIXES = (
    "images.igdb.com",
    "lain.bgm.tv",
    "image.bgm.tv",
    "steamstatic.com",
    "steamcdn-a.akamaihd.net",
    "store-images.s-microsoft.com",
    "store-images.microsoft.com",
    "assets.xboxservices.com",
    "image.api.playstation.com",
    "image.api.np.km.playstation.net",
    "app-api.znej.nintendo.com",
    "mypage-api.entry.nintendo.co.jp",
    "ec.nintendo.com",
    "atum-img-lp1.cdn.nintendo.net",
    "cdn.steamgriddb.com",
    "cdn2.steamgriddb.com",
    "t.vndb.org",
    "s.vndb.org",
)
WINDOWS_RESERVED_STEMS = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


class RemoteImageNotFoundError(InvalidInputError):
    """The remote cover URL returned HTTP 404."""

    code = "remote_image_not_found"
    default_message = "远程图片不存在或已失效"


def safe_cache_key(value: object) -> str:
    """Return a path-safe, deterministic key for a remote provider ID."""
    raw = str(value).strip()
    if (
        raw
        and len(raw) <= 128
        and re.fullmatch(r"[A-Za-z0-9_-]+", raw)
        and raw.upper() not in WINDOWS_RESERVED_STEMS
    ):
        return raw

    import hashlib

    return hashlib.sha256(raw.encode("utf-8", errors="replace")).hexdigest()


def validate_image_id(value: object) -> str:
    """Validate an existing image identifier before using it in a path."""
    image_id = str(value or "").strip()
    if (
        not image_id
        or len(image_id) > 128
        or not re.fullmatch(r"[A-Za-z0-9_-]+", image_id)
        or image_id.upper() in WINDOWS_RESERVED_STEMS
    ):
        raise InvalidInputError(
            "图片标识格式不正确",
            code="image_id_invalid",
        )
    return image_id


def safe_original_filename(filename: str | None, extension: str) -> str:
    """Sanitize an upload name for metadata; it is never used as a path."""
    raw = os.path.basename(
        (filename or "").replace("\x00", "").replace("\\", "/")
    )
    stem = os.path.splitext(raw)[0]
    stem = "".join(ch for ch in stem if ch.isprintable()).strip(" .")
    if not stem:
        stem = "upload"
    return f"{stem[:160]}{extension}"


def validate_image_file(path: str | os.PathLike[str]) -> str:
    """Verify an image and return its canonical file extension.

    The first pass uses Pillow's structural verification.  The second pass
    decodes the pixels so truncated/corrupt payloads are rejected before they
    reach the persistent image library.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(path) as image:
                image_format = (image.format or "").upper()
                width, height = image.size
                _validate_image_properties(image_format, width, height)
                image.verify()

            with Image.open(path) as image:
                _validate_image_properties(
                    (image.format or "").upper(), *image.size
                )
                image.load()
    except (
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        SyntaxError,
        UnidentifiedImageError,
        ValueError,
    ) as exc:
        raise InvalidInputError(
            "上传的文件不是有效图片，或图片尺寸过大",
            code="upload_invalid_image",
        ) from exc

    return FORMAT_EXTENSIONS[image_format]


def _validate_image_properties(image_format: str, width: int, height: int) -> None:
    if image_format not in ALLOWED_IMAGE_FORMATS:
        raise ValueError("unsupported image format")
    if width <= 0 or height <= 0:
        raise ValueError("invalid image dimensions")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        raise ValueError("image dimension exceeds limit")
    if width * height > MAX_IMAGE_PIXELS:
        raise ValueError("image pixel count exceeds limit")


def _normalize_and_validate_url(url: str) -> str:
    if not isinstance(url, str):
        raise InvalidInputError(
            "图片地址格式不正确",
            code="remote_image_url_invalid",
        )
    candidate = url.strip()
    if candidate.startswith("//"):
        candidate = "https:" + candidate
    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError as exc:
        raise InvalidInputError(
            "图片地址格式不正确",
            code="remote_image_url_invalid",
        ) from exc

    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise InvalidInputError(
            "图片地址仅支持 HTTP 或 HTTPS",
            code="remote_image_url_invalid",
        )
    if parsed.username is not None or parsed.password is not None:
        raise InvalidInputError(
            "图片地址不能包含登录信息",
            code="remote_image_url_invalid",
        )
    if port is not None and not 1 <= port <= 65535:
        raise InvalidInputError(
            "图片地址端口无效",
            code="remote_image_url_invalid",
        )

    _validate_public_host(parsed.hostname, port, parsed.scheme.lower())
    return candidate


def _validate_public_host(hostname: str, port: int | None, scheme: str) -> None:
    lookup_port = port or (443 if scheme == "https" else 80)
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(
                hostname,
                lookup_port,
                type=socket.SOCK_STREAM,
            )
        }
    except (OSError, socket.gaierror) as exc:
        raise RemoteServiceError(
            "无法解析远程图片地址",
            code="remote_image_dns_failed",
        ) from exc

    if not addresses:
        raise RemoteServiceError(
            "无法解析远程图片地址",
            code="remote_image_dns_failed",
        )

    for address in addresses:
        _validate_public_ip(
            address,
            allow_transparent_proxy=_is_known_cover_host(hostname),
        )


def _validate_public_ip(
    address: str,
    *,
    allow_transparent_proxy: bool = False,
) -> None:
    try:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
    except ValueError as exc:
        raise InvalidInputError(
            "图片地址解析结果无效",
            code="remote_image_host_blocked",
        ) from exc
    # Some transparent proxy/VPN clients intentionally resolve intercepted
    # domains into RFC 2544's benchmark range.  Permit that range only for the
    # built-in, fixed cover CDNs; arbitrary user-provided hosts remain blocked.
    if allow_transparent_proxy and ip in TRANSPARENT_PROXY_FAKE_IP_RANGE:
        return
    if not ip.is_global:
        raise InvalidInputError(
            "不允许从本机或私有网络下载图片",
            code="remote_image_host_blocked",
        )


def _validate_connected_peer(
    response: requests.Response,
    *,
    allow_transparent_proxy: bool = False,
) -> None:
    """Verify the actual socket peer after DNS resolution and connection."""
    connection = getattr(response.raw, "_connection", None)
    sock = getattr(connection, "sock", None)
    if sock is None:
        if allow_transparent_proxy:
            # Some transparent proxies fully consume a response before
            # requests exposes the socket. This compatibility exception is
            # limited to fixed built-in CDNs whose DNS result was already
            # checked; when a peer is available it is always validated below.
            return
        raise RemoteResponseError(
            "无法确认远程图片服务器地址",
            code="remote_image_peer_unavailable",
        )
    try:
        peer = sock.getpeername()[0]
    except (OSError, TypeError, IndexError) as exc:
        raise RemoteResponseError(
            "无法确认远程图片服务器地址",
            code="remote_image_peer_unavailable",
        ) from exc
    _validate_public_ip(peer, allow_transparent_proxy=allow_transparent_proxy)


def _is_known_cover_host(hostname: str) -> bool:
    host = hostname.rstrip(".").lower()
    return any(host == suffix or host.endswith("." + suffix) for suffix in KNOWN_COVER_HOST_SUFFIXES)


def download_public_image(url: str, destination: str | os.PathLike[str]) -> str:
    """Stream a public HTTP(S) image to disk and return the final path.

    Redirects are handled manually so every hop receives the same scheme and
    DNS/IP validation.  The file is made visible only after type/size/Pillow
    validation succeeds.
    """
    current_url = _normalize_and_validate_url(url)
    destination_path = Path(destination)
    try:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise ImageImportError(
            "无法创建图片缓存目录，请检查数据目录权限",
            code="image_cache_directory_failed",
        ) from exc
    temporary_path = destination_path.with_name(
        f".{destination_path.name}.{uuid.uuid4().hex}.part"
    )

    session = requests.Session()
    # Ignore machine-wide proxy settings: otherwise DNS validation would
    # cover the requested host while the proxy could connect elsewhere.
    session.trust_env = False
    response = None
    try:
        for redirect_count in range(MAX_REDIRECTS + 1):
            current_url = _normalize_and_validate_url(current_url)
            hostname = urlsplit(current_url).hostname or ""
            if not _is_known_cover_host(hostname):
                logger.debug("远程图片来自非内置 CDN: %s", hostname)

            try:
                response = session.get(
                    current_url,
                    allow_redirects=False,
                    stream=True,
                    timeout=(10, 30),
                    headers={"Accept": "image/jpeg,image/png,image/webp,image/gif,image/bmp"},
                )
            except requests.exceptions.Timeout as exc:
                raise RemoteTimeoutError(
                    "远程图片下载超时，请检查网络连接",
                    code="remote_image_timeout",
                ) from exc
            except requests.exceptions.RequestException as exc:
                raise RemoteServiceError(
                    "无法连接远程图片服务器",
                    code="remote_image_download_failed",
                ) from exc

            _validate_connected_peer(
                response,
                allow_transparent_proxy=_is_known_cover_host(hostname),
            )

            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("Location", "").strip()
                response.close()
                response = None
                if not location:
                    raise RemoteResponseError(
                        "远程图片重定向地址无效",
                        code="remote_image_redirect_invalid",
                    )
                if redirect_count >= MAX_REDIRECTS:
                    raise RemoteResponseError(
                        "远程图片重定向次数过多",
                        code="remote_image_too_many_redirects",
                    )
                current_url = urljoin(current_url, location)
                continue
            break

        if response is None:
            raise RemoteServiceError(
                "远程图片下载失败",
                code="remote_image_download_failed",
            )
        if response.status_code == 404:
            raise RemoteImageNotFoundError()
        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            raise RemoteServiceError(
                "远程图片服务器暂时无法完成请求",
                code="remote_image_http_error",
            ) from exc

        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type not in ALLOWED_REMOTE_CONTENT_TYPES:
            raise RemoteResponseError(
                "远程地址返回的内容不是受支持的图片",
                code="remote_image_content_type_invalid",
            )

        content_length = response.headers.get("Content-Length")
        if content_length:
            try:
                declared_size = int(content_length)
            except ValueError as exc:
                raise RemoteResponseError(
                    "远程图片响应长度无效",
                    code="remote_image_response_invalid",
                ) from exc
            if declared_size < 0 or declared_size > MAX_REMOTE_IMAGE_BYTES:
                raise RemoteResponseError(
                    "远程图片文件过大",
                    code="remote_image_too_large",
                )

        total = 0
        try:
            with temporary_path.open("xb") as output:
                for chunk in response.iter_content(chunk_size=STREAM_CHUNK_SIZE):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if total > MAX_REMOTE_IMAGE_BYTES:
                        raise RemoteResponseError(
                            "远程图片文件过大",
                            code="remote_image_too_large",
                        )
                    output.write(chunk)
        except requests.exceptions.Timeout as exc:
            raise RemoteTimeoutError(
                "远程图片下载超时，请检查网络连接",
                code="remote_image_timeout",
            ) from exc
        except requests.exceptions.RequestException as exc:
            raise RemoteServiceError(
                "远程图片下载中断，请稍后重试",
                code="remote_image_download_failed",
            ) from exc
        except OSError as exc:
            raise ImageImportError(
                "无法暂存远程图片，请检查磁盘空间和数据目录权限",
                code="image_cache_write_failed",
            ) from exc

        if total == 0:
            raise RemoteResponseError(
                "远程图片内容为空",
                code="remote_image_empty",
            )

        try:
            extension = validate_image_file(temporary_path)
        except InvalidInputError as exc:
            raise RemoteResponseError(
                "远程地址返回的图片内容无效",
                code="remote_image_invalid",
            ) from exc

        final_path = destination_path.with_suffix(extension)
        try:
            os.replace(temporary_path, final_path)
        except OSError as exc:
            raise ImageImportError(
                "无法保存远程图片，请检查磁盘空间和数据目录权限",
                code="image_cache_write_failed",
            ) from exc
        return str(final_path)
    finally:
        if response is not None:
            response.close()
        session.close()
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            logger.warning("清理远程图片临时文件失败: %s", temporary_path)
