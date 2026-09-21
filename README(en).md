# Game Tier Maker

Python 3.13

[简体中文](README.md)|[ENGLISH](README(en).md)

Game Tier Maker is a locally run tool for creating game Tier Lists.

You can use the search feature to find game covers and other content, or configure authorization credentials for platforms such as Steam, PlayStation Network, Xbox, and Nintendo to retrieve the game libraries associated with those accounts.

You can import local images into the application.

Nintendo accounts use play-activity import: open Nintendo sign-in from Settings, then paste the `npf...://auth` callback link from the browser address bar back into the app and choose which games to import. Nintendo's play-history endpoint is undocumented and its data may be delayed; the current integration is subject to real-account verification. See [NINTENDO_IMPORT_DEV.md](aimd/NINTENDO_IMPORT_DEV.md) for the binding flow and development contract.

The application supports creating multiple sorting templates. You can right-click a tier row to change its color and double-click it to rename it.

<img width="1575" height="1009" alt="image" src="https://github.com/user-attachments/assets/bc277120-2ae6-4e6f-a40e-3abc01f9fbf1" />

<img width="1575" height="1008" alt="image" src="https://github.com/user-attachments/assets/c0b6e0e2-d9b8-44bb-b38d-26f416b26b00" />


## Running from Source

Clone the repository:

```powershell
git clone https://github.com/QuliKnight/glst.git
cd glst
```

Create a virtual environment and install the dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
```

Launch the application:

```powershell
.\.venv\Scripts\python.exe .\main.py
```

Visit http://localhost:8000 to access the application.

## Windows Executable

First, install the build dependencies:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\requirements-build.txt
```

Run the following command from the project root directory:

```powershell
.\.venv\Scripts\python.exe -m PyInstaller --clean --noconfirm .\GameTierMaker.spec
```

The executable will be located at:

```powershell
.\dist\GameTierMaker.exe
```

Double-click the executable to launch it.

The executable does not use the configuration stored in the source directory. Instead, it uses the `GameTierMaker_Data/` directory, which is created in the same folder as the executable after it is launched.

## Configuration, Privacy, and Security

The main features of this project run locally. Locally imported images, Tier List data, and application settings are stored locally by default.

When you use game search, cover download, or platform account linking features, the application sends network requests to the corresponding third-party services.

Third-party services may require API keys, client secrets, login tokens, or other authorization credentials. This information is stored in the local configuration directory.

## Third-Party Services

This project may communicate with third-party platforms or data sources such as Steam, PlayStation Network, Xbox, IGDB, Bangumi, VNDB, and SteamGridDB. Interactive searches aggregate the configured sources; SteamGridDB requires an API key in Search Settings, while public VNDB entry searches generally do not require an account. When using these services, you must comply with the applicable terms of service, privacy policies, API usage rules, and regional restrictions of the respective platforms.

This project is not officially affiliated with, authorized by, or endorsed by Valve, Sony, Microsoft, Twitch, IGDB, Bangumi, VNDB, SteamGridDB, or any of their affiliates. Third-party APIs, authentication procedures, and response formats may change at any time; therefore, the continued availability of the related integrations is not guaranteed.

All rights to game titles, cover images, trademarks, and other third-party content belong to their respective rights holders. Users are responsible for ensuring that their downloading, caching, exporting, and redistribution activities comply with all applicable rules.

## Acknowledgments

* The overall format and some of the interaction designs of this project were inspired by [TierMaker](https://tiermaker.com/).
* The development of the PlayStation Network-related features referenced the following projects:

  * [PlayStation-Trophies](https://github.com/andshrew/PlayStation-Trophies/)
  * [PSN-API](https://github.com/achievements-app/psn-api)
* The Xbox-related features use the [xbox-webapi-python](https://github.com/OpenXbox/xbox-webapi-python) project.
* The Nintendo play-activity feature references [Raycast Switch Game Play History](https://github.com/raycast/extensions/tree/main/extensions/switch-game-play-history) and [nintendo-go](https://github.com/wolveix/nintendo-go) .
* Thanks to [Steam](https://store.steampowered.com/), [Bangumi](https://bangumi.tv/), [IGDB](https://www.igdb.com/), [VNDB](https://vndb.org/), and [SteamGridDB](https://www.steamgriddb.com/) for providing the relevant platform services or data APIs.

## License

[MIT License](LICENSE)

Game titles, cover images, avatars, platform names, trademarks, third-party API data, and other third-party materials are not automatically licensed under the same terms merely because this project uses the MIT License. The rights to these materials remain with their respective rights holders.

## Third-Party Components Notice

Game Tier Maker uses third-party open-source components. Each component remains subject to its original license. This project's MIT License does not replace or modify any third-party license.

xbox-webapi

* Project: `xbox-webapi-python`
* Copyright: Copyright (c) 2020 OpenXbox
* License: MIT License
* Project repository: [xbox-webapi-python](https://github.com/OpenXbox/xbox-webapi-python)
* Full license text: [xbox-webapi-LICENSE.txt](xbox-webapi-LICENSE.txt)

## Translate

The English version of this README was translated with assistance from GPT
