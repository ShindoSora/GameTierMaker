import os
import logging
import requests
from src.core.config_handler import ConfigHandler
from src.core.errors import (
    AccountNotFoundError,
    CredentialMissingError,
    EmptyLibraryError,
    RemoteResponseError,
    RemoteServiceError,
    RemoteTimeoutError,
)
from src.core.json_store import (
    JsonStoreError,
    read_json_with_backup,
    update_json,
    validate_json_object,
)

logger = logging.getLogger(__name__)


class SteamInformation:

    @staticmethod
    def _get_api_key():
        config = ConfigHandler.read_config()
        steam_key = ConfigHandler.deep_get(config, "steam_key") or ""
        if not steam_key:
            raise CredentialMissingError(
                "请先在设置中填写 Steam API Key",
                code="steam_api_key_missing",
            )
        return steam_key

    @staticmethod
    def _request_json(url, params):
        try:
            response = requests.get(url, params=params, timeout=20)
            response.raise_for_status()
        except requests.exceptions.Timeout as exc:
            raise RemoteTimeoutError(
                "Steam 服务响应超时，请检查网络连接"
            ) from exc
        except requests.exceptions.ConnectionError as exc:
            raise RemoteServiceError(
                "暂时无法连接 Steam 服务，请检查网络连接"
            ) from exc
        except requests.exceptions.HTTPError as exc:
            raise RemoteServiceError(
                "Steam 服务暂时无法处理请求，请稍后重试"
            ) from exc
        except requests.exceptions.RequestException as exc:
            raise RemoteServiceError(
                "Steam 请求失败，请稍后重试"
            ) from exc

        try:
            result = response.json()
        except (TypeError, ValueError) as exc:
            raise RemoteResponseError("Steam 返回的数据格式异常") from exc

        if not isinstance(result, dict):
            raise RemoteResponseError("Steam 返回的数据格式异常")
        return result

    @staticmethod
    def get_steam_player_summaries(steamid):
        steam_key = SteamInformation._get_api_key()

        url = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"
        params = {"key": steam_key, "steamids": steamid}

        result = SteamInformation._request_json(url, params)
        response_data = result.get("response")
        if not isinstance(response_data, dict):
            raise RemoteResponseError("Steam 玩家信息格式异常")

        players = response_data.get("players")
        if not isinstance(players, list):
            raise RemoteResponseError("Steam 玩家信息格式异常")
        if not players:
            raise AccountNotFoundError(
                "未找到该 Steam 用户",
                code="steam_account_not_found",
            )
        if not isinstance(players[0], dict):
            raise RemoteResponseError("Steam 玩家信息格式异常")

        player = players[0]

        if player.get("communityvisibilitystate") != 3:
            raise EmptyLibraryError(
                "Steam 游戏库为空或隐私未公开",
                code="steam_library_private",
            )

        personaname = player.get("personaname", "")
        avatarfull = player.get("avatarfull", "")

        steam_config_path = ConfigHandler.get_steam_config_path()

        def save_profile(config):
            config.setdefault("user", {})[steamid] = {
                "personaname": personaname,
                "avatarfull": avatarfull,
            }

        update_json(
            steam_config_path,
            save_profile,
            default={},
            validator=validate_json_object,
        )

        return True

    @staticmethod
    def get_owned_games(steamid):
        steam_key = SteamInformation._get_api_key()

        url = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"
        params = {
            "key": steam_key,
            "steamid": steamid,
            "include_appinfo": "true",
        }

        result = SteamInformation._request_json(url, params)
        response_data = result.get("response")
        if not isinstance(response_data, dict):
            raise RemoteResponseError("Steam 游戏库数据格式异常")

        games = response_data.get("games", [])
        if not isinstance(games, list):
            raise RemoteResponseError("Steam 游戏库数据格式异常")
        if not games:
            raise EmptyLibraryError(
                "Steam 游戏库为空或隐私未公开",
                code="steam_library_empty",
            )
        if any(
            not isinstance(game, dict)
            or "appid" not in game
            or "name" not in game
            for game in games
        ):
            raise RemoteResponseError("Steam 游戏库数据格式异常")

        logger.info("Steam API: steamid=%s, 获取到 %d 款游戏", steamid, len(games))

        cdn = "https://shared.cloudflare.steamstatic.com"
        img_path = "/store_item_assets/steam/apps/"
        img_name = "/library_600x900.jpg"
        return [
            {
                "appid": game["appid"],
                "name": game["name"],
                "cover": {"url": cdn + img_path + str(game["appid"]) + img_name},
            }
            for game in games
        ]

    @staticmethod
    def get_accounts():
        """读取 steam_config.json 中所有已绑定的账号"""
        path = ConfigHandler.get_steam_config_path()
        if not os.path.exists(path):
            return {}
        try:
            config = read_json_with_backup(path, validator=validate_json_object)
        except JsonStoreError as exc:
            logger.warning("steam_config.json 内容无效: %s", exc)
            return {}
        return config.get("user", {})

    @staticmethod
    def remove_account(steamid):
        """从 steam_config.json 中移除指定账号"""
        path = ConfigHandler.get_steam_config_path()

        def remove_profile(config):
            if "user" in config:
                config["user"].pop(steamid, None)

        update_json(
            path,
            remove_profile,
            default={},
            validator=validate_json_object,
        )
