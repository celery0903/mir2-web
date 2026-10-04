# 热血传奇 Web / OpenMir2

**当前是尚未完成的传统中文 1.76 移植。** 原客户端位图、坐标、账号与角色界面已接入，完整世界、版本数据和其余系统仍未补齐。已核实的偏差、修正范围和实测结果见 [交付纠正](docs/176_CORRECTION.md)；生产数据审计见 [版本审计](docs/version-audit.json)。

用户提出复用现成源码加 proxy 后，已停止扩大自写网页客户端，转向现成 H5 的独立接入验证。候选原网关未经修改已通过注册、登录、建角、背包读取和移动检查；网页渲染与完整系统仍在验证，正式入口尚未切换。地图差异与接入证据见 [源码加 Proxy 核查](docs/SOURCE_PROXY_EVALUATION.md)。

采用 [OpenMir2](https://github.com/mirbeta/OpenMir2) 原生服务端、MySQL 和 TypeScript/Phaser 浏览器客户端。账号、角色、碰撞、战斗、经验、物品、装备、技能、NPC 和存档由原生服务端处理，WebSocket 网关转换传统协议。

当前经典配置包含比奇省与十张店铺室内地图、44 个原始出入口，浏览器与服务端逐格碰撞一致。支持战士、法师、道士、多人移动和聊天、近战、掉落拾取、挖肉、药水、背包装备、NPC 买卖、买书学习，以及火球术和治愈术显示。一级、零金币开始，使用一倍经验；七级技能验收使用单独标注的测试数据。

这不是经过认证的完整原版 1.76 整包。沙巴克、其他野外与洞穴、交易、组队、行会、任务和更多技能尚未完成网页验收。边界仓库已接通原生存取，校验结果见纠正报告。服务端种子包含混合版本内容，实际开放范围经过过滤。来源、固定版本、许可证和已知边界见 [调研报告](docs/SOURCE_RESEARCH.md) 与 [第三方说明](THIRD_PARTY_NOTICES.md)。

## 启动

需要 Git 和 Docker Compose v2。先准备随机数据库密码与去除上游测试账号的初始化 SQL：

```bash
git clone --recurse-submodules https://github.com/celery0903/mir2-web.git
cd mir2-web
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/src" -w /src node:22-bookworm-slim node scripts/prepare-openmir2.mjs
docker compose up -d --build --wait
```

浏览器打开 **http://localhost:18880/**。默认绑定 `0.0.0.0`，也可设置 `MIR_BIND=127.0.0.1` 或 `MIR_PORT=18883`。网页与 WebSocket 使用同一端口，原生 TCP 和数据库端口不对宿主机开放。构建会下载并逐项校验锁文件里的资源；无需安装宿主机 .NET。

账号使用 3 至 10 位字母数字，密码使用 5 至 10 位字母数字，角色名最多 14 个 GBK 字节。上游账号库沿用传统密码存储。

## 操作

- 左键行走/攻击，右键跑步；方向键或 WASD 移动，Shift+方向跑步，空格攻击。
- E 拾取，H 挖取附近尸体；也可使用底栏按钮。鹿肉需要连续挖取。
- F9/B 开关背包，F10 独立开关人物窗；背包双击或选择后点击“使用”，人物窗点击穿戴装备卸下。数字 1–6 使用对应的快捷格。
- 点击 NPC 对话，商店选中后确认或双击购买；出售界面双击背包物品或点击快捷格出售。F11 技能面板可以绑定 F1 至 F8，Enter 输入聊天。
- 边界仓库在比奇 `307,627` 入口。保管界面选择背包物品或拖到保管框，再确认存入；找回目录选择后确认或双击取回。
- 手机可点击地图、方向控制与底栏操作。退出后返回登录，角色存档保留。

## 验证

实测结果和截图见 [测试报告](docs/VERIFICATION.md)。在独立 Compose 项目运行测试，避免修改玩家存档：

```bash
npm ci
npx playwright install chromium
MIR_PORT=18883 docker compose -p mir2-acceptance up -d --build --wait
MIR_URL=http://127.0.0.1:18883 npm run test:protocol
MIR_URL=http://127.0.0.1:18883 npm test
MIR_URL=http://127.0.0.1:18883 MIR_TEST_FIXTURES=1 MIR_COMPOSE_PROJECT=mir2-acceptance npm run test:features
MIR_URL=http://127.0.0.1:18883 MIR_BROWSER_FEATURES=1 MIR_COMPOSE_PROJECT=mir2-acceptance npx playwright test tests/browser/features.spec.ts
MIR_URL=http://127.0.0.1:18883 MIR_HEALING_VISUAL=1 npx playwright test tests/browser/healing.spec.ts
MIR_URL=http://127.0.0.1:18883 MIR_TEST_FIXTURES=1 MIR_COMPOSE_PROJECT=mir2-acceptance npm run test:restart
```

技能测试只把已创建的 `qa` 角色离线调整到七级和 20000 金币，随后实际买卖、进出书店、买书学习和施法。浏览器技能验收先清除这些测试角色的已学技能，再通过网页买书、使用和施法。不会注入技能或物品。重启验收包含在线未退出的移动保存和数据库重启。测试账号及即时存档预期保存在被 Git 忽略的 `.state/`。注册限流为每 IP 每小时 10 次，反复重跑时可重启测试项目的 `web` 服务。

`compose.rebuild.yaml` 提供固定的独立验收端口。在该测试栈运行协议测试时，设置 `MIR_NATIVE_LOGIN_PORT=17700` 可包含异常 TCP 分包回归；设置 `MIR_COMPOSE_PROJECT=mir2-rebuild` 可核对注册资料在账号数据库的实际值。此数据库检查只允许专用测试项目。`MIR_FIXTURES_FILE=.state/final-protocol-fixtures.json` 可保留已有技能验收角色的预期文件。正式 Compose 不开放原生 TCP 端口。

`docker compose down` 保留账号和引擎卷；`down -v` 会删除存档。引擎退出前等待数据库保存确认，并保留 45 秒停机宽限期以完成原生网关排空。更新地图配置时只替换受版本管理的世界配置，账号和角色保留。

## 结构

```text
web/                     TypeScript + Phaser 原生浏览器客户端
server/WebGateway/      HTTP、WebSocket 与传统协议适配
server/Engine/          六个 OpenMir2 服务的 Docker 启动与保存监督
server/openmir2-linux.patch  可审查的上游兼容与存档修复
upstream/openmir2/      固定提交的 MIT 子模块
shared/                 素材、服务端种子锁文件和经典经验表
scripts/                下载校验、数据准备、地图转换与碰撞审计
tests/                  原生联机、浏览器、技能与重启存档验收
```
