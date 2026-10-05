# 归档原始地图库接入

继续使用固定 H5 源码、配套 proxy 与 OpenMir2。本轮从已下载的[盛大标注 1.76 升级补丁](ARCHIVED_CLIENT.md)直接读取 Tiles、Objects3、Objects4、Objects5 的原 WIL/WIX，保留原索引、调色板像素、透明色与有符号偏移。没有把它们再经公共 Crystal Lib 转换；缺少的基础图库仍使用已锁定的社区来源。

八个地图库文件的大小与 SHA-256 固定在 `shared/archived-176-client.lock.json`，下载解包程序核对这八个文件及原小地图的一对文件。[解包证据](correction/archived-map-source-extraction.json)保留 ISO、安装器、嵌入 Cabinet 与实际导出文件的校验。来源固定提供可复现字节，不能认证完整 2003 盛大客户端；该升级补丁缺少基础客户端。

## 覆盖范围

| 原图库 | WIX 帧数 | 11 图可用引用 | 256 图可用引用 | 256 图缺项 |
| --- | ---: | ---: | ---: | ---: |
| Tiles | 7,910 | 610 | 3,809 | 0 |
| Objects3 | 9,229 | 11 | 6,081 | 1 |
| Objects4 | 10,062 | 118 | 7,117 | 0 |
| Objects5 | 9,919 | 48 | 6,550 | 0 |

原 WIL 中有实际图像头的透明占位帧也按原编号导出，不沿用转换 Lib 的“空帧”分类。11 图中恢复三个 Tiles 帧，256 图另恢复 72 个 Objects4 帧；原始几何与偏移均按 WIL 校验，不要求它们与公共转换文件相同。

`tests/archived-map-assets.mjs` 直接读取原始 WIX 偏移、图像头、倒序像素与调色板，独立解码每张导出 PNG，再逐像素比较；没有调用 Python 导出器的解码结果作为预期值。[11 图检查](correction/archived-map-assets-11/evidence.json)通过 787 个原始帧、4,505,427 个 RGBA 像素。[256 图检查](correction/archived-map-assets-256/evidence.json)通过 23,557 个可用原始帧、94,932,620 个 RGBA 像素，地图引用集合和帧/空帧/缺帧分类也相符。

检查还用下一帧 WIX 偏移核对像素负载长度。上述原库采用紧凑行存储，包括宽度不是四的倍数的帧；导出没有给每行补齐四字节而错移像素。

扩展的 `tests/native-world-assets.py` 同时检查原 WIL 与剩余公共 Lib。[11 图](correction/archived-world-assets-11.json)全部 494,934 格、6,249 个可用帧、45,109,139 个 RGBA 像素通过，未解析引用为零。[256 图](correction/archived-world-assets-256.json)的 9,919,082 格、48,553 个可用帧与 210,213,260 个 RGBA 像素匹配来源，但完整资源验收仍失败，退出码 1。石墓四层依旧引用 Objects3 第 9799 帧，而原 WIX 只有 9229 帧。另核对三份已有社区种子的石墓文件，字节相同，没有找到可据以修正的同版本原地图。

## 隔离联机

[11 图隔离游戏检查](correction/archived-world-client-isolated/evidence.json)通过三职业一级、零金币注册与建角、换装、原生确认移动、桌面/手机、重登，以及仓库原入口、存入、重登取回同一物品和往返。没有离线调整角色数据。[隔离镜像与资源核对](correction/archived-world-isolated-deployment.json)验证固定网页/proxy 镜像、30 个网页文件、7,339 个资源哈希、四个原 WIL 来源和 189 帧原小地图。

[首轮画面对比](correction/archived-world-browser-first/evidence.json)前五处通过，随后拍摄东北区域时页面关闭而中断，完整检查未通过。测试已增加当前场景、入口和浏览器崩溃诊断。

[串行画面对比](correction/archived-world-browser-serial/evidence.json)完整通过八处比奇与仓库桌面/手机场景，更新前后共 2,164,598 个像素改变，无页面崩溃记录，浏览器正常退出。报告保留对应前后截图；像素变化用于定位来源更换，不替代原 WIL 逐像素核对。

256 图候选世界的[首轮区域渲染](correction/archived-world-browser-256-first/evidence.json)通过 27 处，随后新页面初始化读取 SmTiles 第 132 帧失败，地图选择器持续禁用，该整轮失败。直接复查该资源返回 HTTP 200；现有证据没有确定失败原因。增加请求失败诊断后，[剩余区域与边界检查](correction/archived-world-browser-256-remaining/evidence.json)九处通过，两份报告合计覆盖预定的 36 处。石墓画面仍记录三个未解析引用，完整资源验收仍失败。

