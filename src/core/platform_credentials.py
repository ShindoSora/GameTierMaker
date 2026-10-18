"""DPAPI storage for browser-acquired platform credentials, never exposed to UI."""
import json
from pathlib import Path

from src.core.credential_store import protect_secret, unprotect_secret
from src.core.json_store import read_json_with_backup, update_json, validate_json_object


def _path():
    from src.core.config_handler import ConfigHandler
    return Path(ConfigHandler._get_root_dir()) / "config" / "platform_credentials.json"


def read_credentials(platform):
    data = read_json_with_backup(str(_path()), validator=validate_json_object,
                                 default={}, use_default_when_missing=True)
    protected = data.get(platform)
    return json.loads(unprotect_secret(protected)) if protected else {}


def save_credentials(platform, **values):
    # Encrypt before the atomic JSON write (including its backup).
    def update(data):
        current = json.loads(unprotect_secret(data[platform])) if data.get(platform) else {}
        current.update(values)
        data[platform] = protect_secret(json.dumps(current, ensure_ascii=False))
    update_json(str(_path()), update, default={}, validator=validate_json_object)
