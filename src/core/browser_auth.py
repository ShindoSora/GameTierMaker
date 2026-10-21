"""One bounded, cancellable login operation; public status never includes credentials."""
from __future__ import annotations

import secrets
import re
import math
import threading
import time
from dataclasses import dataclass
from urllib.parse import parse_qs, urlsplit

from src.core.errors import AppError, InvalidInputError, RemoteServiceError

AUTH_TIMEOUT = 15 * 60
# Sony supplies the current sign-in URL and OAuth parameters via this official entry.
PSN_LOGIN_URL = "https://www.playstation.com/acct/management"
NPSSO_PATTERN = re.compile(r"[A-Za-z0-9._~+-]{32,1024}\Z")
TERMINAL = {"complete", "error", "cancelled"}
HOSTS = {
    "steam": ("steamcommunity.com", "steampowered.com"),
    "psn": ("playstation.com", "sony.com", "sonyentertainmentnetwork.com", "sonyaccount.com"),
    "xbox": ("live.com", "microsoft.com", "microsoftonline.com", "msauth.net", "msftauth.net", "xbox.com", "passport.net"),
    "nintendo": ("nintendo.com", "google.com", "apple.com", "facebook.com"),
}


class PsnLoginRateLimitError(RemoteServiceError):
    code = "psn_login_rate_limited"

    def __init__(self, retry_after=60, *, message=None):
        self.retry_after = max(0, math.ceil(retry_after))
        super().__init__(message or f"Sony 暂时限制了登录请求（HTTP 429），本次登录已停止，请至少等待 {self.retry_after} 秒后再试")


@dataclass
class BrowserSpec:
    platform: str
    url: str
    callback: str = ""


def is_callback(url, expected):
    """Exact origin/path and pinned query values, including the Steam operation id."""
    if not expected or not isinstance(url, str) or len(url) > 16384:
        return False
    try:
        actual, wanted = urlsplit(url), urlsplit(expected)
        if actual.username or actual.password:
            return False
        if (actual.scheme, actual.hostname, actual.port, actual.path) != (
            wanted.scheme, wanted.hostname, wanted.port, wanted.path
        ):
            return False
        query = parse_qs(actual.query)
        return all(query.get(key) == value for key, value in parse_qs(wanted.query).items())
    except ValueError:
        return False


def allowed_navigation(spec, url):
    if is_callback(url, spec.callback):
        return True
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in {None, 443}:
            return False
        host = (parsed.hostname or "").lower()
        return any(host == suffix or host.endswith("." + suffix) for suffix in HOSTS[spec.platform])
    except (ValueError, KeyError):
        return False


class BrowserAuth:
    def __init__(self):
        self.lock = threading.RLock()
        self.jobs = {}
        self.host = None
        self.blocked_until = {}

    def start(self, prepare, *, platform=""):
        with self.lock:
            host = self.host
            if host is None:
                raise AppError("后台浏览器尚未就绪，请重新启动程序", code="local_browser_start_failed")
            now = time.monotonic()
            remaining = math.ceil(self.blocked_until.get(platform, 0) - now)
            if remaining > 0:
                raise PsnLoginRateLimitError(remaining,
                    message=f"Sony 暂时限制了登录请求（HTTP 429），请至少等待 {remaining} 秒后再试")
            self.jobs = {key: job for key, job in self.jobs.items()
                         if job["status"] not in TERMINAL or now - job["created"] < AUTH_TIMEOUT}
            if any(job["status"] not in TERMINAL for job in self.jobs.values()):
                raise InvalidInputError("已有登录正在进行，请先完成或关闭当前登录", code="browser_auth_busy")
            browser = host.new_session()
            spec, complete = prepare()
            if not allowed_navigation(spec, spec.url):
                raise InvalidInputError("登录地址无效", code="browser_auth_url_invalid")
            operation_id = secrets.token_urlsafe(24)
            job = {"operation_id": operation_id, "platform": spec.platform, "status": "waiting",
                   "mode": browser.mode, "display_host": urlsplit(spec.url).hostname,
                   "created": now, "browser": browser, "message": "", "error": ""}
            self.jobs[operation_id] = job
            threading.Thread(target=self._run, args=(job, spec, complete), daemon=True).start()
            return self.status(operation_id)

    def _run(self, job, spec, complete):
        try:
            secret = job["browser"].run(spec, AUTH_TIMEOUT)
            with self.lock:
                if job["status"] == "cancelled":
                    return
                job["status"] = "binding"
            result = complete(secret)
            with self.lock:
                # Only binding results are public. Browser credentials never enter this dict.
                safe_keys = {"ok", "total", "account_id", "online_id", "xuid", "gamertag", "operation_id", "steamid", "nickname"}
                job.update(status="complete", result={key: value for key, value in result.items() if key in safe_keys})
        except AppError as exc:
            with self.lock:
                if isinstance(exc, PsnLoginRateLimitError) and job["platform"] == "psn":
                    self.blocked_until["psn"] = max(self.blocked_until.get("psn", 0),
                                                   time.monotonic() + exc.retry_after)
                    job["retry_after"] = exc.retry_after
                if job["status"] != "cancelled":
                    job.update(status="cancelled" if exc.code == "browser_auth_cancelled" else "error",
                               error=exc.code, message=exc.message)
        except Exception:
            # Network exceptions can embed OAuth URLs; do not log their repr/traceback.
            with self.lock:
                if job["status"] != "cancelled":
                    job.update(status="error", error="browser_auth_failed", message="登录或账号绑定失败，请重试")
        finally:
            job["browser"].close()

    def status(self, operation_id):
        with self.lock:
            job = self.jobs.get(operation_id)
            if not job:
                raise InvalidInputError("登录会话已失效，请重新绑定", code="browser_auth_expired")
            return {key: value for key, value in job.items() if key not in {"created", "browser"}}

    def cancel(self, operation_id):
        with self.lock:
            job = self.jobs.get(operation_id)
            if not job:
                return {"ok": True}
            if job["status"] == "binding":
                raise InvalidInputError("正在完成绑定，请稍候", code="browser_auth_binding")
            if job["status"] in TERMINAL:
                return {"ok": True}
            job["status"] = "cancelled"
            browser = job["browser"]
        browser.close()
        return {"ok": True}

    def stream_browser(self, operation_id):
        with self.lock:
            job = self.jobs.get(operation_id)
            if not job or job["status"] != "waiting" or job["mode"] != "stream":
                raise InvalidInputError("登录会话已失效", code="browser_auth_expired")
            return job["browser"]

    def shutdown(self):
        with self.lock:
            operations = [key for key, job in self.jobs.items() if job["status"] == "waiting"]
        for operation_id in operations:
            self.cancel(operation_id)


browser_auth = BrowserAuth()
