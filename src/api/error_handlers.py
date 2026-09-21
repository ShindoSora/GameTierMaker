"""Consistent JSON error responses for the local FastAPI application."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from src.core.errors import (
    AccountNotFoundError,
    AppError,
    CredentialExpiredError,
    CredentialMissingError,
    EmptyLibraryError,
    InvalidInputError,
    RemoteServiceError,
    RemoteTimeoutError,
)

logger = logging.getLogger(__name__)


def _status_code_for(exc: AppError) -> int:
    if exc.code in {"nintendo_rate_limited"}:
        return 429
    if exc.code.startswith("nintendo_store_") or exc.code == "nintendo_credential_store_unavailable":
        return 500
    if exc.code in {"upload_too_large", "export_too_large"}:
        return 413
    if isinstance(exc, InvalidInputError):
        return 400
    if isinstance(exc, (CredentialMissingError, CredentialExpiredError)):
        return 409
    if isinstance(exc, AccountNotFoundError):
        return 404
    if isinstance(exc, EmptyLibraryError):
        return 422
    if isinstance(exc, RemoteTimeoutError):
        return 504
    if isinstance(exc, RemoteServiceError):
        return 502
    return 500


def _log_exception(request: Request, exc: Exception, message: str) -> None:
    logger.error(
        "%s: %s %s",
        message,
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError):
        status_code = _status_code_for(exc)
        if status_code >= 500:
            _log_exception(request, exc, "业务请求失败")
        return JSONResponse(
            status_code=status_code,
            content={"error": exc.code, "message": exc.message},
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, exc: HTTPException):
        if isinstance(exc.detail, dict):
            code = str(exc.detail.get("error") or "request_failed")
            message = str(exc.detail.get("message") or "请求处理失败")
        else:
            code = "request_failed"
            message = str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": code, "message": message},
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={
                "error": "invalid_request",
                "message": "提交的数据格式不正确",
            },
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception):
        _log_exception(request, exc, "未处理的接口异常")
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_error",
                "message": "程序处理请求时发生错误，请查看日志",
            },
        )
