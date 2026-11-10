"""Invisible, isolated login sessions streamed to the UI over CDP messages.

This is the shared session logic. The concrete browser (see webview_browser.py)
supplies ``_start_browser`` and ``_attach``. Credentials and debugger addresses
never enter public status messages.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import math
from pathlib import Path
import queue
import secrets
import shutil
import subprocess
import tempfile
import threading
import time
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit

from src.core.browser_auth import NPSSO_PATTERN, PsnLoginRateLimitError, allowed_navigation, is_callback
from src.core.errors import AppError, RemoteServiceError, RemoteTimeoutError

SONY_COOKIE_URL = "https://ca.account.sony.com/api/v1/ssocookie"
SONY_AUTH_HOSTS = {"my.account.sony.com", "ca.account.sony.com", "id.sonyentertainmentnetwork.com"}
logger = logging.getLogger(__name__)
for _logger in ("websockets", "websockets.client", "websockets.server"):
    logging.getLogger(_logger).setLevel(logging.WARNING)


def is_sony_credential_document(url):
    parsed = urlsplit(url or "")
    return (parsed.scheme, parsed.netloc, parsed.path) == ("https", "ca.account.sony.com", "/api/v1/ssocookie")


class PrivateTransportFilter(logging.Filter):
    """Uvicorn's websocket library can log complete input frames in DEBUG mode."""
    def filter(self, record):
        return record.levelno > logging.DEBUG


def protect_transport_logs():
    logger = logging.getLogger("uvicorn.error")
    if not any(isinstance(item, PrivateTransportFilter) for item in logger.filters):
        logger.addFilter(PrivateTransportFilter())


def sony_retry_after(headers):
    """Read only the public retry delay, never retain authentication headers."""
    value = next((value for key, value in headers.items() if key.lower() == "retry-after"), None)
    if isinstance(value, str) and len(value) <= 128:
        value = value.strip()
        if value.isascii() and value.isdecimal():
            return int(value)
        try:
            return max(0, math.ceil(parsedate_to_datetime(value).timestamp() - time.time()))
        except (ValueError, TypeError, OverflowError):
            pass
    return 60  # Local backoff when Sony doesn't provide a usable delay.


