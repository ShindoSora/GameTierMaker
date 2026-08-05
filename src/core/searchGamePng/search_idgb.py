import logging
import requests
from src.core.config_handler import ConfigHandler
from src.core.searchGamePng.search_bangumi import SearchBANGUI

logger = logging.getLogger(__name__)

class SearchIDGB:
    def __init__(self):
        self.searchBANGUI = SearchBANGUI()
        self.config = ConfigHandler()

    def get_png(self, game_name):
        success, client_id, access_token = self.config.get_token()
        if not success or client_id is None or access_token is None:
            logger.warning("无法获取 IGDB 认证令牌，回退到 Bangumi")
            return self.searchBANGUI.get_png(game_name)

        url = "https://api.igdb.com/v4/games"
        headers = {
            "Client-ID": client_id,
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "text/plain",
        }
        query_body = f'search "{game_name}"; fields name, cover.url; limit 200;'

        try:
            logger.debug("搜索游戏: %s", game_name)
            response = requests.post(url, headers=headers, data=query_body, timeout=10)
            if response.status_code == 200:
                data = response.json()
                if data:
                    logger.debug("搜索成功，找到 %d 个结果", len(data))
                    return data
                else:
                    logger.debug("IGDB 搜索无结果: %s，回退到 Bangumi", game_name)
                    return self.searchBANGUI.get_png(game_name)
            else:
                logger.error("IGDB API 请求失败，状态码: %s，回退到 Bangumi", response.status_code)
                return self.searchBANGUI.get_png(game_name)
        except requests.exceptions.RequestException as e:
            logger.error("IGDB 网络请求异常: %s，回退到 Bangumi", e)
            return self.searchBANGUI.get_png(game_name)
        except Exception:
            logger.error("IGDB 未知异常，回退到 Bangumi")
            return self.searchBANGUI.get_png(game_name)


