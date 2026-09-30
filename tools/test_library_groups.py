"""Account group naming checks, using disposable projects and no account/network access."""

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.api.library import build_library_payload
from src.api import settings
from src.api.nintendo import _group_name
from src.core.library_groups import format_account_group_name
from src.core.manager import ProjectManager
from src.core.models import ImageGroup


class LibraryGroupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="gtm-group-test-")
        self.addCleanup(self.temp.cleanup)
        self.manager = ProjectManager(self.temp.name)

    def test_binding_and_resync_persist_platform_names_without_duplicate_groups(self):
        for group_id, prefix in [
            ("psn_import_123", "PS"), ("xbox:123", "Xbox"),
            ("nintendo:123", "Nintendo"), ("steam_import_123", "Steam"),
        ]:
            with self.subTest(group_id=group_id):
                games = [{"appid": prefix, "name": "Game", "cover": {"url": "https://example.invalid/cover.jpg"}}]
                self.manager.register_remote_images(games, "", group_id, group_name="玩家")
                group = self.manager.current_template.hidden_preset.find_group_by_id(group_id)
                image_id = group.image_ids[0]
                group.image_ids.clear()
                self.manager.current_template.unassigned_images.append(image_id)
                self.manager.register_remote_images(games, "", group_id, replace_group=True, group_name=f"{prefix}:新名字")
                self.assertEqual(group.name, f"{prefix}:新名字")
                self.assertEqual(group.image_ids, [])
                self.assertIn(image_id, self.manager.current_template.unassigned_images)
                self.assertEqual(sum(g.id == group_id for g in self.manager.current_template.hidden_preset.groups), 1)
        saved = json.loads(Path(self.manager.project_file).read_text(encoding="utf-8"))
        names = {g["id"]: g["name"] for g in saved["templates"][0]["hidden_preset"]["groups"]}
        self.assertEqual(names["psn_import_123"], "PS:新名字")
        self.assertEqual(names["nintendo:123"], "Nintendo:新名字")

    def test_legacy_snapshot_names_are_formatted_without_mutating_project(self):
        library = self.manager.current_template.hidden_preset
        library.groups.extend([
            ImageGroup("psn_import_123456789", "PSN 12345678"),
            ImageGroup("xbox:123", "玩家"),
            ImageGroup("nintendo:123", "Nintendo:玩家"),
            ImageGroup("custom", "PS:自定义分组"),
        ])
        before = copy.deepcopy(self.manager.project_data)
        payload = build_library_payload(self.manager)
        names = {g["id"]: g["name"] for g in payload["groups"]}
        self.assertEqual(names["psn_import_123456789"], "PS:12345678")
        self.assertEqual(names["xbox:123"], "Xbox:玩家")
        self.assertEqual(names["nintendo:123"], "Nintendo:玩家")
        self.assertEqual(names["custom"], "PS:自定义分组")
        self.assertEqual(before, self.manager.project_data)

    def test_legacy_creation_helpers_and_nintendo_names_use_platform_prefixes(self):
        with patch.object(settings, "get_manager", return_value=self.manager), patch.object(
            settings.SteamInformation, "get_accounts", return_value={"123": {"personaname": "玩家"}}
        ):
            settings._ensure_steam_group("123")
            settings._ensure_psn_group("123", "玩家")
            settings._ensure_xbox_group("123", "玩家")
        names = {g.id: g.name for g in self.manager.current_template.hidden_preset.groups}
        self.assertEqual(names["steam_import_123"], "Steam:玩家")
        self.assertEqual(names["psn_import_123"], "PS:玩家")
        self.assertEqual(names["xbox:123"], "Xbox:玩家")
        self.assertEqual(_group_name({"display_name": "玩家"}, "123"), "Nintendo:玩家")
        self.assertEqual(_group_name({}, "123456789"), "Nintendo:12345678")

    def test_existing_prefix_is_idempotent_and_custom_names_are_unchanged(self):
        self.assertEqual(format_account_group_name("psn_import_123", "PSN: 玩家"), "PS:玩家")
        self.assertEqual(format_account_group_name("psn_import_123", "PS:玩家"), "PS:玩家")
        self.assertEqual(format_account_group_name("custom", "  我的分组  "), "  我的分组  ")


if __name__ == "__main__":
    unittest.main()
