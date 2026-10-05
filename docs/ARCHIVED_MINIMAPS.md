# 原始小地图与配套 Proxy

继续使用固定 H5 源码和其配套 proxy。网页进入地图后发送小地图请求，proxy 发送原 `CM_WANTMINIMAP`（1033），再投影原 `SM_READMINIMAP_OK/FAIL`（710/711）。原服务端返回的一基编号只减一一次。没有资料时清除上一张图，跨图前的延迟返回不覆盖新地图。地图名称使用当前已核对的目录，修正上游把 `4`、`5` 的封魔谷和苍月岛名称颠倒的问题。

从已固定的[归档升级补丁](ARCHIVED_CLIENT.md)导出 `mmap.wil`、`mmap.WIX` 的 189 帧，原编号、尺寸和有符号偏移保持。WIL SHA-256 为 `4bab9e49fb4b0c82ee0c90b264c7918e392907d46dd6fe9b3048ca47501895ee`，WIX 为 `fface5fd53c83b2bc70085b618af3908ef6a61b98e680394d3111fd8deb80eb6`。[独立像素核对](correction/archived-minimaps/evidence.json)通过 PNG 解码再与原文件的调色板和倒序行逐像素比较，全部 189 帧通过。

## 原生网页核验

[实际跨图报告](correction/source-world-minimap/evidence.json)同时记录原生回包、proxy 投影、网页帧、资源哈希和画布像素：

- 沃玛森林收到原编号 102，加载原帧 101，桌面和 390×844 手机画面通过。
- 原 NPC `@br` 传送到白日门 `47,477`，收到原编号 103，加载原帧 102。
- 房屋实际存档为 `0123A`、图形名 `0123`，收到 711，无小地图；重登和返回白日门通过。

上述角色只在独立 `mir2-rebuild` 创建，一级、零金币，离线调整起点。它不证明从出生点完整走到这些区域。[首次检查](correction/source-world-minimap-before/evidence.json)因切图时测试读取暂缺的角色状态而停止；已改为等待角色状态，原报告保留。

网页镜像 `sha256:c41ba9644303d369bdd2c152002d86f60f3c500db41c809f4934a2b3ab188cbd` 的构建通过 19 个已有魔法回归、3 个小地图异步回归、既有前端回归与 TypeScript/Vite 构建。首次跨图使用 proxy 镜像 `sha256:370ca419aa5203b4064f50f4b23190b64fc2ae50d0c07ab5fcae5fe1aeff213d`；追加下述 NPC 修复后的最终镜像为 `sha256:fe84ccf68217f12bdc3e00b8fda04912a72b4a42f4e981baebbcd93ad2bd272c`，构建再次通过既有网关回归及原编号、失败、未经请求返回和旧地图返回检查。

## 仓库与正式接入

[修复前浏览器检查](correction/source-minimap-client-before/evidence.json)通过三职业基础流程，却在关闭“找回”后重新点击保管员时失败。原生 NPC 处理晚于 TCP 发送，旧 proxy 从发送时刻计算冷却，下一次点击仍可能落在原生冷却内。`server/source-npc-receipt.patch` 改为收到原菜单 643 时延后下次点击，保留现有 1100 毫秒间隔。验收脚本另修正室内重登入图条件：比奇须等待小地图，原生没有小地图的仓库不要求图片。

[11 图独立验收](correction/source-minimap-client-acceptance/evidence.json)通过三职业注册、换装、原生确认移动、桌面/手机与重登，以及原仓库入口、重新对话、手机存入、重登取回同一物品和跨图往返，无浏览器异常或资源失败。该栈使用与正式相同的引擎镜像、独立数据库和存档卷，没有离线修改等级、金币、位置或物品。[隔离镜像核对](correction/source-minimap-isolated-deployment.json)显式断言上述最终网页与 proxy 镜像。[候选世界仓库复验](correction/source-minimap-warehouse-candidate/evidence.json)也通过。

2026-10-05 正式入口只替换网页和 proxy，继续使用既有资源目录与 11 图配置。[更新前](correction/source-minimap-before-deployment.json)及[部署核对](correction/source-minimap-deployment-evidence.json)保存完整镜像 ID，确认最终实测镜像、30 个网页文件与 7,148 个资源哈希，原生地图匹配、四项服务健康、数据库和引擎实例及启动时间保持。原网页和 proxy 镜像分别保留为 `mir2-web-web:before-minimap` 和 `mir2-web-source-proxy:before-minimap`。

[正式地址浏览器复验](correction/source-minimap-client-production/evidence.json)随后全部通过三职业一级、零金币注册与建角、换装、服务端确认移动、桌面/手机画布及重登持久化，仓库入口、手机存入、重登取回同一物品与跨图往返。没有离线修改正式角色；浏览器无异常、资源请求失败或手机横向溢出。已实际查看桌面与手机截图。该结果仅覆盖已声明的基础流程，完整原版验收仍未通过。

## 范围与缺项

189 帧原始图库当前仅用于 18883 隔离候选；正式 18880 已接入原生小地图请求，但保持 11 图范围和既有比奇一帧素材，没有导入完整图库。升级补丁不是完整 2003 原客户端，不能认证全部资源与规则。牛魔寺庙大厅 `D2079` 在当前种子中请求原编号 190，而补丁仅有帧 0–188，该图小地图仍缺项。未给它复制或猜测其他帧。

[上游 Python 全套检查](correction/source-minimap-python/evidence.json)执行 92 项，6 个失败、8 个错误，包括该隔离源码检查目录缺少上游运行库、原始 UI 导出与规范化商人文件，以及内容、技能契约和任务检查失败。没有将这些检查标为通过，也不以小地图或基础联机通过替代完整原版验收。完整世界的 8 条连接、脚本、城堡和其他素材缺项仍见[世界核验](WORLD_REVIEW.md)。

## 复现

```bash
node scripts/fetch-archived-176-client.mjs
npm run assets:archived-minimaps
npm run test:archived-minimaps
docker build -f server/SourceClient/Dockerfile -t mir2-minimap-web:test .
docker build -f server/SourceProxy/Dockerfile -t mir2-minimap-proxy:test .
docker compose -p mir2-rebuild -f compose.yaml -f compose.rebuild.yaml -f compose.world-review.yaml up -d --no-deps --no-build --wait web source-proxy
MIR_TEST_FIXTURES=1 MIR_WORLD_MINIMAPS=1 npm run test:source-world-travel
```

准备基础资源时可给 `prepare-source-assets.mjs` 传入 `--archived-minimaps`，使用已下载的固定原文件覆盖小地图导出。默认准备继续使用比奇一帧，原始库导入必须显式选择。