class ReusedBrowserSession:
    mode = "stream"
    adjust_user_agent = True

    def __init__(self, executable, engine_name):
        self.executable, self.engine_name = Path(executable), engine_name
        self.condition = threading.Condition()
        self.inputs = queue.Queue(maxsize=512)
        self.cancelled = threading.Event()
        self.finished = threading.Event()
        self.sequence = 0
        self.frame = None
        self.metadata = {"type": "state", "engine": engine_name, "host": "", "canBack": False, "canForward": False}
        self.viewport = {"width": 1000, "height": 700}
        # Pixel density of the viewer's screen, so frames are rendered sharp on high-DPI
        # displays instead of being stretched from 1x. Capped to keep frames reasonably small.
        self.scale = 1.0
        # The screencast stream always delivers frames at CSS size, whatever the pixel density.
        # On high-DPI screens it is only used to notice changes; a sharp screenshot is sent instead.
        self.sharp_request = None
        self.sharp_task = None
        self.last_stream_frame = None
        self.visible = False
        self.process = None
        self.profile_dir = None
        self.pages, self.urls, self.main_frames = {}, {}, {}
        self.attaching = set()
        self.sensitive_targets = set()
        self.active_id = None
        self.seen_sony_login = False
        self.reported_http_errors = set()
        self.closing = False

    def run(self, spec, timeout):
        self.spec = spec
        return asyncio.run(self._run(timeout))

    def close(self):
        self.cancelled.set()
        with self.condition:
            self.condition.notify_all()

    def command(self, message):
        """The UI can send input and viewport commands, never arbitrary CDP."""
        if self.finished.is_set() or not isinstance(message, dict):
            return False
        if message.get("type") not in {"pointer", "wheel", "key", "text", "resize", "visibility", "back", "forward", "reload", "release"}:
            return False
        try:
            self.inputs.put_nowait(message)
            return True
        except queue.Full:
            return False

    def wait_update(self, after, timeout=1):
        with self.condition:
            self.condition.wait_for(lambda: self.sequence > after or self.finished.is_set(), timeout)
            if self.sequence <= after:
                return None
            return self.sequence, self.frame, dict(self.metadata)

    def _publish(self, frame=None, **metadata):
        with self.condition:
            if frame is not None:
                self.frame = frame
            self.metadata.update(metadata)
            self.sequence += 1
            self.condition.notify_all()

    def _complete(self, result):
        if not self.result.done():
            self.result.set_result(result)

    async def _run(self, timeout):
        self.loop = asyncio.get_running_loop()
        self.result = self.loop.create_future()
        tasks = []
        navigation = None
        self.clients = []
        try:
            if self.cancelled.is_set():
                raise AppError("登录已取消", code="browser_auth_cancelled")
            await self._start_browser()
            await self.root.send("Target.setDiscoverTargets", {"discover": True})
            await self.root.send("Browser.setDownloadBehavior", {"behavior": "deny"})
            tasks = [asyncio.create_task(self._input_loop()), asyncio.create_task(self._monitor())]
            # Navigation can wait for slow remote response headers. Keep input,
            # screencasting and cancellation alive while that command is pending.
            navigation = asyncio.create_task(self._navigate_initial(self.pages[self.active_id]))
            done, _ = await asyncio.wait([self.result, *tasks], timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
            if self.result in done:
                return self.result.result()
            if self.cancelled.is_set():
                raise AppError("登录已取消", code="browser_auth_cancelled")
            if any(task in done for task in tasks):
                raise RemoteServiceError("后台浏览器已关闭，请重新绑定", code="local_browser_closed")
            raise RemoteServiceError("登录等待超时，请重新绑定", code="browser_auth_timeout")
        finally:
            self.closing = True
            cleanup_tasks = tasks + ([navigation] if navigation else [])
            for task in cleanup_tasks:
                task.cancel()
            await asyncio.gather(*cleanup_tasks, return_exceptions=True)
            root = getattr(self, "root", None)
            if root:
                with contextlib.suppress(Exception):
                    await root.send("Browser.close")
            for client in self.clients:
                with contextlib.suppress(Exception):
                    await client.close()
            if self.process:
                try:
                    await asyncio.to_thread(self.process.wait, 3)
                except subprocess.TimeoutExpired:
                    self.process.terminate()
                    await asyncio.to_thread(self.process.wait, 3)
            if self.profile_dir:
                assert self.profile_dir.parent == Path(tempfile.gettempdir()).resolve()
                assert self.profile_dir.name.startswith("gtm-reused-browser-")
                for _ in range(20):
                    try:
                        shutil.rmtree(self.profile_dir)
                        break
                    except FileNotFoundError:
                        break
                    except OSError:
                        await asyncio.sleep(.1)
            with self.condition:
                self.frame = None
                self.finished.set()
                self.condition.notify_all()
            with self.inputs.mutex:
                self.inputs.queue.clear()
            self.result = None
            self.pages.clear()
            self.urls.clear()
            self.clients.clear()

    async def _navigate_initial(self, client):
        try:
            response = await client.send("Page.navigate", {"url": self.spec.url}, timeout=60)
            if response.get("errorText"):
                raise RemoteServiceError("登录页面无法打开，请检查网络后重试",
                                         code="local_browser_navigation_failed")
        except TimeoutError:
            error = RemoteTimeoutError("登录页加载超时，请检查网络后重新绑定",
                                       code="local_browser_navigation_timeout")
            if not self.result.done():
                self.result.set_exception(error)
        except Exception:
            error = RemoteServiceError("登录页面无法打开，请检查网络后重试",
                                       code="local_browser_navigation_failed")
            if not self.result.done():
                self.result.set_exception(error)

    async def _configure_page(self, client):
        target_id = client.target_id
        await client.send("Page.enable")
        await client.send("Network.enable")
        if self.adjust_user_agent and self.spec.platform in {"nintendo", "psn"}:
            version = await self.root.send("Browser.getVersion")
            agent = version.get("userAgent", "")
            if isinstance(agent, str) and "HeadlessChrome/" in agent:
                await client.send("Network.setUserAgentOverride", {
                    "userAgent": agent.replace("HeadlessChrome/", "Chrome/"),
                })
        tree = await client.send("Page.getFrameTree")
        self.main_frames[target_id] = tree["frameTree"]["frame"]["id"]
        self.urls[target_id] = tree["frameTree"]["frame"].get("url", "about:blank")
        await client.send("Fetch.enable", {"patterns": [{"urlPattern": "*", "resourceType": "Document", "requestStage": "Request"}]})
        if self.spec.platform == "nintendo":
            binding = "__gtm_callback_" + secrets.token_hex(8)
            client.callback_binding = binding
            await client.send("Runtime.addBinding", {"name": binding})
            scheme = json.dumps(urlsplit(self.spec.callback).scheme + ":")
            script = """(() => {
              const capture = value => { try { const u = new URL(value, location.href);
                if (u.protocol === SCHEME && u.hostname === 'auth') { window[BINDING](u.href); return true; }
              } catch (_) {} return false; };
              document.addEventListener('click', event => { const a = event.target.closest?.('a[href]');
                if (a && capture(a.href)) { event.preventDefault(); event.stopImmediatePropagation(); }
              }, true);
              const open = window.open.bind(window);
              window.open = (url, ...args) => capture(url) ? null : open(url, ...args);
            })();""".replace("SCHEME", scheme).replace("BINDING", json.dumps(binding))
            await client.send("Page.addScriptToEvaluateOnNewDocument", {"source": script})
        await self._activate(target_id)

    async def _activate(self, target_id):
        old = self.pages.get(self.active_id)
        if old and self.active_id != target_id:
            with contextlib.suppress(Exception):
                await old.send("Page.stopScreencast")
        self.active_id = target_id
        self.last_stream_frame = None
        client = self.pages[target_id]
        await self._resize(client)
        if self.visible:
            await self._screencast(client)
        await self._history(client)

    async def _resize(self, client):
        self.last_stream_frame = None
        await client.send("Emulation.setDeviceMetricsOverride",
                          {**self.viewport, "deviceScaleFactor": self.scale, "mobile": False})

    def _frame_allowed(self, client):
        return (client.target_id == self.active_id and self.visible
                and self.urls.get(client.target_id) not in {None, "", "about:blank"}
                and not is_sony_credential_document(self.urls.get(client.target_id))
                and client.target_id not in self.sensitive_targets)

    def _request_sharp_frame(self, client, size):
        # Only the latest request matters; one screenshot runs at a time.
        self.sharp_request = (client, size)
        if self.sharp_task is None or self.sharp_task.done():
            self.sharp_task = asyncio.create_task(self._sharp_frames())

    async def _sharp_frames(self):
        while self.sharp_request and not self.closing:
            client, size = self.sharp_request
            self.sharp_request = None
            if not self._frame_allowed(client):
                continue
            try:
                shot = await client.send("Page.captureScreenshot",
                                         {"format": "jpeg", "quality": 90, "optimizeForSpeed": True})
            except Exception:
                continue
            # The page may have navigated to a protected page while the screenshot was taken.
            if self._frame_allowed(client) and isinstance(shot, dict) and shot.get("data"):
                self._publish({"type": "frame", "data": shot["data"], **size})

    async def _screencast(self, client):
        # Frames are captured at device pixels; quality 90 keeps small text free of JPEG noise.
        await client.send("Page.startScreencast", {
            "format": "jpeg", "quality": 90,
            "maxWidth": min(3840, math.ceil(self.viewport["width"] * self.scale)),
            "maxHeight": min(2400, math.ceil(self.viewport["height"] * self.scale)),
            "everyNthFrame": 1})

    async def _history(self, client):
        history = await client.send("Page.getNavigationHistory")
        index = history["currentIndex"]
        self._publish(host=urlsplit(self.urls.get(client.target_id, self.spec.url)).hostname or "",
                      canBack=index > 0, canForward=index < len(history["entries"]) - 1)

    async def _event(self, client, method, params):
        if self.closing:
            return
        if method == "Page.screencastFrame":
            if self._frame_allowed(client):
                meta = params.get("metadata", {})
                size = {"width": round(meta.get("deviceWidth", self.viewport["width"])),
                        "height": round(meta.get("deviceHeight", self.viewport["height"]))}
                if self.scale <= 1.01:
                    self._publish({"type": "frame", "data": params["data"], **size})
                else:
                    # Taking a screenshot itself produces another stream frame, so only
                    # frames whose picture actually changed ask for a new sharp screenshot.
                    digest = hash(params["data"])
                    if digest != self.last_stream_frame:
                        self.last_stream_frame = digest
                        self._request_sharp_frame(client, size)
            await client.send("Page.screencastFrameAck", {"sessionId": params["sessionId"]})
        elif method == "Network.responseReceived" and self.spec.platform == "psn":
            response = params.get("response", {})
            host = urlsplit(response.get("url", "")).hostname
            status = response.get("status", 0)
            if (params.get("type") in {"Document", "XHR", "Fetch"}
                    and host in SONY_AUTH_HOSTS and isinstance(status, (int, float)) and 400 <= status <= 599):
                issue = (host, int(status))
                if issue not in self.reported_http_errors and len(self.reported_http_errors) < 16:
                    self.reported_http_errors.add(issue)
                    # Never log URLs, headers or response bodies: they can carry
                    # passwords, verification codes, authorization codes or NPSSO.
                    logger.warning("PSN 登录网页请求失败：%s，HTTP %s", *issue)
                result = getattr(self, "result", None)
                if status == 429 and result is not None and not result.done():
                    result.set_exception(PsnLoginRateLimitError(sony_retry_after(response.get("headers", {}))))
        elif method == "Fetch.requestPaused":
            request_id, url = params["requestId"], params["request"]["url"]
            top_level = params.get("frameId") == self.main_frames.get(client.target_id)
            if top_level:
                parsed = urlsplit(url)
                if self.spec.platform == "psn" and (parsed.scheme, parsed.netloc, parsed.path) == ("https", "ca.account.sony.com", "/api/v1/ssocookie"):
                    self.sensitive_targets.add(client.target_id)
                else:
                    self.sensitive_targets.discard(client.target_id)
            if top_level and self.spec.platform in {"xbox", "nintendo"} and is_callback(url, self.spec.callback):
                await client.send("Fetch.fulfillRequest", {"requestId": request_id, "responseCode": 200,
                                                            "responseHeaders": [{"name": "Content-Type", "value": "text/html"}],
                                                            "body": base64.b64encode(b"Authorization received").decode()})
                self._complete({"callback": url})
            elif top_level and url != "about:blank" and not allowed_navigation(self.spec, url):
                await client.send("Fetch.failRequest", {"requestId": request_id, "errorReason": "BlockedByClient"})
            else:
                await client.send("Fetch.continueRequest", {"requestId": request_id})
        elif method in {"Page.frameRequestedNavigation", "Page.frameScheduledNavigation", "Page.frameStartedNavigating"}:
            url = params.get("url", "")
            if self.spec.platform == "nintendo" and is_callback(url, self.spec.callback):
                self._complete({"callback": url})
                with contextlib.suppress(Exception):
                    await client.send("Page.stopLoading")
        elif method == "Runtime.bindingCalled" and params.get("name") == getattr(client, "callback_binding", None):
            if is_callback(params.get("payload"), self.spec.callback):
                self._complete({"callback": params["payload"]})
        elif method == "Page.frameNavigated":
            frame = params["frame"]
            url = frame["url"]
            top_level = not frame.get("parentId")
            parsed = urlsplit(url)
            if top_level:
                self.main_frames[client.target_id] = frame["id"]
                self.urls[client.target_id] = url
                if self.spec.platform == "psn" and (parsed.scheme, parsed.netloc, parsed.path) == ("https", "ca.account.sony.com", "/api/v1/ssocookie"):
                    self.sensitive_targets.add(client.target_id)
            if self.spec.platform == "psn":
                # Sony can embed sign-in in Account Management. Detect the
                # subsequent return navigation, not the parent's load event,
                # which can fire while the embedded sign-in is still visible.
                if ((parsed.scheme, parsed.netloc) == ("https", "my.account.sony.com")
                        and parsed.path.rstrip("/") in {"/sonyacct/signin", "/central/signin"}):
                    self.seen_sony_login = True
                elif self.seen_sony_login:
                    returned_to_account = (parsed.scheme, parsed.netloc, parsed.path.rstrip("/")) == (
                        "https", "id.sonyentertainmentnetwork.com", "/id/management_ca")
                    returned_to_store = (parsed.scheme, parsed.netloc) == ("https", "store.playstation.com")
                    if returned_to_account or returned_to_store:
                        await client.send("Page.navigate", {"url": SONY_COOKIE_URL}, timeout=60)
            if top_level and client.target_id == self.active_id:
                await self._history(client)
        elif method == "Page.loadEventFired":
            url = self.urls.get(client.target_id, "")
            if self.spec.platform == "steam" and is_callback(url, self.spec.callback):
                self._complete({"callback": url})
        elif method == "Target.targetCreated":
            info = params["targetInfo"]
            if info.get("type") == "page" and info["targetId"] not in self.pages:
                if info.get("url") in {"", "about:blank"} or allowed_navigation(self.spec, info["url"]):
                    await self._attach(info["targetId"])
                else:
                    await self.root.send("Target.closeTarget", {"targetId": info["targetId"]})
        elif method == "Target.targetDestroyed":
            target_id = params["targetId"]
            self.pages.pop(target_id, None)
            if self.active_id == target_id and self.pages:
                await self._activate(next(iter(self.pages)))

    async def _monitor(self):
        while not self.cancelled.is_set():
            if self.process.poll() is not None:
                return
            await self._poll_psn_credential()
            await asyncio.sleep(.5)

    async def _poll_psn_credential(self):
        if self.spec.platform != "psn" or self.active_id not in self.pages:
            return
        client = self.pages[self.active_id]
        with contextlib.suppress(Exception):
            cookies = await client.send("Network.getCookies", {"urls": [SONY_COOKIE_URL]})
            for cookie in cookies.get("cookies", []):
                if cookie["name"].lower() == "npsso" and NPSSO_PATTERN.fullmatch(cookie["value"]):
                    self._complete({"npsso": cookie["value"]})
            parsed = urlsplit(self.urls.get(self.active_id, ""))
            if (parsed.scheme, parsed.netloc, parsed.path) == ("https", "ca.account.sony.com", "/api/v1/ssocookie"):
                response = await client.send("Runtime.evaluate", {"expression": "document.body.innerText", "returnByValue": True})
                raw = response.get("result", {}).get("value", "")
                if isinstance(raw, str) and len(raw) < 16384:
                    value = json.loads(raw).get("npsso", "")
                    if NPSSO_PATTERN.fullmatch(value):
                        self._complete({"npsso": value})

    async def _input_loop(self):
        while not self.cancelled.is_set():
            try:
                message = self.inputs.get_nowait()
            except queue.Empty:
                await asyncio.sleep(.012)
                continue
            client = self.pages.get(self.active_id)
            if not client:
                continue
            with contextlib.suppress(Exception):
                await self._input(client, message)

    async def _input(self, client, message):
        kind = message.get("type")
        if kind == "visibility":
            self.visible = message.get("visible") is True
            if self.visible:
                await self._screencast(client)
            else:
                await client.send("Page.stopScreencast")
                await self._release(client)
        elif kind == "resize":
            width, height = message.get("width"), message.get("height")
            if all(isinstance(value, (float, int)) and math.isfinite(value) for value in (width, height)):
                self.viewport = {"width": max(200, min(1920, round(width))), "height": max(150, min(1200, round(height)))}
                scale = message.get("scale", 1)
                if isinstance(scale, (float, int)) and not isinstance(scale, bool) and math.isfinite(scale):
                    self.scale = round(max(1.0, min(2.0, float(scale))), 3)
                await self._resize(client)
                if self.visible:
                    # The frame size limit depends on the viewport and scale, so restart the stream.
                    with contextlib.suppress(Exception):
                        await client.send("Page.stopScreencast")
                    await self._screencast(client)
        elif kind in {"back", "forward"}:
            history = await client.send("Page.getNavigationHistory")
            index = history["currentIndex"] + (-1 if kind == "back" else 1)
            if 0 <= index < len(history["entries"]):
                await client.send("Page.navigateToHistoryEntry", {"entryId": history["entries"][index]["id"]})
        elif kind == "reload":
            await client.send("Page.reload")
        elif kind == "release":
            await self._release(client)
        elif not self.visible:
            return
        elif kind == "text":
            text = message.get("text", "")
            if isinstance(text, str) and 0 < len(text) <= 8192:
                await client.send("Input.insertText", {"text": text})
        elif kind == "key":
            key, code = message.get("key", ""), message.get("code", "")
            if not isinstance(key, str) or not isinstance(code, str) or len(key) > 40 or len(code) > 40:
                return
            virtual = {"Backspace": 8, "Tab": 9, "Enter": 13, "Escape": 27, "Delete": 46,
                       "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40,
                       "Home": 36, "End": 35, "PageUp": 33, "PageDown": 34,
                       "Shift": 16, "Control": 17, "Alt": 18, "Meta": 91}.get(key, ord(key.upper()) if len(key) == 1 else 0)
            await client.send("Input.dispatchKeyEvent", {"type": "keyUp" if message.get("event") == "keyup" else "rawKeyDown",
                "key": key, "code": code, "windowsVirtualKeyCode": virtual, "modifiers": int(message.get("modifiers", 0)) & 15})
        elif kind in {"pointer", "wheel"}:
            x, y = message.get("x"), message.get("y")
            if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in (x, y)):
                return
            params = {"x": max(0, min(self.viewport["width"] - 1, x)), "y": max(0, min(self.viewport["height"] - 1, y)),
                      "modifiers": int(message.get("modifiers", 0)) & 15}
            if kind == "wheel":
                dx, dy = message.get("deltaX", 0), message.get("deltaY", 0)
                if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in (dx, dy)):
                    return
                params.update(type="mouseWheel", deltaX=max(-10000, min(10000, dx)), deltaY=max(-10000, min(10000, dy)))
            else:
                event = {"down": "mousePressed", "up": "mouseReleased", "move": "mouseMoved"}.get(message.get("event"))
                if not event:
                    return
                params.update(type=event, button={0: "left", 1: "middle", 2: "right"}.get(message.get("button"), "none"),
                              buttons=int(message.get("buttons", 0)) & 31, clickCount=max(1, min(3, int(message.get("clickCount", 1)))))
            await client.send("Input.dispatchMouseEvent", params)

    async def _release(self, client):
        for key, code, virtual in (("Control", "ControlLeft", 17), ("Shift", "ShiftLeft", 16), ("Alt", "AltLeft", 18), ("Meta", "MetaLeft", 91)):
            await client.send("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": virtual})
