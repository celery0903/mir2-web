# 经典世界接入进度

继续使用 `leiniaozl229/mir2@77e3ff7506b1ca55cac15df247cb2fcedd69c535` 的 Pixi H5 客户端及配套 proxy，连接 OpenMir2。地图导入和渲染改动通过原项目的工具与 `server/source-client.patch` 接入。

## 地图来源与范围

`shared/classic-world-catalog.json` 明确选择 256 张候选地图，包括比奇、沃玛森林、毒蛇山谷、盟重、封魔谷、苍月岛、白日门及主要经典洞穴和室内地图。最初 249 图之外，现补上六件新衣服的六处隐藏地图和桃源之门。没有整包启用社区种子中的后期地图。

社区来源固定为 `mirbeta/MirServer@f38deae64c521a28f8e0d86f2bf24d4ba7c9ea5c`。审计从固定提交的 Git tree 读取原始 blob 编号，再核对本地 MapInfo、MonGen 和全部地图字节；修改过的源声明或未验证的报告会被拒绝。原文件的大小、SHA-256、Git blob、文件名和图形别名固定在 `shared/native-world.lock.json`。候选苍月岛现使用另锁定的归档整个地图，保留两来源哈希，见[苍月岛接入](ARCHIVED_CANGYUE.md)。

256 张图均以原始 52 字节头、每格 12 字节读取，未改写地图单元。死亡神殿另有固定的 9,840 字节尾部；实际引擎核对其全部 900 格并忽略尾部，浏览器导出仍独立保留原尾部与哈希。其他图继续要求精确长度，不能通过尾部猜测接受未知的 14 字节格式。28 个文件使用小写文件名；`0123A|0123` 保留独立地图 ID，使用同一源图；石墓阵的空格分隔坐标也按原生解析规则识别。

[完整审计](classic-world-audit.json) 记录 1,298 条目录内部连接、源地图标志、刷怪名称及外部连接。仍有 6 条非门格连接位于阻挡格；保留原声明，没有猜测或修改坐标。图边的可达性不包含 NPC 传送，不能用它判定封魔谷、苍月岛或白日门不可进入。

## 图库与缺项

11 个 WemadeMir2 地图库按大小和 SHA-256 固定。`lzxsz/MIR2@98711dad31567d9a7e272956f6c5a2487000848b` 的 `MShare.pas` 声明 `g_WObjectArr[0..14]`，`GetObjs` 和 `GetObjsEx` 都将越界库号回退到 0。规则及源文件哈希见 `shared/classic-map-library-rules.json`，仅应用于原始 classic-12 图；其他转换图仍保留其库编号。

[逐单元及逐像素检查](correction/source-classic-world-assets.json) 核对 9,823,182 个单元、48,229 个可用帧、209,498,940 个 RGBA 像素与偏移。全目录资源验收仍为 **failed**：石墓四层 `D714` 的 `(395,199)`、`(397,203)`、`(398,170)`、`(398,203)` 引用 `WemadeObjects3` 第 9799 帧，而固定库只有 9229 帧。保留缺项，没有将它标为空帧或替换图像。严格导出和检查返回退出码 1，并写出完整报告。

这些社区地图、公共转换图库和含后期代码的客户端参照提供可复现的来源与规则，仍不足以认证完整的盛大 2003 原包。

## 浏览器与联机检查

现成地图校验页 `/index.html` 增加了地图选择器，坐标上限跟随所选地图变化；根路径仍进入现成游戏客户端。渲染器跳过原导出工具已识别的 `0x7f00` 特殊图像标记，按地图清单路由前景库。

[36 处区域和边界画面](correction/source-classic-world-browser/evidence.json) 与 [10 张店铺室内画面](correction/source-classic-world-rooms-browser/evidence.json) 通过桌面、390×844 手机、非空像素、资源响应与横向溢出检查。石墓四层的选定视野确认仍有 3 个未解析引用，检查没有把已知缺项计作资源完整。地图选择器使用的候选目录不等于服务端已经开放全部地图。

