# 传奇 · 青石镇 / Mir2 Web

基于 [Suprcode/Crystal](https://github.com/Suprcode/Crystal) 服务端的可联机网页游戏初版，使用 Docker Compose 部署。浏览器客户端通过 WebSocket 网关接入 Crystal 原生 TCP 协议；移动、碰撞、战斗、经验、掉落、装备和存档由原服务端处理。

当前包含一张自带的青石镇地图、战士/法师/道士角色创建、基础近战、怪物、金币与物品拾取、背包、装备、药水、聊天、死亡复活和持久化存档。网页采用可分发的替代像素素材，不包含原版商业游戏资源。技能、NPC 商店、任务、行会和攻沙尚未移植到网页客户端。

![桌面游戏](docs/desktop.png)

桌面与手机截图、实际 Docker 验证记录见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

## 启动

需要 Git、Docker Engine 和 Docker Compose v2，无需在宿主机安装 .NET 或 Node.js。

```bash
git clone --recurse-submodules https://github.com/celery0903/mir2-web.git
cd mir2-web
docker compose up -d --build --wait
```

打开 **http://localhost:18880**，注册账号并创建角色。首次启动自动生成游戏数据库和地图，账号与角色保存到 Docker 数据卷 `mir2-web-data`。

已克隆仓库但遗漏子模块时，运行：

```bash
git submodule update --init --recursive
```

默认仅绑定宿主机 `127.0.0.1`。修改端口或用于局域网测试：

```bash
MIR_BIND=0.0.0.0 MIR_PORT=18881 docker compose up -d --wait
```

HTTP 网页和 WebSocket 使用同一个端口。游戏 TCP 端口和内部注册接口只在容器网络内开放。

## 操作

- 点击地图移动，点击怪物靠近并持续攻击；方向键或 WASD 也可移动。
- 攻击、拾取、药水、背包和聊天按钮位于底栏。空格攻击，E 拾取，1/2 使用药水。
- 点击背包中的装备穿戴，点击已穿戴装备卸下；点击药水使用。
- 手机提供方向按钮，点击地图同样可移动。
- 战士、法师、道士使用原服务端各自的基础属性；本版网页只支持基础近战。

## 数据与更新

```bash
docker compose ps
docker compose logs -f
docker compose down
docker compose up -d --build --wait
```

`docker compose down` 保留数据卷。不要给它添加 `-v`，除非有意删除存档。停止服务时会通过 Crystal 的关闭流程保存账号和角色；Compose 预留 30 秒关闭时间。

青石镇数据库只在空数据卷上初始化。`shared/world.json` 同时供浏览器渲染和服务端地图生成使用；修改起始内容后需要使用新的测试数据卷，例如：

```bash
MIR_DATA_VOLUME=mir2-web-new-world MIR_PORT=18881 docker compose -p mir2-new-world up -d --build --wait
```

当前账号文件沿用 Crystal 的保存方式，包括其传统密码存储方式。本版适合本地或受控测试；正式公开运营前需要改造账号安全、配置 HTTPS 并进行容量测试。

## 验证

先启动 Compose，再安装测试工具：

```bash
npm ci
npx playwright install chromium
npm run test:protocol
npm test
docker compose stop game web
docker compose up -d --wait
npm run test:persistence
```

协议测试连接真实 Crystal 服务，验证账号注册、并发连接、双人互相可见、移动同步、聊天、装备、战斗、经验与掉落拾取，以及上游默认 GM 密码拒绝和无效请求隔离。浏览器测试覆盖桌面和手机流程，并检查 canvas 非空、资源加载、页面异常和布局边界。重启测试验证账号、角色、位置、金币、经验、等级和装备。

测试会创建独立账号；随机测试凭据只保存于被 Git 忽略的 `.state/`。注册接口每个来源 IP 限制 5 次/小时，频繁重跑测试时可重启 `web` 容器重置测试限流。

## 代码结构

```text
web/                     TypeScript + Phaser 浏览器客户端
server/MirHost/          Crystal 无界面启动、起始数据、内部注册 API
server/WebGateway/      HTTP、WebSocket、原协议编解码、请求限制
upstream/crystal/       固定提交的上游 Git 子模块，未修改
shared/world.json       渲染与碰撞共用的地图定义
scripts/build-world.mjs 地图生成工具
tests/                  真实服务协议、浏览器和重启存档测试
```

服务端与网关运行在不同进程，因为 Crystal 的协议解析器使用进程级 `Packet.IsServer` 标志。网关直接复用上游 C# 数据包定义，无需维护另一套二进制协议解析器。

上游固定提交：`0e315fe327192afe52c3d7357ddd1f5b7e26c5b8`。代码与素材来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
