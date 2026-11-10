# SCP:SL 大二维码管理器

给 Remote Admin 管理员使用的本机证据工作台。它能从截图或摄像头画面中读取 `REQUEST AUTH` 大码，并分别核验中央签名与进服认证时效。

## 运行

使用 GitHub Container Registry 上的镜像部署。将 [compose.ghcr.yaml](compose.ghcr.yaml) 保存到部署目录，然后运行以下命令。

```sh
docker compose -f compose.ghcr.yaml up -d
```

镜像分别为 `ghcr.io/fxdyj/scpsl-auth-qr-manager:latest`（Nginx / 前端）和 `ghcr.io/fxdyj/scpsl-auth-qr-manager-php:latest`（PHP-FPM），支持 Linux amd64 和 arm64。可用 `QR_IMAGE_TAG` 为两个服务指定相同的发布标签。

如需从源码构建，在本目录运行以下命令。

```sh
docker compose up -d --build
```

打开 [http://localhost:8784/](http://localhost:8784/)。默认只监听本机，可用 `QR_PORT` 修改端口。手机或其他电脑访问时，通过 HTTPS 反向代理访问，并在代理层设置管理员访问限制。需要将容器入口交给同机反代时可以保留默认的回环绑定。PHP-FPM 只在 Compose 内网提供 FastCGI，`signing-keys` 卷只存放公开签名公钥。

开发时可直接使用 Node.js 22+ 和带 OpenSSL 的 PHP 8.4。

```sh
npm ci
npm run build
php -S localhost:8784 -t public
```

改动前端后重跑 `npm run build`，它会构建扫码 Worker，并按本次内容生成 Service Worker 缓存版本。Nginx 的站点配置见 `nginx.conf`。

运行 `npm test` 检查令牌原文验签、篡改检测、内置公钥的信任链和认证时效边界。

## 管理员操作

- 选择文件、拖入截图或用 Ctrl+V / ⌘V 粘贴图片。每批支持最多 12 张，每张最多 20 MB。也可以切换到 **JSON**，粘贴原始扫码结果。
- 手机使用 **摄像头扫码**，允许摄像头权限后把大码完整放入画面。扫码成功、关闭取景框或切离页面时会停止摄像头。
- 在 **核验报告** 查看完整字段、核验依据和原始数据。支持重新验签、切换 UTC、记备注及导出脱敏 JSON。导出包含核验状态、时间、会话编号和指纹，去掉昵称、账号、IP、序列号、备注与签名原文。
- 查询成功后自动保存到当前浏览器，最多保留 80 条。同一令牌合并并累计查询次数。历史可按昵称、账号、序列号、来源、备注或指纹搜索，也可按签名状态筛选、单独删除或清空。记录含完整令牌，适合使用独立的管理员浏览器配置。

## 离线安装

首次通过 HTTPS 或 localhost 打开页面，等顶部显示 **可离线使用**。可以用 **安装应用** 或浏览器的添加到主屏幕功能，安装后断网重开也可以扫码、验签、搜索历史和导出。手机浏览器清理站点数据会移除离线资源和本机历史，下次需要重新准备。

## 核验口径

- 图片、摄像头画面、令牌与备注始终在浏览器处理。联网请求只同步公开的签名公钥，PHP 与浏览器都用游戏内置 Northwood 根公钥检查更新。支持的官方公钥接口目前对应游戏主版本 14。
- 浏览器使用 Web Crypto，以 P-521 / SHA-256 验证原始 Base64 `token`。内置公钥快照与此前同步的可信公钥离线可用。所有可用公钥都无法匹配时，结果显示为「签名未匹配」，可能需要获取签发时使用的公钥。
- 进服时效根据设备时钟及版本、用途、测试标记、签发和过期时间独立检查。游戏服仍会校验实时的连接挑战值、玩家编号和密钥。时效过期的历史证据也可以通过签名验证。
- 根公钥来自游戏程序集的 `CentralServerKeyCache`。内置公钥快照来自 [Northwood 官方公钥接口](https://sbg1.scpslgame.com/v5/publickey.php?major=14)。扫码组件为 [ZXing WASM](https://github.com/Sec-ant/zxing-wasm)，构建时将 WASM 和许可证复制到同源目录。
