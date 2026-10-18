from src.core.config_handler import ConfigHandler
from src.core.errors import CredentialMissingError
from src.core.json_store import JsonStoreError


class XboxLiveToken:
    def __init__(self, config=None):
        self.config = config or ConfigHandler()

    def get_xbox_live_token(self):
        try:
            return self.config.get_xbox_data()
        except (OSError, JsonStoreError):
            raise CredentialMissingError("请点击绑定，在登录浏览器中完成 Xbox 验证", code="xbox_login_required") from None

