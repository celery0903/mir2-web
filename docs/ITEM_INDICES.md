# 原生物品编号保留

日期：2026-10-05。继续使用固定的 `leiniaozl229/mir2@77e3ff7506b1ca55cac15df247cb2fcedd69c535` Pixi H5 源码、同项目 proxy 和 OpenMir2。此次修复原生物品加载器，为后续 2003 年盛大 1.76 物品整理保留存档编号；完整版本验收仍未通过。

## 问题与修正

原 `GameSrv.DB.MySqlDB.LoadItemsDB()` 使用未排序的 `SELECT * FROM stditems`，逐行追加到列表；原生 `GameItemSystem` 的查找和创建使用一基列表位置。现有连续的 1,000 行种子恰好能正常对应，删除中间行或改变数据库物理顺序后，原来的装备编号会指向其他物品。加载器还在每行后立即把结果设为成功，后续转换异常可能留下半份定义并报告成功。

[`server/openmir2-items.patch`](../server/openmir2-items.patch) 在 Docker 构建时应用到固定上游源码。查询按 SQL ID 排序，缺失位置用名称、引用均为空字符串的 `StdItem` 占位，保留 SQL ID 与原生 `UserItem.Index` 的对应。已有 `GetStdItem` 对空名返回空，查名和按名创建越过空位；不会把缺失定义映射为另一件物品。

编号限于原生无符号 16 位的 `1..65535`。零、负数、越界和重复 ID 拒绝整个列表；只有完整读取并初始化日志选项后才返回成功，异常和空表均清空加载结果并返回失败。补丁不改变物品属性、图片编号、价格、掉落、角色存档或客户端/proxy 协议。

保留空位只是迁移的前置条件。后续清理还必须核对已装备、背包、仓库、商店、NPC 和掉落引用，不能直接删除仍被使用的定义，也不能把来源不明的同名数值作为原版导入。

## 原生检查

[`tests/source-items.mjs`](../tests/source-items.mjs) 从指定 Docker 镜像提取实际 DLL，并核对测试中加载的四个程序集 SHA-256。使用与正式服务相同的 MySQL 8.4 镜像、固定原生物品模式及空角色模式，在专用内部网络中建库；不会连接正式或候选数据库。测试结束后移除 MySQL 容器、卷及网络。

[真实镜像对照](correction/source-item-index-native/evidence.json)：旧正式镜像 `2/14`，修复镜像 `14/14`。覆盖全部连续编号、删除前部和中间定义后保留所有字段、真实装备/背包/仓库记录的编号与耐久、倒序物理存储、重复加载、65535 边界、非法及重复 ID、合法行后的转换异常、空表和失败后恢复。旧镜像确实出现“已删除 ID 1 解析为另一物品”和“旧木剑实例改变身份”，失败结果保留在同一报告。

```bash
docker build -f server/Engine/Dockerfile -t mir2-items-engine:test .
npm run test:source-items
```

需要先运行 `npm run prepare:source` 准备空角色模式。通过 `MIR_ITEMS_BEFORE_IMAGE`、`MIR_ITEMS_ENGINE_IMAGE` 和 `MIR_ITEMS_REPORT` 指定对照镜像及报告目录。`--before-only` 只复现旧问题，其报告 `passed=false`，不能当作修复验收。镜像构建中的原生物品、状态计时、安全区、登录返回通道与脚本回归也通过。

## 物品来源

网上取得的两个 Paradox 候选已按固定提交和 Git blob 核对；尚未整表导入：

- `mrzhqiang/mirserver-1.76@39e17246a32247a2c43c4cc481e97e88c692fa53`，`mud2/db/StdItems.DB`，468 行，Git blob `b3c2aab7e94d71c3eb34453971574cf9b1fd9632`，SHA-256 `10bf3e9fe4676475b9828a7e1d450dada0c76a724b0a20477f5b77f937a9fb8f`。包含雷霆装备和修改的数值。
- `pangliang/MirServer-Delphi@f829679d24acb3a097d396d737ab067db2c88ca2`，`MirServer/Mud2/DB/StdItems.DB`，345 行、61,440 字节，Git blob `c74a9d31630e755f325d4dabbf5608663dfaf591`，SHA-256 `b074960349a8bcb8f0e742e36df26d323f60f9707752e3e0856c30012e8e0f36`。包含普通黑铁头盔；与现有服务的编号不同，不能直接替换。

第二个候选的固定下载地址为 <https://raw.githubusercontent.com/pangliang/MirServer-Delphi/f829679d24acb3a097d396d737ab067db2c88ca2/MirServer/Mud2/DB/StdItems.DB>。读取使用 `pypxlib==2.5` 的 Paradox 解析器和 `gb18030` 编码。两份鹤嘴锄均为等级 11、攻击 0-8，而下载的 17173 旧武器页面为等级 11、攻击 0-9，当前服务为等级 15、攻击 0-8。该网页包含现代侧栏及页脚，并非认证的 2003 快照；这些冲突尚未作为数值迁移依据。

