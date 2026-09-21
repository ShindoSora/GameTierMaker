"""
Game Tier Maker — FastAPI Backend + Webview 桌面端
==================================================
启动方式:
  python main.py                → 开发模式（浏览器 + 热重载）
  python main.py --debug        → 调试模式（浏览器打开 + DEBUG 日志）
  python main.py --no-browser   → 仅启动后端，不打开任何窗口
  main.exe                      → 桌面应用（打包后，嵌入式 webview 窗口）
"""

import os, sys, logging, traceback, threading, argparse, socket, time
from contextlib import asynccontextmanager
from http.client import HTTPConnection
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware
from fastapi.staticfiles import StaticFiles

from src.core.local_security import (
    SESSION_COOKIE_NAME,
    apply_security_headers,
    create_local_session_token,
    is_allowed_local_origin,
    is_valid_local_session,
)
from src.core.runtime_guard import (
    RuntimeDirectoryError,
    SingleInstanceGuard,
    ensure_writable_directory,
    show_error_message,
)
from src.api.error_handlers import register_error_handlers
from src.core.errors import InvalidInputError
from src.core.export_service import MAX_EXPORT_BYTES
from src.core.image_security import MAX_UPLOAD_BYTES
from src.core.live_logs import RedactingFormatter, install_session_log_handler
from src.core.version import APP_VERSION

# PyInstaller windowed applications may not provide standard streams. Some
# third-party libraries still print diagnostic messages during authentication.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

# ── 路径解析 ──────────────────────────────────────────
# onefile 模式把只读资源解压到 sys._MEIPASS；用户数据则保存在 exe 旁。
IS_FROZEN = getattr(sys, "frozen", False)
IS_XBOX_AUTH_HELPER = "--xbox-authenticate" in sys.argv
if IS_FROZEN:
    EXE_DIR = Path(sys.executable).resolve().parent
    RESOURCE_DIR = Path(sys._MEIPASS)
    USER_DATA_DIR = EXE_DIR / "GameTierMaker_Data"
else:
    # 开发模式继续使用项目现有的 config/ 和 data/。
    EXE_DIR = Path(__file__).resolve().parent
    RESOURCE_DIR = EXE_DIR
    USER_DATA_DIR = EXE_DIR

ROOT_DIR = str(USER_DATA_DIR)
FRONTEND_DIR = RESOURCE_DIR / "frontend"
DATA_DIR = USER_DATA_DIR / "data"
CONFIG_DIR = USER_DATA_DIR / "config"
LOG_DIR = USER_DATA_DIR / "logs"
BACKUPS_DIR = USER_DATA_DIR / "backups"

_instance_guard = SingleInstanceGuard(
    sys.executable,
    enabled=IS_FROZEN and not IS_XBOX_AUTH_HELPER,
)
try:
    instance_acquired = _instance_guard.acquire()
except OSError:
    show_error_message("Game Tier Maker 无法启动", "无法创建程序单实例锁。")
    raise SystemExit(1)
if not instance_acquired:
    show_error_message("Game Tier Maker", "Game Tier Maker 已经在运行。")
    raise SystemExit(0)

try:
    ensure_writable_directory(USER_DATA_DIR)
    for directory in (DATA_DIR, CONFIG_DIR, LOG_DIR, BACKUPS_DIR):
        directory.mkdir(parents=True, exist_ok=True)
except (RuntimeDirectoryError, OSError):
    _instance_guard.release()
    show_error_message(
        "Game Tier Maker 无法启动",
        "当前目录不可写。请将 GameTierMaker.exe 移动到桌面、文档或其他可写目录后重新运行。",
    )
    raise SystemExit(1)

# API 模块和 ConfigHandler 通过该变量定位便携数据根目录。
os.environ["GAMELIST_ROOT"] = ROOT_DIR

# ── 命令行参数 ────────────────────────────────────────
parser = argparse.ArgumentParser(description="Game Tier Maker")
parser.add_argument("--debug", action="store_true", help="调试模式")
parser.add_argument("--port",type=int,default=8000,help="8000",)
parser.add_argument(
    "--xbox-authenticate",
    metavar="TOKEN_PATH",
    help=argparse.SUPPRESS,
)
args = parser.parse_args()

IS_DEBUG = args.debug
RUNTIME_MODE = "desktop" if IS_FROZEN  else "browser"
os.environ["GAMELIST_RUNTIME_MODE"] = RUNTIME_MODE

