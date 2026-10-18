"""Private stdio host for WebView2. No API server, profile reuse, or visible window."""
import json
import os
from pathlib import Path
import queue
import secrets
import sys
import tempfile
import threading


def _stdio_streams():
    # Windowed PyInstaller builds set Python's stdio objects to None even when
    # the parent supplied private pipe handles. Duplicate those handles locally.
    import ctypes
    from ctypes import wintypes
    import msvcrt
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetStdHandle.argtypes = [wintypes.DWORD]
    kernel.GetStdHandle.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.DuplicateHandle.argtypes = [wintypes.HANDLE, wintypes.HANDLE, wintypes.HANDLE,
        ctypes.POINTER(wintypes.HANDLE), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.DuplicateHandle.restype = wintypes.BOOL

    def restore(kind, flags, mode):
        handle = kernel.GetStdHandle(kind & 0xFFFFFFFF)
        duplicate = wintypes.HANDLE()
        process = kernel.GetCurrentProcess()
        if not handle or not kernel.DuplicateHandle(process, handle, process, ctypes.byref(duplicate), 0, False, 2):
            raise OSError("Missing private browser pipe")
        return os.fdopen(msvcrt.open_osfhandle(duplicate.value, flags | os.O_BINARY), mode, buffering=0)

    input_stream = sys.stdin if sys.stdin is not None else restore(-10, os.O_RDONLY, "rb")
    output_stream = sys.stdout if sys.stdout is not None else restore(-11, os.O_WRONLY, "wb")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")
    return input_stream, output_stream


def main(profile):
    profile = Path(profile).resolve()
    if profile.parent != Path(tempfile.gettempdir()).resolve() or not profile.name.startswith("gtm-reused-browser-"):
        raise ValueError("Invalid browser profile directory")
    import msvcrt
    input_stream, output_stream = _stdio_streams()
    msvcrt.setmode(input_stream.fileno(), os.O_BINARY)
    msvcrt.setmode(output_stream.fileno(), os.O_BINARY)
    output_fd = output_stream.fileno()
    sys.stdout = sys.stderr
    output_lock = threading.Lock()
    incoming = queue.Queue(maxsize=512)

    def output(packet):
        data = json.dumps(packet, separators=(",", ":")).encode("utf-8") + b"\0"
        with output_lock:
            while data:
                data = data[os.write(output_fd, data):]

    def read_input():
        buffer = bytearray()
        try:
            while True:
                data = os.read(input_stream.fileno(), 65536)
                if not data:
                    break
                buffer.extend(data)
                if len(buffer) > 65536:
                    break
                while b"\0" in buffer:
                    boundary = buffer.index(0)
                    raw = bytes(buffer[:boundary])
                    del buffer[:boundary + 1]
                    if raw:
                        incoming.put(json.loads(raw))
        except Exception:
            pass
        incoming.put({"method": "Browser.close"})

    import clr
    from webview.util import interop_dll_path
    clr.AddReference("System.Windows.Forms")
    clr.AddReference("System.Drawing")
    clr.AddReference("System")
    clr.AddReference("Microsoft.CSharp")
    clr.AddReference(interop_dll_path("Microsoft.Web.WebView2.Core.dll"))
    clr.AddReference(interop_dll_path("Microsoft.Web.WebView2.WinForms.dll"))
    for platform in ("win-x64", "win-arm64", "win-x86"):
        os.environ["PATH"] += os.pathsep + interop_dll_path(platform)

    from Microsoft.CSharp import CSharpCodeProvider
    from System.CodeDom.Compiler import CompilerParameters
    from System import Action, Console, String
    from System.Drawing import Size
    from System.IO import TextWriter
    from System.Threading import Thread, ThreadStart, ApartmentState
    from System.Threading.Tasks import Task, TaskScheduler
    from System.Windows.Forms import Application, DockStyle, Timer, UnhandledExceptionMode
    from Microsoft.Web.WebView2.Core import CoreWebView2Environment
    from Microsoft.Web.WebView2.WinForms import WebView2, CoreWebView2CreationProperties

    Console.SetOut(TextWriter.Null)
    settings = CompilerParameters()
    settings.GenerateInMemory = True
    settings.ReferencedAssemblies.Add("System.dll")
    settings.ReferencedAssemblies.Add("System.Windows.Forms.dll")
    settings.ReferencedAssemblies.Add("System.Drawing.dll")
    compiled = CSharpCodeProvider().CompileAssemblyFromSource(settings, """
      public class GtmInvisibleRenderer : System.Windows.Forms.Form {
        public GtmInvisibleRenderer() {
          this.Text = "Game Tier Maker Login Renderer";
          this.ShowInTaskbar = false;
          this.FormBorderStyle = System.Windows.Forms.FormBorderStyle.None;
          this.StartPosition = System.Windows.Forms.FormStartPosition.Manual;
          this.Location = new System.Drawing.Point(-16000, -16000);
          this.ClientSize = new System.Drawing.Size(1000, 700);
          this.Opacity = 0;
        }
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override System.Windows.Forms.CreateParams CreateParams {
          get {
            var value = base.CreateParams;
            value.ExStyle |= 0x08000000 | 0x00000080 | 0x00000020;
            return value;
          }
        }
      }
    """)
    if compiled.Errors.HasErrors:
        raise RuntimeError("Native browser host compilation failed: " +
                           "; ".join(str(error.ErrorNumber) + ": " + str(error.ErrorText) for error in compiled.Errors))
    from System import Activator
    form_type = compiled.CompiledAssembly.GetType("GtmInvisibleRenderer")

    def run_ui():
        Application.EnableVisualStyles()
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException)
        form = Activator.CreateInstance(form_type)
        Application.ThreadException += lambda sender, args: form.Close()
        pages = {}
        session_pages = {}
        state = {"discover": False, "environment": None, "closing": False}
        callbacks = []

        def reply(packet, result=None, failed=False):
            if "id" not in packet:
                return
            response = {"id": packet["id"]}
            if failed:
                response["error"] = {"message": "Browser command failed"}
            else:
                response["result"] = result or {}
            output(response)

        def event(method, params, session_id=None):
            packet = {"method": method, "params": params}
            if session_id:
                packet["sessionId"] = session_id
            output(packet)

        def create_page(url, done, opener_args=None):
            page_id = secrets.token_hex(12)
            control = WebView2()
            properties = CoreWebView2CreationProperties()
            properties.UserDataFolder = str(profile)
            properties.AdditionalBrowserArguments = "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
            control.CreationProperties = properties
            control.Dock = DockStyle.Fill
            page = {"id": page_id, "control": control, "session": None, "receivers": [], "ready": False}
            pages[page_id] = page
            form.Controls.Add(control)
            control.BringToFront()

            def initialized(sender, args):
                if not args.IsSuccess:
                    done(None)
                    return
                core = control.CoreWebView2
                state["environment"] = core.Environment
                page["ready"] = True
                core.Settings.AreDefaultContextMenusEnabled = False
                core.Settings.AreDefaultScriptDialogsEnabled = False
                core.Settings.AreDevToolsEnabled = False
                core.Settings.IsStatusBarEnabled = False
                core.DownloadStarting += cancel_download
                core.NewWindowRequested += new_window
                for name in ("Page.screencastFrame", "Fetch.requestPaused", "Page.frameNavigated",
                             "Page.loadEventFired", "Network.responseReceived", "Runtime.bindingCalled"):
                    receiver = core.GetDevToolsProtocolEventReceiver(name)
                    def received(sender, args, method=name, target=page):
                        if target["session"] and not state["closing"]:
                            event(method, json.loads(str(args.ParameterObjectAsJson)), target["session"])
                    callbacks.append(received)
                    receiver.DevToolsProtocolEventReceived += received
                    page["receivers"].append(receiver)
                done(page_id)
                if state["discover"]:
                    event("Target.targetCreated", {"targetInfo": {"type": "page", "targetId": page_id, "url": url}})
                if opener_args:
                    args, deferral = opener_args
                    args.NewWindow = core
                    args.Handled = True
                    deferral.Complete()
                elif url != "about:blank":
                    core.Navigate(url)

            callbacks.append(initialized)
            control.CoreWebView2InitializationCompleted += initialized
            control.EnsureCoreWebView2Async(state["environment"])

        def cancel_download(sender, args):
            args.Cancel = True

        def new_window(sender, args):
            from src.core.browser_auth import BrowserSpec, allowed_navigation
            uri = str(args.Uri)
            if not allowed_navigation(BrowserSpec("psn", uri), uri):
                args.Handled = True
                return
            deferral = args.GetDeferral()
            create_page(uri, lambda _: None, (args, deferral))

        def dispatch(packet):
            method, params = packet.get("method"), packet.get("params", {})
            try:
                if method == "Browser.close":
                    reply(packet)
                    form.Close()
                    return
                if method == "Browser.getVersion":
                    reply(packet, {"product": str(CoreWebView2Environment.GetAvailableBrowserVersionString()),
                        "host": {"opacity": float(form.Opacity), "taskbar": bool(form.ShowInTaskbar),
                                 "focused": bool(form.ContainsFocus)}})
                    return
                if method == "Browser.setDownloadBehavior":
                    reply(packet)
                    return
                if method == "Target.setDiscoverTargets":
                    state["discover"] = params.get("discover") is True
                    reply(packet)
                    return
                if method == "Target.createTarget":
                    create_page(params.get("url", "about:blank"),
                                lambda page_id: reply(packet, {"targetId": page_id}, failed=not page_id))
                    return
                if method == "Target.attachToTarget":
                    page = pages[params["targetId"]]
                    page["session"] = page["id"]
                    session_pages[page["id"]] = page
                    reply(packet, {"sessionId": page["id"]})
                    return
                if method == "Target.closeTarget":
                    page = pages.pop(params["targetId"])
                    session_pages.pop(page["id"], None)
                    page["control"].Dispose()
                    reply(packet, {"success": True})
                    event("Target.targetDestroyed", {"targetId": page["id"]})
                    return
                page = session_pages[packet["sessionId"]]
                if method == "Emulation.setDeviceMetricsOverride":
                    form.ClientSize = Size(int(params["width"]), int(params["height"]))
                    page["control"].BringToFront()
                task = page["control"].CoreWebView2.CallDevToolsProtocolMethodAsync(method, json.dumps(params))
                def completed(result):
                    if result.IsFaulted or result.IsCanceled:
                        reply(packet, failed=True)
                    else:
                        reply(packet, json.loads(str(result.Result)))
                task.ContinueWith(Action[Task[String]](completed), TaskScheduler.FromCurrentSynchronizationContext())
            except Exception:
                reply(packet, failed=True)

        def tick(sender, args):
            for _ in range(64):
                try:
                    packet = incoming.get_nowait()
                except queue.Empty:
                    break
                dispatch(packet)
                if state["closing"]:
                    break

        def closing(sender, args):
            state["closing"] = True
            timer.Stop()
            for page in pages.values():
                page["control"].Dispose()

        timer = Timer()
        timer.Interval = 10
        timer.Tick += tick
        form.FormClosing += closing
        timer.Start()
        Application.Run(form)
        timer.Dispose()
        form.Dispose()

    reader = threading.Thread(target=read_input, daemon=True)
    reader.start()
    ui = Thread(ThreadStart(run_ui))
    ui.SetApartmentState(ApartmentState.STA)
    ui.Start()
    ui.Join()


if __name__ == "__main__":
    main(sys.argv[1])
