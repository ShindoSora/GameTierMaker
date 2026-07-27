import logging
import re

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


class GetPsnTitles:
    @staticmethod
    def _parse_play_duration(duration_str: str) -> float:
        """将 ISO 8601 duration 转换为小时数。"""
        if not duration_str:
            return 0.0
        total_hours = 0.0
        match = re.match(r"^PT(\d+H)?(\d+M)?(\d+S)?$", duration_str.strip())
        if not match:
            return 0.0
        hours, minutes, seconds = match.groups()
        if hours:
            total_hours += float(hours.removesuffix("H"))
        if minutes:
            total_hours += float(minutes.removesuffix("M")) / 60.0
        if seconds:
            total_hours += float(seconds.removesuffix("S")) / 3600.0
        return total_hours

    @staticmethod
    def get_psn_titles(
        access_token,
        account_id,
        categories=None,
        min_play_duration_hours=0.0,
    ):
        """获取 PSN 游戏列表，支持分页、平台和游玩时长筛选。"""
        if not isinstance(access_token, str) or not access_token:
            raise CredentialMissingError(
                "PSN 登录信息缺失，请重新绑定账号",
                code="psn_access_token_missing",
            )
        if not isinstance(account_id, str) or not account_id:
            raise InvalidInputError(
                "PSN 账号 ID 无效",
                code="psn_account_id_invalid",
            )
        if categories is not None:
            if not isinstance(categories, (list, tuple)) or not all(
                isinstance(category, str) for category in categories
            ):
                raise InvalidInputError(
                    "PSN 平台筛选条件格式不正确",
                    code="psn_categories_invalid",
                )
        try:
            min_hours = float(min_play_duration_hours)
        except (TypeError, ValueError) as exc:
            raise InvalidInputError(
                "PSN 最低游玩时长格式不正确",
                code="psn_min_play_duration_invalid",
            ) from exc
        if min_hours < 0:
            raise InvalidInputError(
                "PSN 最低游玩时长不能小于零",
                code="psn_min_play_duration_invalid",
            )

        url = f"https://m.np.playstation.com/api/gamelist/v2/users/{account_id}/titles"
        headers = {"Authorization": f"Bearer {access_token}"}
        params = {"limit": "200", "offset": "0"}
        if categories:
            params["categories"] = ",".join(categories)
            logger.info("PSN titles 平台筛选: %s", params["categories"])

        all_titles = []
        total_item_count = None

        while True:
            try:
                logger.info(
                    "PSN titles 请求: offset=%s, limit=%s",
                    params["offset"],
                    params["limit"],
                )
                response = requests.get(
                    url, headers=headers, params=params, timeout=30
                )
                response.raise_for_status()
            except requests.exceptions.HTTPError as exc:
                status = exc.response.status_code if exc.response is not None else None
                logger.warning("PSN 游戏列表请求失败: HTTP %s", status or "unknown")
                if status == 401:
                    raise CredentialExpiredError(
                        "PSN 登录信息已过期，请重新获取 NPSSO",
                        code="psn_token_expired",
                    ) from exc
                if status == 404:
                    raise AccountNotFoundError(
                        "未找到对应的 PSN 游戏库，请重新绑定账号",
                        code="psn_account_not_found",
                    ) from exc
                raise RemoteServiceError(
                    "PSN 游戏库服务暂时不可用，请稍后重试"
                ) from exc
            except requests.exceptions.Timeout as exc:
                raise RemoteTimeoutError(
                    "PSN 游戏列表请求超时，请检查网络连接"
                ) from exc
            except requests.exceptions.RequestException as exc:
                logger.warning("PSN 游戏列表请求失败", exc_info=True)
                raise RemoteServiceError(
                    "无法连接 PSN 服务，请检查网络连接"
                ) from exc

            try:
                result = response.json()
            except (TypeError, ValueError) as exc:
                raise RemoteResponseError("PSN 游戏列表响应格式不正确") from exc
            if not isinstance(result, dict):
                raise RemoteResponseError("PSN 游戏列表响应格式不正确")

            if total_item_count is None:
                total_item_count = result.get("totalItemCount", 0)
                if (
                    not isinstance(total_item_count, int)
                    or isinstance(total_item_count, bool)
                    or total_item_count < 0
                ):
                    raise RemoteResponseError("PSN 游戏列表响应格式不正确")
                logger.info("PSN titles 总数: %d", total_item_count)

            titles = result.get("titles", [])
            if not isinstance(titles, list) or not all(
                isinstance(title, dict) for title in titles
            ):
                raise RemoteResponseError("PSN 游戏列表响应格式不正确")
            if not titles:
                break
            all_titles.extend(titles)

            next_offset = result.get("nextOffset")
            if next_offset is None:
                break
            if (
                not isinstance(next_offset, int)
                or isinstance(next_offset, bool)
                or next_offset < 0
            ):
                raise RemoteResponseError("PSN 游戏列表分页信息格式不正确")
            if next_offset >= total_item_count:
                break

            current_offset = int(params["offset"])
            if next_offset <= current_offset:
                raise RemoteResponseError("PSN 游戏列表分页信息格式不正确")
            params["offset"] = str(next_offset)

        logger.info("PSN titles 获取完成: 共 %d 款游戏", len(all_titles))

        if min_hours > 0:
            filtered = []
            for title in all_titles:
                hours = GetPsnTitles._parse_play_duration(
                    title.get("playDuration", "")
                )
                if hours >= min_hours:
                    filtered.append(title)
            logger.info(
                "PSN titles 时长筛选: %d -> %d（最低 %.1f 小时）",
                len(all_titles),
                len(filtered),
                min_hours,
            )
            return filtered

        return all_titles