两份候选的普通黑铁头盔都是防御 4-5、魔御 2-3、攻击 0-0；当前库 **ID 344 已有普通黑铁头盔**，上述攻防值也相同，但当前要求为攻击力 46，其余字段仍需整表比较。此前只检查头盔分段，误写为“没有普通定义”；它实际位于首饰分段，ID 196/197 的天之和极品版本是另两条定义。本次更正不修改数据库，也不猜测改名或重用编号。完整物品范围、数值与脚本/掉落引用审计仍需继续。

## 候选环境

[候选引擎更新](correction/source-item-index-candidate/evidence.json) 使用 `sha256:b3b31b159a65be6bd957fe86177483b1421549d0da6346db32d9f72d64243749`，其中四个相关 DLL 与上述实测镜像逐一匹配，运行文件也按哈希核对。停机前原生保存与正常退出确认，全部物品、技能和角色存档哈希保持一致，256 张地图配置保持。

[首轮浏览器检查](correction/source-item-index-client-candidate-failure/evidence.json) 的三职业一级、零金币注册、穿戴、移动、桌面/手机和重登通过，但银杏村 `650,628` 出生角色直接点击边界仓库后在 `646,627` 被障碍阻挡，整套结果失败。验收脚本现复用已有 `pathfinding` 库，按服务端对应碰撞数据规划直线短段，通过 Shift+小地图实际点击行走并等待原生回包。

[同角色长途继续](correction/source-item-index-candidate-journey-failure/evidence.json) 实际走至 `486,562`，随后被野外怪物击杀，依然失败。这不是物品编号加载失败，但完整世界的长途路线验收未通过，两份失败报告和截图保留。

后续[仓库继续验证](correction/source-item-index-warehouse-candidate/evidence.json) 只将同一专用候选角色离线位置设置为 `0/289,618`。原生保存确认后修改一行坐标，经原生重登后，从边界村通过网页进仓、拖选取消、手机存入、重登取回同一实例和往返人物可见均通过；装备、金币、等级及生命值不由 fixture 修改。这只验收仓库与物品引用，不接受之前失败的银杏长途路线。

`MIR_SOURCE_RESUME_REPORT` 支持继续同一服务器、同一专用角色的仓库检查，报告独立标为 `warehouse-continuation` 并保留前次部分结果。离线位置 fixture 另要求 `MIR_SOURCE_WAREHOUSE_FIXTURE=1`、`MIR_TEST_FIXTURES=1`、`MIR_PROJECT=mir2-rebuild` 和 `http://127.0.0.1:18883`；只匹配已有专用测试角色，拒绝正式环境。继续流程依赖 `.state/source-client-0.json` 的对应测试账号，因此在该账号文件被下一次注册替换前运行。

## 正式入口

[正式引擎更新](correction/source-item-index-production/evidence.json) 已部署 `sha256:7ded311cd94e070ce8cc35c48c1b6d2e90d3eba6586472a242064c68f4d15837`。原生保存完成、正常退出后保留服务器文件及 SQL 备份，数据库备份权限为 600；本地路径及哈希在报告中。重启前后的全部物品、技能、角色、装备、背包、仓库、物品属性和已学技能表哈希一致，地图配置仍为 11 张。引擎容器更换，存档卷保留，数据库、网页及 proxy 的实例、镜像和启动时间保持。

运行中的 `GameSrv.dll` SHA-256 为 `1b6c017369a742d6ebeeb72a3b5bb9b2b14affeb5e659b6b60534dab03ddbc79`，其余三个相关程序集与原镜像一致；四个运行文件都匹配实际 DLL 检查。网页及 proxy 仍为原固定 H5 源码链路，物品数据未执行删除、改名或数值迁移。

[更新前快照](correction/source-item-index-before-deployment.json) 和[更新后核对](correction/source-item-index-deployment-evidence.json) 包含 30 个网页文件及 7,339 个资源响应哈希、原生/浏览器地图对应、四项服务健康和已实测镜像匹配。核对确认原数据库实例及引擎存档卷保留。

[正式浏览器回归](correction/source-item-index-client-production/evidence.json) 全部通过：三职业正常一级、零金币注册建角、穿戴木剑/布衣、移动、桌面/手机和重登保持位置装备；从原生出生位置通过网页实际行走进仓，拖选取消、手机存入、重登取回同一物品及往返本人可见。正式流程没有使用离线坐标、等级、物品或生命值 fixture，无浏览器异常、资源错误或手机横向溢出。

完整 `npm run audit:176 -- --check` 仍返回 1：正式 11 图、33 项经典技能身份、范围外技能 0，原版数值仍未认证。此次只完成物品编号加载修复及对应回归，纯净物品、掉落/NPC 与完整 2003 客户端等要求仍未完成，goal 保持 active。
