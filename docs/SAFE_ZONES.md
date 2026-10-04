# 原生安全区修正

继续使用现成 H5 源码、配套 SourceProxy 和 OpenMir2。`server/openmir2-safezone.patch` 修正原引擎的安全区查询，未增加浏览器规则或替代服务端判定。

原 `InSafeZone()` 只在地图已经带 SAFE 标志时检查出生点，普通比奇地图的 `0 289 618` 因此始终判为不安全。带坐标的重载还误读角色当前地图的 SAFE 标志，并在角色没有地图时直接跳过传入地图的检查。修正后两种查询共用同一路径：整图 SAFE、红名出生点、同地图 StartPoint，半径沿用源配置 `SafeZoneSize=10`，包含正负 10 格边界；第 11 格不受保护。地图名沿用原生地图系统的大小写不敏感规则。

参照为固定 `lzxsz/MIR2@98711dad31567d9a7e272956f6c5a2487000848b` 的 `GameOfMir/M2Server/ObjBase.pas` 两个 `InSafeZone` 方法，文件 SHA-256 `622bc35df593801fce3f028497250fbf171d0c03a5dbecafd251b69045ed6148`。该社区源码含后期修改，这次对应查询不认证完整盛大 2003 原包。

[真实镜像程序集对照](correction/source-safezone-native/evidence.json) 核对了加载 DLL 的哈希：旧正式引擎仅通过 3/8，新引擎通过 8/8。测试覆盖普通地图出生点、四边界、红名出生区、整图 SAFE、跨图坐标查询、地图名大小写、玩家实际 `IsProperTarget` 攻击限制和空地图。原生物品、状态计时和 LoginGate 返回通道的已有构建回归也通过。

这个修复恢复玩家攻击保护；没有改变野生怪物的目标规则，也没有据此声称先前死亡的仓库流程已经修好。完整世界、村庄守卫、纯净技能与装备、原版掉落等仍需继续验收。

同一实测镜像的实际地图加载器另逐格核对 256 张候选图，共 9,919,082 格，包含死亡神殿的全部 900 格及固定的 9,840 字节尾部。浏览器导出独立保留尾部原字节及哈希，默认解析继续拒绝未知的多余字节或 14 字节单元；不会通过通用尾部猜测接受不明布局。这是原生格式与碰撞核对，不等于已开放这些地图或验收全部玩法。

复现：`npm run test:source-safezone`。默认从旧正式镜像和 `mir2-source-safezone-engine:test` 提取程序集；可通过 `MIR_SAFEZONE_BEFORE_IMAGE`、`MIR_SAFEZONE_ENGINE_IMAGE` 指定镜像。测试不连接数据库，不调整账号或角色数据。

实测镜像 `sha256:e2f6a9c5fc81e10ac1eff309f7701f16bbaf90f7edf87c4bb8a74eed6297548a` 已部署正式入口；运行中 `M2Server.dll` 与实测 DLL 的 SHA-256 均为 `357ed91fc8119c1ea0fcb9edddfcf3faefc82ef66cd9e4be2571b1eaff6cd4d6`。保存、停机和备份见 [引擎更换记录](correction/source-safezone-engine-replacement.json)，数据库及存档保留见 [部署核对](correction/source-safezone-deployment-evidence.json)。[隔离三职业及仓库](correction/source-safezone-client-isolated/evidence.json) 通过实际一级、零金币注册、装备、移动、桌面/手机、重登和原仓库存取；未使用离线数据 fixture。

[正式三职业及仓库复验](correction/source-safezone-client-production/evidence.json) 同样整套通过，浏览器无异常或失败的资源响应。这次通过不改变此前角色死亡导致整套检查失败的历史记录，也不将怪物攻击规则记作已修复。
