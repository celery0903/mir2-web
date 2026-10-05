# 归档苍月岛地图接入

继续使用固定的 Pixi H5 源码、配套 proxy 与 OpenMir2。此次把[盛大标注的归档升级补丁](ARCHIVED_CLIENT.md)中的整个 `map/5.map` 接到 256 图候选世界，不手改地图单元、入口坐标或任务规则。该补丁来自 2004 年合辑，来源锁定不等于认证完整 2003 盛大原版客户端。

## 来源与差异

`shared/archived-176-client.lock.json` 固定原地图文件的大小和 SHA-256；社区种子锁保留原记录，实际准备时附加 `previousSource`，同时记录原安装器哈希。

| 来源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| 归档 `map/5.map` | 7,680,052 | `7cb06f4ad1300ed93cea6745d4991c853eea7bb00f3668f5360a48f7ccd7897a` |
| 社区种子 `5.map` | 7,680,052 | `43b7344cce5caea49c09f909a3ad36ea7e30af701fd1a0c7be27a263d772b895` |

[全图独立核对](correction/cangyue-map-data/evidence.json)检查服务端整文件和浏览器全部 640,000 个单元。两来源有 304 个单元、480 个单元字节和 5 个头部字节不同；单元差异都在服装店附近 `x=125–156, y=323–348`。没有只替换碰撞位而保留另一来源的图像引用。

| 原地图变化 | 坐标 |
| --- | --- |
| 新增可通行 | `148,327`、`148,328`、`149,328`、`149,329` |
| 新增阻挡 | `150,328`、`150,329`、`151,329` |

苍月岛相关 33 条源连接的端点碰撞与门标记均保持。[实际镜像检查](correction/cangyue-native-profile/evidence.json)核对 256 图与本地准备文件，再加载镜像中的实际 DLL，逐一验证全部 9,919,082 格原生碰撞。1,298 条声明仍只有 1,290 条安装成功；8 条源阻挡格连接继续保留失败，不移动坐标强行开放。

默认 11 图准备不包含苍月岛。[默认保留检查](correction/cangyue-default-preservation/evidence.json)证明 Map、Envir 和经验配置的 23 个文件字节保持；旧目录的 `audit.json` 不同且缺少 `profile.version`，因此整体目录比较没有通过，报告保留这两项元数据差异。

## 素材验证

全目录重新导出后，原 Objects4 可用引用由 7,117 增至 7,119。[原 WIL 独立解码检查](correction/cangyue-archived-map-assets/evidence.json)核对 23,559 个帧和 94,935,692 个 RGBA 像素，保持原尺寸、偏移、透明色与索引。[完整素材检查](correction/cangyue-world-assets.json)核对 9,919,082 个单元、48,555 个可用帧和 210,216,332 个 RGBA 像素，全部与实际地图及来源匹配；完整资源验收仍因 `WemadeObjects3:9799` 缺项失败，导出和该检查退出码均为 1。

部署核验现按 `graphicID` 解析物理文件并去重，保留 `0123A` 到 `0123.map` 的原别名关系。256 个逻辑地图对应 255 个物理文件；同时核对归档地图、原安装器与旧来源哈希。角色位置检查增加 `MIR_WORLD_SCOPE=all`，按原逻辑存档名分配到对应物理地图；报告列出检查范围外的记录，不修改角色。

## 候选部署

候选入口为 <http://172.30.0.16:18883/>，镜像为 `sha256:126259c18c539f8d6a59553ef6719077c3e4f4eb01064ebd72100c957fbe09c1`，原生程序集保持。[更换记录](correction/cangyue-install.json)和[停机日志](correction/cangyue-shutdown.log)确认原生保存、正常退出、数据库及存档卷保持。旧镜像保留为 `mir2-pre-cangyue-engine:test`，旧资源与配置保留在 `.runtime/classic-world/*-before-cangyue`；SQL 和配置备份留在被忽略的运行目录。

[保存后坐标检查](correction/cangyue-positions-after-save.json)核对 212 个已存地图坐标，没有新增阻挡位置，其中没有旧角色位于苍月岛。另有一个地图为空、等级为零的未初始化建角记录，单独列为未检查，没有删除或调整它。

