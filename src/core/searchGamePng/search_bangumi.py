import requests
from src.core.config_handler import ConfigHandler
from src.core.errors import (
    AccountNotFoundError,
    CredentialMissingError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)

class SearchBANGUI:
    def __init__(self):
        self.config = ConfigHandler()

    def get_png(self, game_name):
        bangumi_user_agent = self.config.get_bangumi_user_agent()
        if not bangumi_user_agent:
            raise CredentialMissingError(
                "请先在设置中填写 Bangumi User-Agent",
                code="bangumi_user_agent_missing",
            )

        url = "https://api.bgm.tv/v0/search/subjects"
        data = {
            "keyword": game_name,
            "filter": {
                "type": [1,2,3,4,6]
            }
        }
        headers = {
            "User-Agent": bangumi_user_agent
        }
        params = {
            "limit": 200,
            "offset": 0,
        }

        try:
            res = requests.post(url, params=params,json=data, headers=headers, timeout=10)
        except requests.exceptions.Timeout as exc:
            raise RemoteTimeoutError(
                "Bangumi 搜索超时，请检查网络连接",
                code="bangumi_search_timeout",
            ) from exc
        except requests.exceptions.RequestException as exc:
            raise RemoteServiceError(
                "无法连接 Bangumi 服务，请检查网络连接",
                code="bangumi_service_unavailable",
            ) from exc

        if res.status_code != 200:
            raise RemoteServiceError(
                "Bangumi 服务暂时无法完成搜索，请稍后重试",
                code="bangumi_service_error",
            )

        try:
            result = res.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("Bangumi 返回的数据格式异常") from exc

        if not isinstance(result, dict):
            raise RemoteResponseError("Bangumi 返回的数据格式异常")
        if not result.get("data"):
            raise AccountNotFoundError(
                "未找到匹配的游戏",
                code="game_search_no_results",
            )

        if not isinstance(result["data"], list):
            raise RemoteResponseError("Bangumi 返回的数据格式异常")

        games = []
        for item in result.get("data", []):
            if not isinstance(item, dict):
                raise RemoteResponseError("Bangumi 返回的数据格式异常")
            images = item.get("images") or {}
            if not isinstance(images, dict):
                raise RemoteResponseError("Bangumi 返回的数据格式异常")
            games.append({
                "name": item.get("name"),
                "id": item.get("id"),
                "cover": {
                    "url": images.get("large", images.get("medium"))
                }
            })
        return games