# ── 日志 ──────────────────────────────────────────────
log_level = logging.DEBUG if IS_DEBUG else logging.INFO
log_file = str(LOG_DIR / "app.log")
log_formatter = RedactingFormatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
log_handlers = [
    logging.StreamHandler(),
    logging.FileHandler(log_file, encoding='utf-8'),
]
for log_handler in log_handlers:
    log_handler.setFormatter(log_formatter)
logging.basicConfig(
    level=log_level,
    handlers=log_handlers,
)
install_session_log_handler()
logger = logging.getLogger(__name__)
logger.info("日志文件: %s", log_file)
logger.info("启动模式: %s", "FROZEN-EXE" if IS_FROZEN else ("DEBUG" if IS_DEBUG else "NORMAL"))

# This process capability is injected only into the uncached root document,
# exchanged immediately for an HttpOnly same-site cookie, and never put in a
# URL or log message.
_LOCAL_SESSION_TOKEN = create_local_session_token()
_REQUEST_BODY_LIMITS = {
    "/api/images/upload": (MAX_UPLOAD_BYTES + 1024 * 1024, "upload_too_large", "上传图片不能超过 25 MB"),
    "/api/exports/tier-list": (MAX_EXPORT_BYTES + 1024 * 1024, "export_too_large", "导出图片文件过大"),
}

# 第三方库日志级别控制
logging.getLogger("urllib3").setLevel(logging.INFO)
logging.getLogger("PIL").setLevel(logging.WARNING)

# 全局异常捕获
def _global_exception_handler(exc_type, exc_value, exc_tb):
    if issubclass(exc_type, KeyboardInterrupt):
        sys.__excepthook__(exc_type, exc_value, exc_tb)
        return
    tb_lines = traceback.format_exception(exc_type, exc_value, exc_tb)
    logger.critical("未捕获的异常:\n%s", "".join(tb_lines))
    sys.__excepthook__(exc_type, exc_value, exc_tb)

sys.excepthook = _global_exception_handler
logging.captureWarnings(True)

# ── FastAPI 应用 ──────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    for sub in ("steam", "igdb", "bangumi", "xbox", "cache"):
        (DATA_DIR / sub).mkdir(parents=True, exist_ok=True)
    logger.info("API 服务已启动 - data: %s, resources: %s", DATA_DIR, RESOURCE_DIR)
    yield
    logger.info("API 服务已停止")


app = FastAPI(
    title="Game Tier Maker API",
    version=APP_VERSION,
    docs_url="/docs" if IS_DEBUG else None,
    lifespan=lifespan,
)
register_error_handlers(app)
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["127.0.0.1", "localhost"],
)

@app.middleware("http")
async def local_request_security(request: Request, call_next):
    path = request.url.path
    is_steam_callback = path == "/api/settings/steam/callback"
    is_public_health_check = path == "/api/health"
    is_session_bootstrap_api = path == "/api/session/bootstrap"
    is_protected_api = path == "/api" or path.startswith("/api/")

    origin = request.headers.get("origin")
    fetch_site = request.headers.get("sec-fetch-site", "")
    body_limit = _REQUEST_BODY_LIMITS.get(path) if request.method == "POST" else None
    declared_too_large = False
    body_limit_exceeded = False
    if body_limit:
        try:
            declared_too_large = int(request.headers.get("content-length", "0")) > body_limit[0]
        except ValueError:
            declared_too_large = True
    if (
        not is_steam_callback
        and (
            (origin and not is_allowed_local_origin(origin, request.url.port))
            or fetch_site in {"cross-site", "same-site"}
        )
    ):
        response = JSONResponse(
            status_code=403,
            content={
                "error": "cross_origin_request_blocked",
                "message": "已阻止来自外部页面的请求",
            },
        )
    elif (
        is_protected_api
        and not is_public_health_check
        and not is_steam_callback
        and not is_session_bootstrap_api
        and not is_valid_local_session(
            request.cookies.get(SESSION_COOKIE_NAME),
            _LOCAL_SESSION_TOKEN,
        )
    ):
        response = JSONResponse(
            status_code=403,
            content={
                "error": "local_session_required",
                "message": "本地会话已失效，请刷新应用页面",
            },
        )
    elif body_limit and declared_too_large:
        response = JSONResponse(
            status_code=413,
            content={"error": body_limit[1], "message": body_limit[2]},
        )
    else:
        if body_limit:
            original_receive = request._receive
            received_bytes = 0

            async def limited_receive():
                nonlocal received_bytes, body_limit_exceeded
                message = await original_receive()
                if message.get("type") == "http.request":
                    received_bytes += len(message.get("body", b""))
                    if received_bytes > body_limit[0]:
                        body_limit_exceeded = True
                        raise InvalidInputError(
                            body_limit[2],
                            code=body_limit[1],
                        )
                return message

            request._receive = limited_receive
        response = await call_next(request)
        if body_limit_exceeded:
            response = JSONResponse(
                status_code=413,
                content={"error": body_limit[1], "message": body_limit[2]},
            )

    apply_security_headers(response)
    if is_protected_api:
        response.headers["Cache-Control"] = "no-store"
    if args.debug:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": APP_VERSION, "runtime_mode": RUNTIME_MODE}