[三职业与原仓库隔离联机](correction/source-classic-world-client-isolated/evidence.json) 通过一级、零金币注册建角、换装、原生移动确认、重登及存取同一物品。沿用原 proxy 和引擎，未使用离线数据 fixture。

首次手机检查发现校验页沿用了固定 800px 的游戏容器，[失败记录](correction/source-classic-world-mobile-before/evidence.json) 与截图保留；修复为该页单独的响应式尺寸。首次仓库检查还停在旧测试对 `Room0140Objects2/3` 的硬编码断言，[失败记录](correction/source-classic-world-warehouse-before/evidence.json) 保留。测试现按声明的 WemadeMir2 命名空间核对原地图哈希与 Objects2/3 路由，后续实际存取流程通过。

## 正式开放范围

`defaultMapIDs` 仍限定为现有比奇和十张店铺，统一使用原始地图与 WemadeMir2 图库。引擎地图字节、碰撞和 44 条现有入口不变，其余候选图未正式开放。

[现有 11 图的资源检查](correction/source-classic-interiors-assets.json) 通过 494,934 个单元、6,246 帧、45,109,136 个 RGBA 像素，未解析引用为零。完整世界的 NPC、刷怪外观、原传送及任务条件、掉落与纯净版本数据仍需接入和验收。完整 1.76 goal 保持未完成。

正式入口已部署相同的实测网页镜像 `sha256:b15558772eff8b8da396e44ffb7b4dbcbdc90b5370aa4430ee7eac60ab354615`。[部署核对](correction/source-classic-world-deployment-evidence.json) 验证 30 个网页文件、7,146 个资源响应、全部 6,246 个地图 PNG、地图目录与原生地图哈希。数据库、引擎及 proxy 实例、书店脚本保持；旧网页镜像与资源目录保留。

正式环境的 [三职业及仓库整套检查](correction/source-classic-interiors-production-death/evidence.json) **未通过**：三职业注册、装备、移动、重登及桌面/手机均通过，随后复用的战士在出生区域已死亡，仓库行走停止。原始失败报告和画面保留，不能将这次整套检查记为通过。出生点沿用源文件中的 `0 289 618` 三列声明；当前村庄保护和刷怪行为仍需核对，未为通过测试猜测范围或调整正式角色数据。

随后用独立新账号完成的 [正式仓库单独复验](correction/source-classic-interiors-warehouse-production/evidence.json) 通过一级、零金币注册、装备、原生移动、重登、原入口、手机存入、重登取回同一物品及往返后本人可见。这个单独流程未使用离线 fixture，也不改变此前整套检查失败的结论。

正式游戏入口为 <http://172.30.0.16:18880/>。隔离栈的 <http://172.30.0.16:18883/index.html> 现保留 256 图校验目录，服务端仍只开放现有 11 图；不能把目录中的图形预览当作完整联机世界。完整 `audit:176 --check` 仍返回 1，生产技能表仍有 108 条混合版本记录。

## 复现

先准备固定服务端种子、WemadeMir2 库和上述 Pascal 检出，再运行：

```bash
npm run audit:classic-world
npm run test:classic-world
python3 scripts/prepare-native-map-assets.py \
  --maps .runtime/mirserver-source/Mir200/Map \
  --libraries .runtime/wemade-mir2 \
  --output .runtime/classic-world/assets --all
MIR_SOURCE_ASSETS=.runtime/classic-world/assets \
MIR_SOURCE_MAPS=.runtime/mirserver-source/Mir200/Map \
MIR_NATIVE_WORLD_REPORT=.runtime/reports/classic-world-assets.json \
  python3 tests/native-world-assets.py
```

当前全目录的后两条命令预期返回 1，原因是上述缺帧。`npm run prepare:source` 继续只准备正式的 11 图范围。

