# Game Tier Maker

Python 3.13

[简体中文](README.md)|[ENGLISH](README(en).md)

Game Tier Maker 是一个在本地运行的游戏 Tier List 制作工具

您可以使用搜索功能搜索游戏封面等其他内容，或配置 Steam、PlayStation Network、Xbox 和 Nintendo 等平台的授权信息后，读取对应账号的游戏库。

您可以将本地的图片导入到程序中

Nintendo 账号使用游玩记录导入：在设置中打开 Nintendo 登录页，登录后将地址栏中的 `npf...://auth` 回调链接粘贴回程序，再预览并选择要导入的游戏。Nintendo 的游玩记录接口属于未公开接口，记录可能延迟，当前集成以真实账号联调结果为准；绑定说明和开发契约见 [NINTENDO_IMPORT_DEV.md](aimd/NINTENDO_IMPORT_DEV.md)。

程序可以新建多个排序模板，右键等级行可以更改颜色，双击可以改名
<img width="1573" height="1013" alt="image" src="https://github.com/user-attachments/assets/58bbc950-6918-4c82-9c9e-028d371b753e" />
<img width="1571" height="992" alt="image" src="https://github.com/user-attachments/assets/a247ae21-bab6-4458-bd23-2310d4f4ae77" />



## 从源码运行

克隆仓库：

```powershell
git clone https://github.com/QuliKnight/glst.git
cd glst
```

创建虚拟环境并安装依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r .\requirements.txt
```

启动程序：

```powershell
.\.venv\Scripts\python.exe .\main.py
```

访问 http://localhost:8000 查看应用

## Windows exe

先安装构建依赖：

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\requirements-build.txt
```

在项目根目录执行：

```powershell
.\.venv\Scripts\python.exe -m PyInstaller --clean --noconfirm .\GameTierMaker.spec
```
exe存放目录:

```powershell
.\dist\GameTierMaker.exe
```
双击启动

exe不会继续使用源目录中的配置，而是使用启动exe后在同一文件夹中生成的 `GameTierMaker_Data/`。

## 配置、隐私与安全

本项目的主要功能在本地运行。本地导入的图片、Tier List 数据和应用配置默认保存在本地。
使用游戏搜索、封面下载或平台账号绑定功能时，程序会向对应的第三方服务发送网络请求。

第三方服务需要 API Key、Client Secret、登录令牌或其他授权信息,这些内容保存在本地配置目录中。

## 第三方服务说明

项目可能与 Steam、PlayStation Network、Xbox、IGDB、Bangumi、VNDB、SteamGridDB 等第三方平台或数据源进行通信。搜索会按已配置情况汇总多个来源；SteamGridDB 需要在“搜索功能设置”中填写 API Key，VNDB 的公开条目搜索通常不需要账号。使用相关服务时，需要遵守对应平台的服务条款、隐私政策、API 使用规则和地区限制。

本项目与 Valve、Sony、Microsoft、Twitch、IGDB、Bangumi、VNDB、SteamGridDB 及其关联公司不存在官方隶属、授权或背书关系。第三方接口、认证流程和返回结构可能随时发生变化，因此相关集成不保证永久可用。

游戏名称、封面、商标和其他第三方内容的权利归各自权利人所有。使用者应自行确认其下载、缓存、导出和再分发行为符合适用规则。

## 致谢

- 本项目的产品形式和部分交互设计受到 [TierMaker](https://tiermaker.com/) 的启发。
- PlayStation Network 相关功能的开发参考了：
  - [PlayStation-Trophies](https://github.com/andshrew/PlayStation-Trophies/)
  - [PSN-API](https://github.com/achievements-app/psn-api)
- Xbox 相关功能使用了此项目[xbox-webapi-python](https://github.com/OpenXbox/xbox-webapi-python)。
- Nintendo 游玩记录功能的授权流程和接口研究参考了 [Raycast Switch Game Play History](https://github.com/raycast/extensions/tree/main/extensions/switch-game-play-history) 以及 [nintendo-go](https://github.com/wolveix/nintendo-go)。
- 感谢 [Steam](https://store.steampowered.com/)、[Bangumi](https://bangumi.tv/)、[IGDB](https://www.igdb.com/)、[VNDB](https://vndb.org/) 和 [SteamGridDB](https://www.steamgriddb.com/) 提供相关平台服务或数据接口。

## 许可证

[MIT License](LICENSE) 

游戏名称、封面、头像、平台名称、商标以及第三方 API 数据等不因本项目采用 MIT License 而自动获得相同授权，其权利仍归各自权利人所有。

## 第三方组件声明

Game Tier Maker 使用了第三方开源组件。各组件仍分别适用其原始许可证，本项目的 MIT 许可证不会替代或修改这些第三方许可证。

 xbox-webapi
- 项目：`xbox-webapi-python`
- 版权所有：Copyright (c) 2020 OpenXbox
- 许可证：MIT License
- 项目地址：[xbox-webapi-python](https://github.com/OpenXbox/xbox-webapi-python)
- 完整许可证：[xbox-webapi-LICENSE.txt](xbox-webapi-LICENSE.txt)