@app.post("/api/session/bootstrap")
async def bootstrap_local_session(request: Request):
    """Exchange the HTML-only capability for an unreadable session cookie."""
    candidate = request.headers.get("x-gtm-bootstrap")
    origin = request.headers.get("origin")
    fetch_site = request.headers.get("sec-fetch-site", "")
    if (
        (origin and not is_allowed_local_origin(origin, request.url.port))
        or fetch_site in {"cross-site", "same-site"}
        or not is_valid_local_session(candidate, _LOCAL_SESSION_TOKEN)
    ):
        return JSONResponse(
            status_code=403,
            content={
                "error": "local_session_bootstrap_rejected",
                "message": "无法建立本地安全会话，请刷新应用页面",
            },
        )
    response = JSONResponse({"ok": True})
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=_LOCAL_SESSION_TOKEN,
        path="/api",
        httponly=True,
        samesite="strict",
        secure=False,
    )
    return response

# API routes
from src.api.templates import router as templates_router
from src.api.images import router as images_router
from src.api.library import router as library_router
from src.api.project import router as project_router
from src.api.settings import router as settings_router
from src.api.nintendo import router as nintendo_router
from src.api.logs import router as logs_router
from src.api.exports import router as exports_router
from src.core.json_store import JsonStoreError
from src.core.manager import ProjectRecoveryRequiredError, ProjectSaveError

app.include_router(templates_router, prefix="/api/templates", tags=["templates"])
app.include_router(images_router, prefix="/api/images", tags=["images"])
app.include_router(library_router, prefix="/api/library", tags=["library"])
app.include_router(project_router, prefix="/api/project", tags=["project"])
app.include_router(settings_router, prefix="/api/settings", tags=["settings"])
app.include_router(nintendo_router, prefix="/api/settings", tags=["nintendo"])
app.include_router(logs_router, prefix="/api/logs", tags=["logs"])
app.include_router(exports_router, prefix="/api/exports", tags=["exports"])


@app.exception_handler(ProjectRecoveryRequiredError)
async def project_recovery_required_handler(request: Request, exc: ProjectRecoveryRequiredError):
    return JSONResponse(
        status_code=409,
        content={"error": "project_recovery_required", "message": str(exc)},
    )


@app.exception_handler(ProjectSaveError)
async def project_save_error_handler(request: Request, exc: ProjectSaveError):
    logger.error("项目保存请求失败", exc_info=(type(exc), exc, exc.__traceback__))
    return JSONResponse(
        status_code=500,
        content={"error": "project_save_failed", "message": str(exc)},
    )


@app.exception_handler(JsonStoreError)
async def json_store_error_handler(request: Request, exc: JsonStoreError):
    logger.error("配置存储请求失败", exc_info=(type(exc), exc, exc.__traceback__))
    return JSONResponse(
        status_code=500,
        content={
            "error": "data_store_failed",
            "message": "配置无法保存或读取，请检查磁盘空间和数据目录权限。",
        },
    )

# Static files. Runtime data is intentionally not mounted as a public tree;
# image access is limited to the validated /api/images endpoints above.
frontend_dir = str(FRONTEND_DIR)
if FRONTEND_DIR.exists():
    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    @app.get("/index.html", response_class=HTMLResponse, include_in_schema=False)
    def frontend_index():
        index_path = FRONTEND_DIR / "index.html"
        html = index_path.read_text(encoding="utf-8")
        marker = "__GTM_SESSION_BOOTSTRAP__"
        if marker not in html:
            logger.error("前端会话引导标记缺失")
            return HTMLResponse("Frontend bootstrap is unavailable", status_code=500)
        return HTMLResponse(
            html.replace(
                f'content="{marker}"',
                f'content="{_LOCAL_SESSION_TOKEN}"',
                1,
            ),
            headers={"Cache-Control": "no-store"},
        )

    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    logger.error("前端资源目录不存在: %s", FRONTEND_DIR)


