import logging
import os

from src.core.config_handler import ConfigHandler
from src.core.errors import (
    AppError,
    CredentialExpiredError,
    CredentialMissingError,
    InvalidInputError,
    RemoteResponseError,
)
from src.core.json_store import (
    JsonStoreError,
    read_json_with_backup,
    update_json,
    validate_json_object,
)
from src.core.playstation.get_psn_account_id import GetPsnAccountId
from src.core.playstation.get_psn_titles import GetPsnTitles
from src.core.playstation.get_psn_token import GetPsnToken
from src.core.playstation.get_psn_user_profile import (
    GetPSNUserProfile,
    normalize_psn_avatar_url,
)

logger = logging.getLogger(__name__)


class PSNClient:
    def __init__(self):
        self.config = ConfigHandler()
        self.getPSNToken = GetPsnToken()
        self.getPSNAccountId = GetPsnAccountId()
        self.getPSNUserProfile = GetPSNUserProfile()
        self.getPSNTitles = GetPsnTitles()

    def _get_token_with_retry(self, *, force_refresh=False):
        """读取 NPSSO 并获取 token"""
        try:
            psn_npssoo = self.config.get_psn_npsso()
        except AppError:
            raise
        except Exception as exc:
            logger.exception("读取 PSN NPSSO失败")
            raise AppError(
                "无法读取 PSN NPSSO",
                code="psn_config_unavailable",
            ) from exc

        if not isinstance(psn_npssoo, str) or not psn_npssoo.strip():
            raise CredentialMissingError(
                "请先在设置中填写 PSN NPSSO",
                code="psn_npsso_missing",
            )
        if force_refresh:
            return self.getPSNToken.get_psn_token(
                psn_npssoo,
                force_refresh=True,
            )
        return self.getPSNToken.get_psn_token(psn_npssoo)

    def _call_with_token_retry(self, access_token, step_name, operation):
        """执行需要 token 的步骤；仅在凭证过期时强制刷新并重试一次。"""
        for attempt in range(2):
            try:
                return operation(access_token), access_token
            except CredentialExpiredError:
                if attempt == 1:
                    raise
                logger.info("PSN token 过期，强制刷新后重试（%s）", step_name)
                access_token = self._get_token_with_retry(force_refresh=True)
            except AppError:
                raise
            except Exception as exc:
                logger.exception("PSN %s 步骤发生未预期错误", step_name)
                raise AppError(
                    "PSN 同步过程中发生错误，请稍后重试",
                    code="psn_sync_failed",
                ) from exc

        raise RuntimeError("unreachable")

    @staticmethod
    def get_accounts():
        """读取 psn_config.json 中所有已绑定的账号。"""
        path = ConfigHandler.get_psn_config_path()
        if not os.path.exists(path):
            return {}
        try:
            config = read_json_with_backup(path, validator=validate_json_object)
        except JsonStoreError as exc:
            logger.warning("psn_config.json 内容无效: %s", exc)
            return {}
        accounts = config.get("user", {})
        if not isinstance(accounts, dict):
            logger.warning("psn_config.json 中的 user 字段格式不正确")
            return {}
        normalized_accounts = {}
        for account_id, info in accounts.items():
            if not isinstance(info, dict):
                normalized_accounts[account_id] = info
                continue
            normalized_info = dict(info)
            normalized_info["avatarfull"] = normalize_psn_avatar_url(
                normalized_info.get("avatarfull", "")
            )
            normalized_accounts[account_id] = normalized_info
        return normalized_accounts

    @staticmethod
    def remove_account(account_id):
        """从 psn_config.json 中移除指定账号。"""
        path = ConfigHandler.get_psn_config_path()

        def remove_profile(config):
            if "user" in config:
                config["user"].pop(account_id, None)

        update_json(
            path,
            remove_profile,
            default={},
            validator=validate_json_object,
        )
        logger.info("PSN 账号已移除: %s", account_id)

    def psn_client(self, psn_online_id, categories=None, min_play_duration_hours=0.0):
        """执行完整的 PSN 账号与游戏库同步流程。"""
        if not isinstance(psn_online_id, str) or not psn_online_id.strip():
            raise InvalidInputError(
                "请填写 PSN 在线 ID",
                code="psn_online_id_missing",
            )
        psn_online_id = psn_online_id.strip()

        access_token = self._get_token_with_retry()

        account_id, access_token = self._call_with_token_retry(
            access_token,
            "账号查询",
            lambda token: self.getPSNAccountId.get_psn_account_id(
                token, psn_online_id
            ),
        )
        if not account_id:
            raise RemoteResponseError("PSN 账号查询响应中缺少账号 ID")

        _, access_token = self._call_with_token_retry(
            access_token,
            "用户资料",
            lambda token: self.getPSNUserProfile.get_psn_user_profile(
                token, account_id
            ),
        )

        accounts = self.get_accounts()
        account_info = accounts.get(account_id, {})
        avatar_url = account_info.get("avatarfull", "")
        online_id = account_info.get("onlineId", psn_online_id)

        titles, _ = self._call_with_token_retry(
            access_token,
            "游戏列表",
            lambda token: self.getPSNTitles.get_psn_titles(
                token,
                account_id,
                categories=categories,
                min_play_duration_hours=min_play_duration_hours,
            ),
        )

        logger.info(
            "PSN 同步完成: account_id=%s, online_id=%s, 获取 %d 款游戏",
            account_id,
            online_id,
            len(titles),
        )
        return {
            "account_id": account_id,
            "online_id": online_id,
            "avatar_url": avatar_url,
            "titles": titles,
        }
