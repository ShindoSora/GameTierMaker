import os
import sys
import json
import time
import logging
import requests
import threading

from .json_store import (
    JsonStoreError,
    atomic_write_json,
    read_json_with_backup,
    update_json,
    validate_json_object,
)


logger = logging.getLogger(__name__)

DEFAULT_UI_LANGUAGE = "zh-CN"
SUPPORTED_UI_LANGUAGES = {"zh-CN", "en-US"}
DEFAULT_UI_PREFERENCES = {
    "library_open": True,
    "library_width": 280,
    "settings_open": False,
    "settings_width": 500,
    "settings_active_section": "search_settings",
}
SUPPORTED_UI_SETTINGS_SECTIONS = {
    "search_settings",
    "language",
    "steam_accounts",
    "psn_accounts",
    "xbox_accounts",
    "nintendo_accounts",
    "download",
    "storage",
    "licenses",
}

class ConfigHandler:
    _igdb_token_lock = threading.Lock()

    def __init__(self):
        self.xbox_live_token = None
        self.psn_online_id = None
        self.psn_npssoo = None
        self.steam_key = None
        self.steamgriddb_api_key = None
        self.client_id = None
        self.client_secret = None
        self.expiration_time = None
        self.bangumi_user_agent = None
        self.config_path = ConfigHandler.get_config_path()
        logger.debug("配置文件路径: %s", self.config_path)

    def get_token(self):
        with self._igdb_token_lock:
            data = read_json_with_backup(
                self.config_path,
                validator=validate_json_object,
                default={},
                use_default_when_missing=True,
            )
            self.client_id = self.deep_get(data, "client_id")
            self.client_secret = self.deep_get(data, "client_secret")
            self.expiration_time = int(self.deep_get(data, "expiration_time") or 0)
            token = self.deep_get(data, "access_token")
            now_time = int(time.time())

            if self.expiration_time == 0 or now_time > self.expiration_time:
                return self.get_access_token()
            return True, self.client_id, token

    def get_access_token(self):
        url = "https://id.twitch.tv/oauth2/token"
        query_params = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "client_credentials",
        }
        try:
            response = requests.post(url, params=query_params, timeout=(3, 8))
            if response.status_code == 200:
                data = response.json()
                new_token = data.get("access_token")
                timestamp = data.get("expires_in") - 120
                return self.save_token_to_json(new_token,timestamp)
            else:
                logger.warning("IGDB token 请求失败，状态码: %s", response.status_code)
                return False, self.client_id, None
        except Exception:
            return False, self.client_id, None

    def save_token_to_json(self,new_token,timestamp):
        expiration_time = int(time.time()) + timestamp
        token = new_token

        def apply_token(config):
            self._deep_set(config, "access_token", token)
            self._deep_set(config, "expiration_time", expiration_time)

        update_json(
            self.config_path,
            apply_token,
            default={},
            validator=validate_json_object,
        )
        return True,self.client_id,token

    def get_bangumi_user_agent(self):
        data = read_json_with_backup(
            self.config_path,
            validator=validate_json_object,
            default={},
            use_default_when_missing=True,
        )
        self.bangumi_user_agent = self.deep_get(data, "bangumi_user_agent") or ""
        return self.bangumi_user_agent

    def get_steam_key(self):
        data = read_json_with_backup(
            self.config_path,
            validator=validate_json_object,
            default={},
            use_default_when_missing=True,
        )
        self.steam_key = self.deep_get(data, "steam_key") or ""
        return self.steam_key

    def get_steamgriddb_api_key(self):
        data = read_json_with_backup(
            self.config_path,
            validator=validate_json_object,
            default={},
            use_default_when_missing=True,
        )
        self.steamgriddb_api_key = self.deep_get(data, "steamgriddb_api_key") or ""
        return self.steamgriddb_api_key
        
    def get_psn_npsso(self):
        data = read_json_with_backup(
            self.config_path,
            validator=validate_json_object,
            default={},
            use_default_when_missing=True,
        )
        self.psn_npssoo = self.deep_get(data, "psn_npsso") or ""
        return self.psn_npssoo

    def get_psn_online_id(self):
        data = read_json_with_backup(
            self.config_path,
            validator=validate_json_object,
            default={},
            use_default_when_missing=True,
        )
        self.psn_online_id = self.deep_get(data, "psn_online_id") or ""
        return self.psn_online_id

    def get_xbox_data(self):
        path = self.get_xbox_tokens_path()
        data = read_json_with_backup(path, validator=validate_json_object)
        return json.dumps(data, ensure_ascii=False)

    # === 通用配置读写 ===
    @staticmethod
    def _get_root_dir():
        """获取项目根目录（开发时 = 项目根，打包后 = exe 所在目录）"""
        configured_root = os.environ.get("GAMELIST_ROOT")
        if configured_root:
            return configured_root
        if getattr(sys, 'frozen', False):
            return os.path.dirname(os.path.abspath(sys.executable))
        else:
            current_file = os.path.abspath(__file__)
            current_dir = os.path.dirname(current_file)
            return os.path.dirname(os.path.dirname(current_dir))

    @classmethod
    def get_config_path(cls):
        """获取 config.json 路径"""
        return os.path.join(ConfigHandler._get_root_dir(), "config", "config.json")

    @staticmethod
    def get_steam_config_path():
        """获取 steam_config.json 路径"""
        return os.path.join(ConfigHandler._get_root_dir(), "config", "steam_config.json")

    @staticmethod
    def get_psn_config_path():
        """获取 psn_config.json 路径"""
        return os.path.join(ConfigHandler._get_root_dir(), "config", "psn_config.json")

    @staticmethod
    def get_psn_filter_config_path():
        """获取 psn_filter_config.json 路径"""
        return os.path.join(ConfigHandler._get_root_dir(), "config", "psn_filter_config.json")

    @staticmethod
    def get_xbox_tokens_path():
        return os.path.join(ConfigHandler._get_root_dir(), "config", "xbox_tokens.json")

    @staticmethod
    def get_xbox_config_path():
        """获取 xbox_config.json 路径"""
        return os.path.join(ConfigHandler._get_root_dir(), "config", "xbox_config.json")

    @staticmethod
    def get_nintendo_accounts_path():
        """获取 Nintendo 非敏感账号资料路径。"""
        return os.path.join(ConfigHandler._get_root_dir(), "config", "nintendo_accounts.json")

    @staticmethod
    def get_nintendo_credentials_path():
        """获取 Nintendo DPAPI 密文路径。"""
        return os.path.join(ConfigHandler._get_root_dir(), "config", "nintendo_credentials.json")

    @staticmethod
    def get_nintendo_records_dir():
        """获取 Nintendo 游玩记录目录。"""
        return os.path.join(ConfigHandler._get_root_dir(), "data", "nintendo_records")

    @staticmethod
    def read_psn_filter_config():
        """读取 PSN 筛选配置，文件不存在时返回默认值"""
        path = ConfigHandler.get_psn_filter_config_path()
        if not os.path.exists(path):
            return {"categories": [], "min_play_duration_hours": 0}
        try:
            return read_json_with_backup(path, validator=validate_json_object)
        except JsonStoreError as exc:
            logger.warning("PSN 筛选配置不可用，将使用默认值: %s", exc)
            return {"categories": [], "min_play_duration_hours": 0}

    @staticmethod
    def save_psn_filter_config(categories: list, min_play_duration_hours: float):
        """保存 PSN 筛选配置"""
        path = ConfigHandler.get_psn_filter_config_path()
        config = {"categories": categories, "min_play_duration_hours": min_play_duration_hours}
        atomic_write_json(path, config, validator=validate_json_object)

    @staticmethod
    def read_config():
        """读取完整配置，文件不存在或为空时返回空字典"""
        path = ConfigHandler.get_config_path()
        if not os.path.exists(path):
            return {}
        return read_json_with_backup(path, validator=validate_json_object)

    @staticmethod
    def get_ui_language() -> str:
        """读取界面语言；旧配置或非法值统一回退到简体中文。"""
        config = ConfigHandler.read_config()
        language = ConfigHandler.deep_get(config, "ui_language")
        return (
            language
            if isinstance(language, str) and language in SUPPORTED_UI_LANGUAGES
            else DEFAULT_UI_LANGUAGE
        )

    @staticmethod
    def save_ui_language(language: str) -> None:
        """保存经过接口校验的界面语言。"""
        ConfigHandler.update_config_fields({"ui_language": language})

    @staticmethod
    def get_download_directory() -> str:
        """读取桌面版自定义下载目录；空值表示跟随系统下载目录。"""
        config = ConfigHandler.read_config()
        directory = ConfigHandler.deep_get(config, "download_directory")
        return directory.strip() if isinstance(directory, str) else ""

    @staticmethod
    def save_download_directory(directory: str) -> None:
        """保存桌面版自定义下载目录，并固定为顶层配置项。"""
        path = ConfigHandler.get_config_path()

        def apply_directory(config):
            config["download_directory"] = directory

        update_json(
            path,
            apply_directory,
            default={},
            validator=validate_json_object,
        )

    @staticmethod
    def normalize_ui_preferences(preferences: dict | None) -> dict:
        """Normalize UI layout preferences shared by browser and desktop WebView."""
        raw = preferences if isinstance(preferences, dict) else {}

        def bounded_int(name: str, minimum: int, maximum: int) -> int:
            value = raw.get(name, DEFAULT_UI_PREFERENCES[name])
            try:
                value = int(value)
            except (TypeError, ValueError):
                value = DEFAULT_UI_PREFERENCES[name]
            return max(minimum, min(maximum, value))

        section = raw.get(
            "settings_active_section",
            DEFAULT_UI_PREFERENCES["settings_active_section"],
        )
        if section not in SUPPORTED_UI_SETTINGS_SECTIONS:
            section = DEFAULT_UI_PREFERENCES["settings_active_section"]

        return {
            "library_open": raw.get("library_open", DEFAULT_UI_PREFERENCES["library_open"])
            if isinstance(raw.get("library_open", DEFAULT_UI_PREFERENCES["library_open"]), bool)
            else DEFAULT_UI_PREFERENCES["library_open"],
            "library_width": bounded_int("library_width", 180, 600),
            "settings_open": raw.get("settings_open", DEFAULT_UI_PREFERENCES["settings_open"])
            if isinstance(raw.get("settings_open", DEFAULT_UI_PREFERENCES["settings_open"]), bool)
            else DEFAULT_UI_PREFERENCES["settings_open"],
            "settings_width": bounded_int("settings_width", 320, 900),
            "settings_active_section": section,
        }

    @staticmethod
    def get_ui_preferences() -> dict:
        """Read persistent UI layout preferences from the stable app config."""
        config = ConfigHandler.read_config()
        return ConfigHandler.normalize_ui_preferences(
            ConfigHandler.deep_get(config, "ui_preferences")
        )

    @staticmethod
    def save_ui_preferences(preferences: dict) -> dict:
        """Atomically save normalized UI layout preferences without replacing config."""
        normalized = ConfigHandler.normalize_ui_preferences(preferences)
        ConfigHandler.update_config_fields({"ui_preferences": normalized})
        return normalized

    @staticmethod
    def deep_get(data: dict, key: str):
        """
        递归搜索嵌套字典中的 key，返回第一个匹配的值。
        无论 config.json 是扁平结构还是嵌套结构都能找到字段。
        """
        if key in data:
            return data[key]
        for v in data.values():
            if isinstance(v, dict):
                result = ConfigHandler.deep_get(v, key)
                if result is not None:
                    return result
        return None

    @staticmethod
    def _deep_set(data: dict, key: str, value):
        """
        递归搜索嵌套字典中的 key 并原地更新其值。
        如果 key 不存在于任何层级，则设置在顶层。
        无论 config.json 如何嵌套都能正确定位字段。
        """
        if key in data:
            data[key] = value
            return True
        for v in data.values():
            if isinstance(v, dict):
                if ConfigHandler._deep_set(v, key, value):
                    return True
        # 未找到，设置在顶层
        data[key] = value
        return True

    @staticmethod
    def update_config_fields(fields: dict):
        """合并写入指定字段，保留其他已有字段。
        通过 _deep_set 定位每个字段在当前结构中的位置，
        无论 config.json 是扁平还是嵌套结构都能正确更新。"""
        path = ConfigHandler.get_config_path()

        def apply_fields(config):
            for key, value in fields.items():
                ConfigHandler._deep_set(config, key, value)

        update_json(
            path,
            apply_fields,
            default={},
            validator=validate_json_object,
        )
