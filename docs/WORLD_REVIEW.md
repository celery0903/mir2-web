# 原生世界隔离核验

继续使用固定的现成 H5 源码、配套 SourceProxy 和 OpenMir2。正式入口 <http://172.30.0.16:18880/> 保持 11 图范围；<http://172.30.0.16:18883/> 是未通过整包验收的候选世界。完整 2003 盛大原版 1.76 goal 未完成。[脚本修复阶段的正式入口核对](correction/source-world-production-preservation.json) 验证 30 个网页文件与 7,146 个资源哈希，并与隔离更换前记录比较正式四个实例。后续网页和 proxy 小地图接入见[原始小地图](ARCHIVED_MINIMAPS.md)。

## 原生配置

`prepare-classic-world.mjs --all` 从固定 `mirbeta/MirServer@f38deae64c521a28f8e0d86f2bf24d4ba7c9ea5c` 准备 256 图。新增服务锁核验 373 个原 Git blob，保留地图别名、源标志、逗号和空格两种入口坐标、2,439 条刷怪、106 条商人声明、3 个固定 NPC、8 个出生点、49 个守卫及 264 个脚本和掉落依赖。保留 `D401` 的 `CHECKQUEST(Q001)` 依赖，但没有将其私服防挂机条件认证为原版规则。

`Npc_Def` 到原生加载器 `Npc_def` 的大小写适配记录在审计中的 `scriptPaths`；源文本不变。AutoLogin、Robot、QFunction 和 QManage 全局脚本保持空白，避免从种子启用其假人、月卡和自动升级流程。其余候选脚本仍有 85 项待核对记录，包含目录外传送与版本内容，不应直接开放为原版服务。

候选镜像默认拒绝启动，独立 `compose.world-review.yaml` 才显式设置 `MIR_WORLD_CANDIDATE=1`。配置版本由实际文件哈希生成。默认准备仍为 11 图与 44 条连接，Map、Envir 与此前默认产物逐文件一致。

## 连接与脚本

[实际镜像核对](correction/source-world-profile/evidence.json) 验证镜像内 533 个世界文件与本地准备产物一致，再使用镜像实际 DLL 加载原配置。256 图均加载，1,298 条声明中仅 1,290 条写入原生地图单元，**全连接验收 failed**。8 条缺失及原因在报告中保留，未移动坐标或删除声明。

传统 `lzxsz/MIR2@98711dad31567d9a7e272956f6c5a2487000848b` 的 `GameOfMir/M2Server/Envir.pas` 中，`AddMapRoute` 调用 `AddToMap`，后者也要求 `chFlag = 0`。文件 SHA-256 为 `1849b8e295fac0e6fd04abe4516ab51510d3e114d6b23f7bff0db48223e31fe3`。因此没有凭门格标记强行给阻挡格安装入口。该社区参照不认证盛大原服务端。

[原生脚本镜像对照](correction/source-world-script/evidence.json) 复现旧 DLL 把原 `MAPMOVE 11 47 477` 解析成 `EXEACTION`。修正使用枚举实际值，移除条件和动作的减一偏移；连续注册动作依次执行，`BREAK` 立即终止。原生回归核验原坐标、操作码、连续动作和终止行为，旧镜像失败、新镜像通过。已有物品、状态、安全区与登录返回通道构建回归同时通过。

实测隔离镜像为 `sha256:eca5adce35d1711702785c7e933a8167181253ceb426d9e404c5732079f20ad3`；ScriptSystem.dll SHA-256 为 `6d91b8af4881f9fdf1c464112172395ce50c7027374d4ea74d5aff10270479c0`。M2Server.dll 保持 `357ed91fc8119c1ea0fcb9edddfcf3faefc82ef66cd9e4be2571b1eaff6cd4d6`。

## 实际跨图

[网页跨图检查](correction/source-world-travel/evidence.json) 通过比奇与沃玛森林往返、原传送员 `@br` 到白日门，以及白日门房屋入内、重登和返回。后者实际存档地图为 `0123A`，原协议发送图形名 `0123`，共享文件的别名关系保持。检查核对原生回包、角色坐标、存档、桌面和 390×844 手机画布像素及资源响应；已实际查看手机与房屋截图。

