"""Application errors that are safe to expose through the local API."""

from __future__ import annotations


class AppError(RuntimeError):
    """Base class for expected failures in application workflows.

    ``code`` is stable and intended for programmatic handling. ``message`` is a
    user-facing explanation and must not contain secrets or raw response data.
    """

    code = "app_error"
    default_message = "操作失败"

    def __init__(self, message: str | None = None, *, code: str | None = None):
        self.code = code or self.code
        self.message = message or self.default_message
        super().__init__(self.message)


class InvalidInputError(AppError):
    code = "invalid_input"
    default_message = "输入内容不正确"


class ImageImportError(AppError):
    code = "image_import_failed"
    default_message = "图片导入失败"


class ExportWriteError(AppError):
    code = "export_write_failed"
    default_message = "导出图片无法保存"


class CredentialMissingError(AppError):
    code = "credential_missing"
    default_message = "尚未配置登录凭证"


class CredentialExpiredError(AppError):
    code = "credential_expired"
    default_message = "登录信息已过期，请重新登录"


class AccountNotFoundError(AppError):
    code = "account_not_found"
    default_message = "未找到指定账号"


class EmptyLibraryError(AppError):
    code = "library_empty"
    default_message = "游戏库为空或未公开"


class RemoteTimeoutError(AppError):
    code = "remote_timeout"
    default_message = "远程服务响应超时，请检查网络连接"


class RemoteServiceError(AppError):
    code = "remote_service_error"
    default_message = "远程服务暂时不可用，请稍后重试"


class RemoteResponseError(RemoteServiceError):
    code = "remote_response_invalid"
    default_message = "远程服务返回了无法识别的数据"