## 新衣服区域与原生安全区

候选目录补上 `R001` 桃源之门、`T232` 钳虫巢穴、`T218` 死亡神殿、`T339` 地狱烈焰、`T219` 深渊魔域、`T315` 堕落坟场、`T140` 困惑殿堂。保留 NEEDHOLE、NORECONNECT、NORANDOMMOVE、原入口和原刷怪名称；不以图形预览替代暗之怪物、装备掉落和获取流程验收。

[新增区域画面](correction/source-armour-world-browser/evidence.json) 的七处桌面和手机检查通过，零未解析引用、资源响应错误或横向溢出。已实际查看死亡神殿手机截图。[全目录像素核对](correction/source-armour-world-assets.json) 覆盖 9,919,082 格、48,473 个可用帧、210,222,396 个 RGBA 像素；仍因石墓四层 `WemadeObjects3:9799` 缺项返回 1，完整资源验收保持失败。

另通过真实 OpenMir2 DLL 核对这 256 张原地图的全部碰撞格。死亡神殿完整源文件为 20,692 字节，前 10,852 字节是 30×30 地图；固定 Git blob 的尾部仅以该图声明的精确长度接受，导出原样另存并核对哈希，未删除源文件字节或放宽其他地图的格式限制。

原生安全区查询按固定传统源码修正，[镜像对照](correction/source-safezone-native/evidence.json) 为旧引擎 3/8、新引擎 8/8。[隔离联机](correction/source-safezone-client-isolated/evidence.json) 通过三职业与仓库存取整套流程。该修复针对玩家攻击保护，没有改变野生怪物规则，详见 [安全区范围](SAFE_ZONES.md)。

正式入口已仅更换引擎为 `sha256:e2f6a9c5fc81e10ac1eff309f7701f16bbaf90f7edf87c4bb8a74eed6297548a`。[停机记录](correction/source-safezone-engine-replacement.json) 确认原生保存与正常退出，原服务文件已备份；[部署核对](correction/source-safezone-deployment-evidence.json) 确认数据库、proxy、存档卷和书店保留，网页及 7,146 个资源哈希一致。正式世界仍为原有 11 图，候选图未整包开放，108 条混合版本技能与完整世界数据仍待整改，goal 未完成。

[本轮正式三职业及仓库](correction/source-safezone-client-production/evidence.json) 整套通过；之前因角色死亡失败的报告保留，不据此将野生怪物的攻击规则标为已修复。

隔离栈合并当前已验证的角色、UI、物品和特效资源，根路径仍可进入 11 图游戏，地图校验页提供 256 图目录。[合并后根入口复验](correction/source-armour-preview-client/evidence.json) 通过新建战士、装备、桌面/手机、移动、重登及仓库存取，没有离线 fixture；候选地图的整包资源验收仍明确为 failed。

## 后续原生联机

隔离入口现已进一步加载 256 图的真实原生配置，并通过比奇/沃玛森林往返、原 NPC 到白日门、房屋别名的入内/重登/返回。配置来源、8 条未安装连接、脚本操作码修复、fixture 范围及保持失败的服务验收见 [隔离世界核验](WORLD_REVIEW.md)。正式 18880 仍为 11 图；上述较早的 11 图隔离记录保留为历史证据。

网上找到并解包了 2004 光盘中的盛大标注 1.76 升级补丁。它的 39 图暴露苍月岛和候选目录差异，不能视为完整原客户端；来源、实际文件和图库抽样核对见 [归档补丁](ARCHIVED_CLIENT.md)。完整 2003 盛大原版 goal 继续保持未完成。

归档苍月岛现已在 256 图候选世界使用；全单元、实际碰撞、素材像素和部署文件的核对，以及保持失败的石墓缺帧和连接验收，见[本轮地图证据](ARCHIVED_CANGYUE.md)。正式范围仍为 11 图。
