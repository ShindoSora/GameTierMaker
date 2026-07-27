import re
from src.core.searchGamePng.search_idgb import SearchIDGB
from src.core.searchGamePng.search_bangumi import SearchBANGUI

class GetGameJpg:
    def __init__(self):
        self.searchIDGB = SearchIDGB()
        self.searchBANGUI = SearchBANGUI()

    def get_game_image(self, query):
        if not query or not isinstance(query, str):
            return False

        game_name = query.strip()
        if not game_name:
            return False

        #中文则调用bangumi，反之IDGB
        if re.search(r'[\u4e00-\u9fff]', game_name):
            return self.searchBANGUI.get_png(game_name)
        else:
            return self.searchIDGB.get_png(game_name)