第一次替换目录后，Compose 保留原网页容器，绑定挂载仍指向重命名的旧目录。[资源身份检查失败](correction/cangyue-candidate-mount-failure.json)返回 1；同阶段的[浏览器报告](correction/cangyue-browser-old-mount/evidence.json)虽然旧断言返回 0，但实际仍读旧素材，不作为新地图通过。随后强制重建候选网页容器，并给画面检查增加已服务地图清单与本地产物相等的断言。

[最终部署核对](correction/cangyue-candidate-deployment.json)返回 0：30 个网页文件、52,829 个资源哈希、48,555 个地图 PNG，以及全部逻辑地图到物理文件的关系匹配。完整资源状态仍明确为 failed。[更换前画面](correction/cangyue-browser-before/evidence.json)与[更换后检查](correction/cangyue-browser-after/evidence.json)覆盖服装店周边和室内的桌面、手机，非空、无溢出或资源异常。两处周边的前后全页截图共 669,067 个像素改变，见[对比记录](correction/cangyue-browser-comparison.json)；该比较不替代原地图和 WIL 像素身份检查。

正式 <http://172.30.0.16:18880/> 仍为 11 图。[正式资源核对](correction/cangyue-production-preservation.json)返回 0，30 个网页文件和 7,339 个资源哈希保持；[联机检查后的实例快照](correction/cangyue-final-preservation.json)再次确认正式四个实例、镜像和启动时间均保持，候选数据库与 proxy 也保持。

## 真实联机

[四条真实流程](correction/cangyue-world-travel/evidence.json)全部通过，命令退出码 0：比奇/沃玛森林边界往返、原 NPC 到白日门、房屋别名的入内/重登/返回，以及苍月岛服装店流程。所有流程继续通过现成源码与配套 proxy，由原生服务端结算；没有新增网关或客户端模拟服务。

苍月角色实际走过三个新增可通行格；网页发出从 `149,328` 到 `150,328` 的移动请求，收到同 actionId 的 `accepted:false`、`reason:28`，位置回到 `149,328`。再绕行原入口进入 `B353 8,21`，重登后返回 `5 146,324`，原生存档坐标相符。原生小地图编号为 161，网页加载原帧 160，核对 PNG 哈希、尺寸与画布像素。桌面、手机和服装店截图已实际查看，没有脚本、HTTP、请求失败或页面崩溃记录。

fixture 仅在独立库将四个新角色移到原连接附近的起点，保持一级、零金币；原生保存并正常退出后才调整。该范围不证明从出生点完整走到这些地区，也不证明服装店商品、全部怪物、任务或掉落。完整版本审计仍返回 1：正式 11 图、108 条混合版本技能。[命令结果记录](correction/cangyue-checks.json)区分原始失败、修正后通过及仍失败的完整验收。

## 复现

```bash
node scripts/fetch-archived-176-client.mjs
node scripts/prepare-classic-world.mjs \
  .runtime/mirserver-source .runtime/classic .runtime/classic-world/profile --all
python3 scripts/prepare-native-map-assets.py \
  --maps .runtime/classic-world/profile/Map --libraries .runtime/wemade-mir2 \
  --output .runtime/classic-world/assets \
  --archived-client .runtime/original-client-research/extracted/App_Executables --all
MIR_SOURCE_MAPS=.runtime/classic-world/profile/Map \
MIR_SOURCE_ASSETS=.runtime/classic-world/assets \
  python3 tests/native-world-assets.py
MIR_SOURCE_ASSETS=.runtime/classic-world/assets node tests/archived-map-assets.mjs
node tests/archived-cangyue.mjs
node --test tests/native-map.test.mjs tests/classic-world-profile.test.mjs
```

全目录导出和完整素材检查预期返回 1，并保留缺帧证据。10 项准备回归通过，包括修改归档地图时拒绝准备、不回退到社区种子。`MIR_ARCHIVED_CLIENT` 可指定已解包的原文件目录。

```bash
MIR_TEST_FIXTURES=1 MIR_WORLD_MINIMAPS=1 MIR_WORLD_CANGYUE=1 \
  node tests/source-world-travel.mjs
```

跨图检查只允许 localhost 的独立 `mir2-rebuild`，会新建专用一级、零金币角色，停止引擎并仅离线调整测试起点，随后正常启动。须与其他需要重启或调整独立库的流程串行执行。完整原包、纯净版本数据、完整连接及其余玩法仍待验收，goal 未完成。