# ── 服务启动 ──────────────────────────────────────────
_uvicorn_server = None


def _find_free_port(host="127.0.0.1"):
    """让系统分配一个当前可用的本地端口。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return sock.getsockname()[1]


def _run_server(host="127.0.0.1", port=8000):
    """在独立线程中启动 uvicorn"""
    import uvicorn
    global _uvicorn_server
    config = uvicorn.Config(
        app,
        host=host,
        port=port,
        log_level="debug" if IS_DEBUG else "info",
    )
    _uvicorn_server = uvicorn.Server(config)
    _uvicorn_server.run()


def _wait_for_server(url, timeout=15.0):
    """等待健康检查成功，避免依赖固定时长的 sleep。"""
    deadline = time.monotonic() + timeout
    parsed = urlsplit(url)
    while time.monotonic() < deadline:
        connection = None
        try:
            connection = HTTPConnection(parsed.hostname, parsed.port, timeout=0.5)
            connection.request("GET", "/api/health")
            response = connection.getresponse()
            response.read()
            if response.status == 200:
                return True
        except Exception:
            time.sleep(0.1)
        finally:
            if connection is not None:
                connection.close()
    return False


def _stop_server():
    if _uvicorn_server is not None:
        _uvicorn_server.should_exit = True




class DesktopApi:
    """Minimal native bridge used only by the embedded desktop window."""

    def choose_download_directory(self, initial_directory=""):
        import webview
        from src.core.export_service import get_system_download_directory

        try:
            if not webview.windows:
                raise RuntimeError("desktop window is unavailable")
            window = webview.windows[0]
            initial = Path(str(initial_directory or "")).expanduser()
            if not initial.is_dir():
                initial = get_system_download_directory()
            file_dialog = getattr(webview, "FileDialog", None)
            dialog_type = (
                file_dialog.FOLDER
                if file_dialog is not None
                else webview.FOLDER_DIALOG
            )
            result = window.create_file_dialog(
                dialog_type,
                directory=str(initial),
            )
            return {"ok": True, "path": str(result[0]) if result else ""}
        except Exception:
            logger.exception("打开下载目录选择器失败")
            return {"ok": False, "error": "download_directory_dialog_failed"}


def _run_webview(url="http://127.0.0.1:8000", title="Game Tier Maker"):
    """嵌入式 webview 桌面窗口"""
    import webview
    desktop_api = DesktopApi()
    webview.create_window(title, url, width=1280, height=820,
                          min_size=(900, 600), confirm_close=False,
                          js_api=desktop_api)
    webview.start()


def _run_xbox_auth_helper(tokens_file):
    """Run xbox-webapi's browser authentication inside the packaged EXE."""
    from xbox.webapi.scripts.authenticate import main as xbox_authenticate

    original_argv = sys.argv[:]
    sys.argv = ["xbox-authenticate", "--tokens", str(Path(tokens_file).resolve())]
    try:
        xbox_authenticate()
    finally:
        sys.argv = original_argv


if __name__ == "__main__":
    if args.xbox_authenticate:
        try:
            _run_xbox_auth_helper(args.xbox_authenticate)
        finally:
            _instance_guard.release()
        raise SystemExit(0)

    HOST = "127.0.0.1"
    PORT = _find_free_port(HOST) if IS_FROZEN else args.port
    APP_URL = f"http://{HOST}:{PORT}"
    # HOST = "127.0.0.1"
    # PORT = _find_free_port(HOST)
    # APP_URL = f"http://{HOST}:{PORT}"

    # 启动后端线程
    server_thread = threading.Thread(target=_run_server, args=(HOST, PORT), daemon=True)
    server_thread.start()

    if not _wait_for_server(APP_URL):
        logger.critical("后端启动超时: %s", APP_URL)
        _stop_server()
        server_thread.join(timeout=5)
        raise SystemExit(1)

    try:

        if IS_FROZEN :
            # 打包模式 → 嵌入式 webview 窗口
            logger.info("启动桌面应用窗口: %s", APP_URL)
            _run_webview(APP_URL)

        else:
            # 开发 / 调试模式 → 系统浏览
            logger.info("%s", APP_URL)
            server_thread.join()
    except KeyboardInterrupt:
        logger.info("收到退出信号")
    finally:
        _stop_server()
        if server_thread.is_alive():
            server_thread.join(timeout=5)
        _instance_guard.release()
