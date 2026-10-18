"""Private, bounded protocol transport for the native browser helper."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os



class PipeClient:
    def __init__(self, transport, target_id="browser", session_id=None):
        self.transport = transport
        self.target_id = target_id
        self.session_id = session_id

    async def send(self, method, params=None, *, timeout=6):
        return await self.transport.send(method, params, self.session_id, timeout=timeout)

    async def close(self):
        if self.session_id is None:
            await self.transport.close()


class PipeTransport:
    """NUL-delimited CDP messages over a helper process's private stdio pipes."""
    @classmethod
    def from_helper(cls, process, handler):
        self = cls.__new__(cls)
        self.process = process
        self.read_fd = process.stdout.fileno()
        self.write_fd = process.stdin.fileno()
        self.file_objects = (process.stdout, process.stdin)
        self.pending, self.sessions = {}, {}
        self.counter = 0
        self.tasks = set()
        self.handler = handler
        self.closed = False
        self.write_lock = asyncio.Lock()
        self.root = PipeClient(self)
        self.sessions[None] = self.root
        os.set_blocking(self.read_fd, False)
        os.set_blocking(self.write_fd, False)
        self.reader = asyncio.create_task(self._read())
        return self

    async def attach(self, target_id):
        result = await self.root.send("Target.attachToTarget", {"targetId": target_id, "flatten": True})
        client = PipeClient(self, target_id, result["sessionId"])
        self.sessions[client.session_id] = client
        return client

    async def send(self, method, params, session_id, *, timeout=6):
        if self.closed:
            raise RuntimeError("Browser pipe closed")
        self.counter += 1
        request_id = self.counter
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        packet = {"id": request_id, "method": method, "params": params or {}}
        if session_id:
            packet["sessionId"] = session_id
        try:
            await asyncio.wait_for(self._write(json.dumps(packet).encode("utf-8") + b"\0"), timeout)
            return await asyncio.wait_for(future, timeout)
        finally:
            self.pending.pop(request_id, None)

    async def _write(self, data):
        async with self.write_lock:
            while data and not self.closed:
                try:
                    written = os.write(self.write_fd, data)
                    if not written:
                        raise RuntimeError("Browser pipe closed")
                    data = data[written:]
                except BlockingIOError:
                    await asyncio.sleep(.005)

    async def _read(self):
        buffer = bytearray()
        try:
            while not self.closed:
                try:
                    data = os.read(self.read_fd, 65536)
                except BlockingIOError:
                    await asyncio.sleep(.008)
                    continue
                if not data:
                    break
                buffer.extend(data)
                if len(buffer) > 16 * 1024 * 1024:
                    break
                while b"\0" in buffer:
                    boundary = buffer.index(0)
                    raw = bytes(buffer[:boundary])
                    del buffer[:boundary + 1]
                    if not raw:
                        continue
                    packet = json.loads(raw)
                    if "id" in packet:
                        future = self.pending.get(packet["id"])
                        if future and not future.done():
                            if "error" in packet:
                                future.set_exception(RuntimeError("Browser command failed"))
                            else:
                                future.set_result(packet.get("result", {}))
                    else:
                        client = self.sessions.get(packet.get("sessionId"))
                        if client:
                            task = asyncio.create_task(self.handler(client, packet.get("method", ""), packet.get("params", {})))
                            self.tasks.add(task)
                            task.add_done_callback(self._finished)
        except (OSError, ValueError):
            pass
        finally:
            for future in list(self.pending.values()):
                if not future.done():
                    future.set_exception(RuntimeError("Browser pipe closed"))

    def _finished(self, task):
        self.tasks.discard(task)
        if not task.cancelled():
            task.exception()

    async def close(self):
        if self.closed:
            return
        self.closed = True
        self.reader.cancel()
        for task in list(self.tasks):
            task.cancel()
        await asyncio.gather(self.reader, *self.tasks, return_exceptions=True)
        if hasattr(self, "file_objects"):
            for file in self.file_objects:
                with contextlib.suppress(OSError):
                    file.close()
        else:
            for fd in (self.read_fd, self.write_fd):
                with contextlib.suppress(OSError):
                    os.close(fd)
        self.sessions.clear()

