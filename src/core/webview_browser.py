"""WebView2 renders in an invisible helper; all user interaction stays in the panel."""
import asyncio
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from src.core.errors import AppError
from src.core.pipe_browser import PipeTransport
from src.core.reused_browser import ReusedBrowserSession


class WebViewBrowserHost:
    def new_session(self):
        if os.name != "nt":
            raise AppError("此登录方式目前仅支持 Windows", code="local_browser_start_failed")
        return WebViewBrowserSession()


class WebViewBrowserSession(ReusedBrowserSession):
    adjust_user_agent = False

    def __init__(self):
        super().__init__(sys.executable, "Microsoft Edge WebView2")

    async def _start_browser(self):
        self.profile_dir = Path(tempfile.mkdtemp(prefix="gtm-reused-browser-")).resolve()
        if getattr(sys, "frozen", False):
            command = [sys.executable, "--embedded-browser-helper", str(self.profile_dir)]
        else:
            command = [sys.executable, "-m", "src.core.webview_browser_helper", str(self.profile_dir)]
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, bufsize=0, close_fds=True,
            cwd=str(Path(__file__).resolve().parents[2]), creationflags=subprocess.CREATE_NO_WINDOW)
        self.transport = PipeTransport.from_helper(self.process, self._event)
        self.root = self.transport.root
        self.clients.append(self.root)
        await self.root.send("Browser.getVersion", timeout=20)
        target = await self.root.send("Target.createTarget", {"url": "about:blank"}, timeout=20)
        await self._attach(target["targetId"])

    async def _attach(self, target_id, ws_url=None):
        if target_id in self.pages or target_id in self.attaching or self.closing:
            return
        self.attaching.add(target_id)
        try:
            client = await self.transport.attach(target_id)
            self.clients.append(client)
            self.pages[target_id] = client
            await self._configure_page(client)
        finally:
            self.attaching.discard(target_id)

    async def _input(self, client, message):
        if message.get("type") == "visibility":
            await client.send("Emulation.setFocusEmulationEnabled", {"enabled": message.get("visible") is True})
        await super()._input(client, message)
