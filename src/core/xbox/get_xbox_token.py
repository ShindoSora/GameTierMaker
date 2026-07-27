import logging
import subprocess
import sys

from src.core.config_handler import ConfigHandler


logger = logging.getLogger(__name__)


class XboxLiveToken:
    def __init__(self, config=None):
        self.config = config or ConfigHandler()

    def get_xbox_live_token(self):
        tokens_file = self.config.get_xbox_tokens_path()
        if getattr(sys, "frozen", False):
            command = [sys.executable, "--xbox-authenticate", tokens_file]
        else:
            command = ["xbox-authenticate", "--tokens", tokens_file]

        try:
            subprocess.run(command, check=True)
            json_str = self.config.get_xbox_data()
            return json_str
        except (OSError, subprocess.CalledProcessError) as exc:
            logger.error("Xbox authentication failed: %s", exc)
            return False