更新原 WIL 后的[候选世界实际跨图](correction/archived-world-travel/evidence.json)三条流程全部通过，命令退出码 0：比奇/沃玛森林边界往返、原传送员 `@br` 到白日门、房屋图形名 `0123` 与逻辑存档名 `0123A` 的入内/重登/返回。沃玛森林与白日门分别收到原生小地图编号 102、103，网页加载原帧 101、102；房屋收到原失败回包并清除小地图。桌面/手机画布、源图片哈希、原生回包与存档坐标均核对，无脚本、HTTP 或请求失败，无页面崩溃记录。专用角色仅在独立 `mir2-rebuild` 的数据库离线调整三个起点，保持一级、零金币；独立引擎原生保存并正常退出后重新启动，没有改变正式库，也不证明从出生点完整走到这些区域。

## 正式部署

[部署前快照](correction/archived-world-before-deployment.json)与[部署后核对](correction/archived-world-deployment-evidence.json)确认正式入口仅重新创建网页容器以挂载更新资源，网页镜像、proxy、引擎和数据库实例保持。正式资源目录为 `.runtime/source-assets`，候选资源目录为 `.runtime/classic-world/assets`，默认准备与两个入口使用相同的原 WIL 导入规则。部署后核对 30 个 HTML/JS/CSS 文件、7,339 个资源哈希、四个原库及其索引哈希、189 帧原小地图和全部已开放原生地图。

正式入口的[第一次浏览器复验](correction/archived-world-client-production/evidence.json)在等待客户端观察接口时超时；[第二次复验](correction/archived-world-client-production-diagnostic/evidence.json)在进入世界时页面或浏览器关闭，未完成任何职业流程，均为失败。第二次没有记录脚本或请求错误；这些报告不能证明浏览器关闭的原因。

增加浏览器崩溃、断连和当前测试阶段诊断后，[进程日志检查](correction/archived-world-client-production-process/evidence.json)完成三职业与仓库全部断言，浏览器退出码为 0，但命令执行器返回 143；[原始进程日志](correction/archived-world-client-production-process/browser.log)保留这一轮的浏览器生命周期。随后通过终端重新执行的[正式完整复验](correction/archived-world-client-production-terminal/evidence.json)全部通过，命令退出码与浏览器退出码均为 0。正式角色均从一级、零金币开始，未使用离线 fixture；注册、建角、换装、原生移动确认、桌面/手机、重登存档、原仓库入口、手机存入、重登取回同一物品和跨图往返均通过，无脚本或 HTTP 资源错误。这些成功结果没有确定早期初始化失败的原因，也不构成完整 1.76 验收。

## 准备与验证

`npm run prepare:source` 现在下载核对归档升级补丁，默认准备上述四个原地图库与原始小地图；需要 7-Zip (`7z`) 和 `unshield`。其他未取得的基础图库、角色、物品和效果仍有各自的固定来源，不因本次导入而认证为原版整包。

已有基础产物时，可在独立输出目录准备并核对：

```bash
node scripts/fetch-archived-176-client.mjs
MIR_SOURCE_ASSETS=.runtime/archived-world/assets \
  node scripts/prepare-source-assets.mjs --archived-map-libraries --archived-minimaps
MIR_SOURCE_ASSETS=.runtime/archived-world/assets \
  npm run test:archived-map-assets
MIR_SOURCE_ASSETS=.runtime/archived-world/assets \
MIR_SOURCE_MAPS=.runtime/classic-profile/Map \
  python3 tests/native-world-assets.py
```

256 图仍可通过原地图导出工具准备：

```bash
python3 scripts/prepare-native-map-assets.py \
  --maps .runtime/mirserver-source/Mir200/Map \
  --libraries .runtime/wemade-mir2 \
  --output .runtime/archived-full-world/assets \
  --archived-client .runtime/original-client-research/extracted/App_Executables --all
```

该全目录导出预期因石墓缺帧返回 1，并保存完整 `native-world.json`。地图字节、连接、脚本、数据库和游戏规则不由图库导入修改；完整原包、苍月岛地图差异、8 条未安装连接、脚本/城堡错误、纯净版本数据和其余系统仍待完成，goal 保持未完成。

对已部署的固定镜像可分别复验正式流程与独立跨图；需要停止或重启独立引擎的测试必须串行执行：

```bash
MIR_URL=http://172.30.0.16:18880 \
MIR_SOURCE_REPORT=.runtime/reports/archived-world-client-production-rerun \
  node tests/source-client.mjs
MIR_TEST_FIXTURES=1 MIR_WORLD_MINIMAPS=1 \
MIR_WORLD_TRAVEL_REPORT=.runtime/reports/archived-world-travel-rerun \
  node tests/source-world-travel.mjs
npm run audit:176 -- --check
```

完整版本审计仍返回 1：正式世界 11 张图、108 条混合版本技能。上述资源与基础流程通过没有改变该结论。
