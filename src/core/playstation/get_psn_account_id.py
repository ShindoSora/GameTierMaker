import logging

import requests

from src.core.errors import (
    AccountNotFoundError,
    CredentialExpiredError,
    CredentialMissingError,
    InvalidInputError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)

logger = logging.getLogger(__name__)


class GetPsnAccountId:
    @staticmethod
    def get_psn_account_id(access_token, psn_online_id):
        if not isinstance(access_token, str) or not access_token:
            raise CredentialMissingError(
                "PSN 登录信息缺失，请重新绑定账号",
                code="psn_access_token_missing",
            )
        if not isinstance(psn_online_id, str) or not psn_online_id.strip():
            raise InvalidInputError(
                "请填写 PSN 在线 ID",
                code="psn_online_id_missing",
            )

        psn_online_id = psn_online_id.strip()
        url = (
            "https://us-prof.np.community.playstation.net/"
            f"userProfile/v1/users/{psn_online_id}/profile2"
        )
        headers = {"Authorization": f"Bearer {access_token}"}
        params = {"fields": "accountId,onlineId,currentOnlineId"}

        try:
            logger.info("请求 PSN account_id")
            response = requests.request(
                "GET", url, headers=headers, params=params, timeout=30
            )
            logger.info("account_id 响应状态: %s", response.status_code)
            response.raise_for_status()
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else None
            logger.warning("PSN account_id 请求失败: HTTP %s", status or "unknown")
            if status == 401:
                raise CredentialExpiredError(
                    "PSN 登录信息已过期，请重新获取 NPSSO",
                    code="psn_token_expired",
                ) from exc
            if status == 404:
                raise AccountNotFoundError(
                    f"未找到 PSN 用户“{psn_online_id}”，请检查在线 ID 是否正确",
                    code="psn_account_not_found",
                ) from exc
            raise RemoteServiceError("PSN 账号查询服务暂时不可用，请稍后重试") from exc
        except requests.exceptions.Timeout as exc:
            raise RemoteTimeoutError(
                "PSN 账号查询请求超时，请检查网络连接"
            ) from exc
        except requests.exceptions.RequestException as exc:
            logger.warning("PSN account_id 请求失败", exc_info=True)
            raise RemoteServiceError(
                "无法连接 PSN 服务，请检查网络连接"
            ) from exc

        try:
            result = response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("PSN 账号查询响应格式不正确") from exc

        if not isinstance(result, dict):
            raise RemoteResponseError("PSN 账号查询响应格式不正确")

        profile = result.get("profile")
        if profile is None:
            raise AccountNotFoundError(
                f"未找到 PSN 用户“{psn_online_id}”，请检查在线 ID 是否正确",
                code="psn_account_not_found",
            )
        if not isinstance(profile, dict):
            raise RemoteResponseError("PSN 账号查询响应格式不正确")

        account_id = profile.get("accountId")
        if not isinstance(account_id, str) or not account_id:
            raise AccountNotFoundError(
                f"未找到 PSN 用户“{psn_online_id}”，请检查在线 ID 是否正确",
                code="psn_account_not_found",
            )

        logger.info("PSN account_id 获取成功")
        return account_id