该测试只在 `mir2-rebuild` 新建一级、零金币角色，离线调整三处起点，再通过网页键盘和 NPC 对话跨图。没有调整技能、物品、怪物、传送坐标或 NPC 脚本；**不证明从出生点完整走到这些区域**，也不证明各区域小地图、怪物外观、完整任务和掉落。这份历史截图中的小地图仍显示资料缺失；后续[原小地图核验](ARCHIVED_MINIMAPS.md)已覆盖沃玛森林和白日门，房屋按原生失败回包处理。

[修复前失败](correction/source-world-travel-before/evidence.json) 保留：边界往返已通过，NPC 选项获原生许可后没有传送。更早的[首次建角检查](correction/source-world-travel-first/evidence.json)因测试名被输入框截断、第二个名字重复而停止。后续缩短测试名。

[隔离更换记录](correction/source-world-review-install.json) 确认原生保存和正常退出、复用引擎存档卷，并核对正式四个服务及独立数据库、网页、proxy 实例保持。配置备份保留在 `.runtime/reports/world-review-install/backup` 和 `world-review-install-linux/backup`。

隔离启动仍记录 84 条候选脚本解析错误及 3 条城堡门墙数据失败；大小写修正后缺失 NPC 脚本由 3 条降到 0。它们没有因健康检查或三条跨图通过而转为服务验收通过。完整资源仍因石墓四层 `WemadeObjects3:9799` 缺项失败。

## 历史数据

[技能只读审计](classic-skill-data-audit.json) 比较实际运行库与固定 Paradox 候选：33 个 ID、名称和职业一致，33 个技能均有数值差异，另有 75 条技能、169 条其他技能书。尚未导入候选数值或清理正式库。原生学习按书名查技能；物品引用使用一基列表位置，直接删除不连续条目会移位存档引用。

[归档光盘核对](ARCHIVED_CLIENT.md) 已找到并解包一份盛大标注的 1.76 升级补丁；39 图与部分 WIL/WIX 可供后续独立核对，**仍不是原始完整客户端**。初次抽样时，公共转换图库的选取帧与该补丁像素不一致，不能把当时的转换素材认证为原版。

后续[原地图库接入](ARCHIVED_MAP_ASSETS.md)已用该补丁的 Tiles、Objects3/4/5 原 WIL 替换这四个公共转换库，并导入 189 帧原小地图。11 图和 256 图的全部可用导出帧均核对来源，正式 11 图三职业及仓库复验通过。其余基础库仍有公共来源，全目录仍缺石墓四层第 9799 帧；原包与完整版本认证没有因此通过。

[更新图库后的真实跨图](correction/archived-world-travel/evidence.json)再次通过上述三条原生流程，并核对原始沃玛森林、白日门小地图与房屋的失败回包。fixture 范围仍仅是独立新角色的三个起点，版本和候选服务验收仍未通过。

## 复现

已有固定种子、原始地图与候选导出素材时：

```bash
node scripts/prepare-classic-world.mjs .runtime/mirserver-source .runtime/classic .runtime/classic-world/profile --all
npm run test:world-profile
docker build -f server/Engine/Dockerfile --build-arg MIR_WORLD_SCOPE=all -t mir2-world-review-engine:test .
npm run test:source-world-profile
npm run test:source-script
docker build -f server/SourceClient/Dockerfile -t mir2-minimap-web:test .
docker build -f server/SourceProxy/Dockerfile -t mir2-minimap-proxy:test .
docker compose -p mir2-rebuild -f compose.yaml -f compose.rebuild.yaml -f compose.world-review.yaml up -d --no-build --wait
MIR_TEST_FIXTURES=1 npm run test:source-world-travel
```

最后一项仅允许 localhost 的独立 `mir2-rebuild`，会正常停止和重启独立引擎，必须与其他调整隔离数据的测试串行运行。正式世界迁移仍待原数据、素材、连接、服务和其余玩法验收。
