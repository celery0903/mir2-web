# 热血传奇 Web / OpenMir2

**当前是尚未完成的传统中文 1.76 移植。** 原客户端位图、坐标、账号与角色界面已接入，完整世界、版本数据和其余系统仍未补齐。已核实的偏差、修正范围和实测结果见 [交付纠正](docs/176_CORRECTION.md)；生产数据审计见 [版本审计](docs/version-audit.json)。

默认部署已经改用现成的 [leiniaozl229/mir2](https://github.com/leiniaozl229/mir2/tree/77e3ff7506b1ca55cac15df247cb2fcedd69c535) H5 源码及其配套 proxy。源码固定为 Git 子模块；接入补丁保存在 `server/source-client.patch`、`server/source-proxy.patch`，上游检出保持干净。地图差异、适配范围及实测结果见 [源码加 Proxy 核查](docs/SOURCE_PROXY_EVALUATION.md)。

运行链路为 Pixi H5 客户端 → 同源 Nginx → 原项目的 .NET 10 WebSocket/TCP proxy → [OpenMir2](https://github.com/mirbeta/OpenMir2) 原生服务端 → MySQL。账号、角色、碰撞、战斗、经验、物品、装备、技能、NPC 和存档由原生服务端处理。此前的 Phaser 客户端及自写网关保留在 `web/`、`server/WebGateway/`，用于核对历史修正和测试；默认部署不构建它们。

当前经典配置包含比奇省与十张店铺室内地图、44 个原始出入口，浏览器与服务端逐格碰撞一致。新入口已核验三职业注册建角、装备、移动和重连；联机、战斗、物品和技能接口复用现成源码，其余流程仍需重新进行浏览器验收。一级、零金币开始，使用一倍经验；历史七级技能验收使用单独标注的测试数据。

这不是经过认证的完整原版 1.76 整包。沙巴克、其他野外与洞穴、交易、组队、行会、任务和更多技能尚未完成网页验收。边界仓库已接通原生存取，校验结果见纠正报告。服务端种子包含混合版本内容，实际开放范围经过过滤。来源、固定版本、许可证和已知边界见 [调研报告](docs/SOURCE_RESEARCH.md) 与 [第三方说明](THIRD_PARTY_NOTICES.md)。

## 启动

需要 Git、Docker Compose v2、Node.js、Python 3 和 curl。准备随机数据库密码、空账号初始化 SQL、锁定资源及匹配的地图：

```bash
git clone --recurse-submodules https://github.com/celery0903/mir2-web.git
cd mir2-web
npm ci
npm run prepare:source -- --allow-missing-references
docker compose up -d --build --wait
```

浏览器打开 **http://localhost:18880/**，根路径直接进入游戏。默认绑定 `0.0.0.0`，也可设置 `MIR_BIND=127.0.0.1` 或 `MIR_PORT=18883`。网页与 WebSocket 使用同一端口，proxy、原生 TCP 和数据库保持私网访问。资源由锁文件校验；无需安装宿主机 .NET。其他域名通过 `MIR_SOURCE_ORIGINS` 设置精确的逗号分隔 Origin 列表。

`--allow-missing-references` 仅允许启动已明确标为未完成的当前版本：源地图仍有 19 个越界 SmTiles 引用，输出 `integration.json` 中的资源验收保持 `failed`。省略该选项时资源准备会拒绝这些缺项。该选项不改变完整 1.76 验收结果，也不启用候选的 570 张混合版本地图。

账号使用 3 至 10 位字母数字，密码使用 5 至 10 位字母数字，角色名最多 14 个 GBK 字节。上游账号库沿用传统密码存储。

## 操作

- 左键行走/攻击，右键跑步；方向键或 WASD 移动，Shift+方向跑步，空格攻击。
- 点击地面物品拾取，Alt+左键挖取尸体。鹿肉需要连续挖取。
- F9 开关背包，F10 独立开关人物窗；背包双击使用或装备，人物窗点击装备卸下。数字 1–6 使用对应的快捷格。
- 点击 NPC 对话，商店选中后确认或双击购买；出售和修理时点选背包物品或拖入圆形物品槽，显示报价后点击原确认按钮。点击槽内物品可取消选择。F11 技能面板可以绑定 F1 至 F8，Enter 输入聊天。
- 边界仓库在比奇 `307,627` 入口。通过保管员的“保管”“找回”进行存取，物品操作等待原生服务端确认。
- 手机整体等比适配，可点按地图和控件。重新登录后角色存档保留。

## 验证

现成客户端的浏览器验收覆盖三职业注册与建角、换装、服务器确认的移动、桌面/手机画布、重连存档、仓库入口与存取，以及 Origin 拒绝。账号保存在被忽略的 `.state/`，报告和截图保存在 `.runtime/reports/source-client/`。在独立 Compose 项目运行：

```bash
npm ci
npx playwright install chromium
MIR_PORT=18883 docker compose -p mir2-acceptance up -d --build --wait
MIR_URL=http://127.0.0.1:18883 npm test
MIR_URL=http://127.0.0.1:18883 npm run test:source-services
MIR_URL=http://127.0.0.1:18883 npm run test:source-login
npm run audit:176 -- --check
```

`test:source-services` 创建独立一级、零金币账号，通过真实网页出售初始蜡烛、验证商品成色页及金币不足拒绝，并用正常战斗产生木剑耐久损耗，再到铁匠铺修理。地图行走使用现成寻路库按实际碰撞格规划短路段，通过 Shift+小地图点选执行；服务端确认物品和金币变化。截图和报告默认写入 `.runtime/reports/source-services/`。`MIR_SOURCE_SCOPE=warehouse npm test` 创建独立账号，只验收战士基础流程和仓库存取。

`test:source-login` 主动断开 50 个登录连接，每轮随后核对原生登录拒绝响应，检查 LoginGate 返回通道是否仍可工作。引擎镜像还直接编译上游返回通道代码，回归已释放 socket 和连接重置不会中断其他客户端的响应。

`npm run verify:deployment` 校验正式入口的 HTML、JS、CSS 与运行中镜像的哈希、容器健康和数据库/引擎实例是否保持；首次记录没有可比较快照时会明确标为未证明实例保持。

需要更新引擎时，验证命令必须通过 `MIR_EXPECTED_ENGINE_IMAGE=sha256:...` 指定已实测镜像的完整 ID；核对该镜像、原数据库实例和原引擎存档卷后才接受更换。报告分别记录实例更换和存档卷保留。

此前原型的联机、技能、仓库和重启证据保留在 [历史测试报告](docs/VERIFICATION.md) 和 [交付纠正](docs/176_CORRECTION.md)。`test:prototype`、`test:protocol`、`test:features`、`test:restart` 等历史脚本使用旧协议，不能直接用于新的默认入口，也不能将历史结果视为现成客户端的验收。

`compose.rebuild.yaml` 与主 Compose 合并使用时提供固定的独立验收配置。正式 Compose 只公开网页端口。

`docker compose down` 保留账号和引擎卷；`down -v` 会删除存档。引擎退出前等待数据库保存确认，并保留 45 秒停机宽限期以完成原生网关排空。更新地图配置时只替换受版本管理的世界配置，账号和角色保留。

## 结构

```text
upstream/mir2-client/    固定提交的现成 Pixi 客户端与配套 proxy
server/SourceClient/    客户端构建、同源资源及 WebSocket 转发
server/SourceProxy/     原项目 proxy 的构建和运行
server/source-*.patch   可审查的素材、跨图、原服务窗口及镜像构建回归补丁
web/, server/WebGateway/  历史自写原型及网关
server/Engine/          六个 OpenMir2 服务的 Docker 启动与保存监督
server/openmir2-linux.patch  可审查的上游兼容与存档修复
upstream/openmir2/      固定提交的 MIT 子模块
shared/                 素材、服务端种子锁文件和经典经验表
scripts/                下载校验、数据准备、地图转换与碰撞审计
tests/                  原生联机、浏览器、技能与重启存档验收
.runtime/source-assets/ 当前源地图、界面与动画的资源适配产物
```
