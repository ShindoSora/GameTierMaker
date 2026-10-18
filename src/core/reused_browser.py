"""Invisible, isolated sessions in an installed Edge/Chrome, streamed over CDP.

No browser binary, Node driver, existing browser profile or public debugger port
is used. Credentials and debugger addresses never enter public status messages.
"""
from __future__ import annotations

import asyncio
import base64
import contextlib
import json
import logging
import math
import os
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

import httpx
from websockets.asyncio.client import connect

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


def find_installed_browser():
    """Use executable paths only. Never attach to the user's running browser."""
    candidates = []
    if os.name == "nt":
        import winreg
        for executable, name in (("msedge.exe", "Microsoft Edge"), ("chrome.exe", "Google Chrome")):
            for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
                for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
                    try:
                        with winreg.OpenKey(hive, rf"Software\Microsoft\Windows\CurrentVersion\App Paths\{executable}",
                                            0, winreg.KEY_READ | view) as key:
                            candidates.append((Path(winreg.QueryValue(key, None).strip('"')), name))
                    except OSError:
                        pass
        for variable in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
            root = os.environ.get(variable)
            if not root:
                continue
            for folder, name in (("Edge", "Microsoft Edge"), ("Edge Beta", "Microsoft Edge Beta")):
                candidates.append((Path(root) / "Microsoft" / folder / "Application" / "msedge.exe", name))
            candidates.append((Path(root) / "Google/Chrome/Application/chrome.exe", "Google Chrome"))
    candidates.sort(key=lambda item: 0 if item[1].startswith("Microsoft Edge") else 1)
    for path, name in candidates:
        if path.is_file():
            return path.resolve(), name
    raise AppError("未找到本机 Edge 或 Chrome，请先安装其中一个浏览器", code="local_browser_missing")


class CDPConnection:
    def __init__(self, url, target_id, handler):
        self.url, self.target_id, self.handler = url, target_id, handler
        self.pending = {}
        self.counter = 0
        self.tasks = set()

    async def open(self):
        self.ws = await connect(self.url, proxy=None, open_timeout=5, max_size=12 * 1024 * 1024,
                                compression=None)
        self.reader = asyncio.create_task(self._read())
        return self

    async def send(self, method, params=None, *, timeout=6):
        self.counter += 1
        request_id = self.counter
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            await self.ws.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
            return await asyncio.wait_for(future, timeout)
        finally:
            self.pending.pop(request_id, None)

    async def _read(self):
        try:
            async for raw in self.ws:
                packet = json.loads(raw)
                if "id" in packet:
                    future = self.pending.get(packet["id"])
                    if future and not future.done():
                        if "error" in packet:
                            future.set_exception(RuntimeError("Browser command failed"))
                        else:
                            future.set_result(packet.get("result", {}))
                else:
                    task = asyncio.create_task(self.handler(self, packet.get("method", ""), packet.get("params", {})))
                    self.tasks.add(task)
                    task.add_done_callback(self._finished)
        except Exception:
            pass
        finally:
            for future in list(self.pending.values()):
                if not future.done():
                    future.set_exception(RuntimeError("Browser connection closed"))

    def _finished(self, task):
        self.tasks.discard(task)
        if not task.cancelled():
            task.exception()  # Consume errors without logging URLs or input payloads.

    async def close(self):
        self.reader.cancel()
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(self.reader, *self.tasks, return_exceptions=True)
        await self.ws.close()


class ReusedBrowserHost:
    def new_session(self):
        path, name = find_installed_browser()
        return ReusedBrowserSession(path, name)


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
            if hasattr(self, "http"):
                await self.http.aclose()
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

    async def _start_browser(self):
        self.profile_dir = Path(tempfile.mkdtemp(prefix="gtm-reused-browser-")).resolve()
        self.process = subprocess.Popen([
            str(self.executable), "--headless=new", "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=0", f"--user-data-dir={self.profile_dir}",
            "--no-first-run", "--no-default-browser-check", "--disable-extensions",
            "--disable-background-mode", "--window-size=1000,700", "about:blank",
        ], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        port_file = self.profile_dir / "DevToolsActivePort"
        deadline = time.monotonic() + 15
        while not port_file.exists():
            if self.cancelled.is_set():
                raise AppError("登录已取消", code="browser_auth_cancelled")
            if self.process.poll() is not None or time.monotonic() > deadline:
                raise AppError("无法启动本机浏览器，请检查浏览器是否可用", code="local_browser_start_failed")
            await asyncio.sleep(.1)
        lines = port_file.read_text().splitlines()
        self.debug_origin = f"http://127.0.0.1:{int(lines[0])}"
        self.http = httpx.AsyncClient(trust_env=False, timeout=3)
        version = (await self.http.get(self.debug_origin + "/json/version")).json()
        self.root = await self._connect(version["webSocketDebuggerUrl"], "browser")
        targets = (await self.http.get(self.debug_origin + "/json/list")).json()
        target = next(item for item in targets if item.get("type") == "page")
        await self._attach(target["id"], target["webSocketDebuggerUrl"])

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

    async def _connect(self, url, target_id):
        client = await CDPConnection(url, target_id, self._event).open()
        self.clients.append(client)
        return client

    async def _attach(self, target_id, ws_url=None):
        if target_id in self.pages or target_id in self.attaching or self.closing:
            return
        self.attaching.add(target_id)
        try:
            if not ws_url:
                targets = (await self.http.get(self.debug_origin + "/json/list")).json()
                ws_url = next(item["webSocketDebuggerUrl"] for item in targets if item["id"] == target_id)
            client = await self._connect(ws_url, target_id)
            self.pages[target_id] = client
            await self._configure_page(client)
        finally:
            self.attaching.discard(target_id)

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
        client = self.pages[target_id]
        await self._resize(client)
        if self.visible:
            await self._screencast(client)
        await self._history(client)

    async def _resize(self, client):
        await client.send("Emulation.setDeviceMetricsOverride", {**self.viewport, "deviceScaleFactor": 1, "mobile": False})

    async def _screencast(self, client):
        await client.send("Page.startScreencast", {"format": "jpeg", "quality": 78, "maxWidth": 1600,
                                                  "maxHeight": 1200, "everyNthFrame": 1})

    async def _history(self, client):
        history = await client.send("Page.getNavigationHistory")
        index = history["currentIndex"]
        self._publish(host=urlsplit(self.urls.get(client.target_id, self.spec.url)).hostname or "",
                      canBack=index > 0, canForward=index < len(history["entries"]) - 1)

    async def _event(self, client, method, params):
        if self.closing:
            return
        if method == "Page.screencastFrame":
            if (client.target_id == self.active_id and self.visible
                    and self.urls.get(client.target_id) not in {None, "", "about:blank"}
                    and not is_sony_credential_document(self.urls.get(client.target_id))
                    and client.target_id not in self.sensitive_targets):
                meta = params.get("metadata", {})
                self._publish({"type": "frame", "data": params["data"],
                               "width": round(meta.get("deviceWidth", self.viewport["width"])),
                               "height": round(meta.get("deviceHeight", self.viewport["height"]))})
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
                await self._resize(client)
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
