# 经典技能范围整理

日期：2026-10-05。继续使用固定的 `leiniaozl229/mir2@77e3ff7506b1ca55cac15df247cb2fcedd69c535` H5 源码、同项目 proxy 和 OpenMir2。本轮只整理原生数据库的技能范围，完整盛大 2003 年 1.76 验收仍未通过。

## 范围与来源

[`shared/classic-skills.json`](../shared/classic-skills.json) 固定 33 个 `MagID / MagName / Job` 组合：战士 6 个、法师 14 个、道士 13 个。按这三个字段精确匹配保留行，移除现有 108 项中范围外的 75 项；不是按 SQL 行号截取。保留行的伤害、耗蓝、修炼等级、熟练度门槛、延迟和效果参数全部保留现值。

这份范围与固定 `mrzhqiang/mirserver-1.76@39e17246a32247a2c43c4cc481e97e88c692fa53` 的前 33 项名称、职业一致，也与 17173 三职业旧页面标题对应。“基本剑术 / 基础剑术”和“群体治疗术 / 群体治愈术”按明确别名核对。原 HTML、SHA-256 和 DOM 提取结果保存在[参考核对](correction/classic-skills-references/evidence.json)，网络和页面脚本在解析时禁用。页面包含现代侧栏及页脚，不是经过认证的 2003 年快照。

两个社区技能表都拒绝整表导入：上述候选有 78 项；`pangliang/MirServer-Delphi@f829679d24acb3a097d396d737ab067db2c88ca2` 的 `MirServer/Mud2/DB/Magic.DB` 有 244 项，包含英雄、内功和重复技能 ID。两者的经典 33 行各自都有数值与现有服务不同，详见[逐字段比较](correction/classic-skills-numbers.json)。雷电术三级修炼等级有 23 与 24 两种记录；17173 火球说明为 4 MP，而当前原生零级流程实际扣 2 MP。本轮没有据此修改数值或把候选表认证为原版。

## 迁移与存档

[`scripts/migrate-classic-skills.mjs`](../scripts/migrate-classic-skills.mjs) 默认只生成预检报告。执行迁移时，先停止引擎并等待原生保存完成、正常退出，再重新读取存档并备份 `magics`。SQL 使用 InnoDB 事务和 CHECK 守卫；经典 ID 缺项、名称或职业冲突、重复 ID、非事务表，以及已学范围外技能均拒绝执行。NULL 范围外定义明确移除。

引擎加载技能按 `MagID` 查找。物品则按读取列表的一基位置引用，不宜直接删行或重排。本轮不修改 `stditems`，核对全部 1,000 条物品定义，以及装备、背包、仓库、物品属性和已学技能记录的哈希。守卫拒绝时事务回滚；已经提交的迁移不会因后续启动失败自动恢复技能表，原表 SQL 备份保留在报告注明的本地路径。

新的空数据库初始化会按 `00..02` 原始模式及种子、`03-classic-skills.sql` 依次执行。已有数据库卷不会自动重跑初始化，需执行迁移脚本。脚本重启同一引擎容器并核对镜像、数据库实例和存档卷，随后要求原生日志确认加载 33 项。

## 实测范围

[真实 MySQL 检查](correction/classic-skills-sql/evidence.json) 使用与正式库相同的 MySQL 8.4 镜像和固定原生模式，11 项全部通过：新库初始化、保留所有技能字段及物品/已学技能引用、幂等执行、缺项、错名、错职业、重复与冲突 ID、范围外已学技能、NULL 定义和非事务表拒绝。测试数据库与卷在结束后移除。

[候选迁移](correction/classic-skills-candidate/evidence.json) 已确认 `108 -> 33`，原生保存完成并正常退出，全部保留行和上述存档哈希一致，原生日志确认加载 33 项。候选仍为 256 图，正式地图范围另行核对。

首轮[行走失败](correction/classic-skills-route-failure/evidence.json) 已通过买书和学习，但未装备的 30 HP 法师在行走中被稻草人击杀，尚未进入施法阶段。原截图及失败报告保留。测试现在给两个专用账号离线固定边界村起点，经网页装备初始木剑、布衣，并提前检测行走死亡；没有修改服务端出生点、怪物或正式账号。

后续[候选火球](correction/classic-skills-fireball/evidence.json) 通过网页买书、学习、双方蓄力、弹道、命中和动作结束，原生 MP `65 -> 63`、伤害 4。桌面/手机画布非空，无溢出、浏览器异常或资源错误。账号离线设为七级、20,000 金币，MP 由原生上限夹取；真实目标未移动，不能作为移动目标追踪验收，也不证明完整地图画面或其他技能。

[候选魔法盾](correction/classic-skills-shield/evidence.json) 通过买书、学习、双方原生 `0x00100000` 状态位、三帧循环、移动附着、手机施放和自然到期，原生 MP `496 -> 461`，实际到期 5.307 秒。测试离线设置 31 级和买书金币，并临时加入一件书店测试库存；结束后已恢复原书店文件，SHA-256 一致。这个 fixture 没有验证尸王掉落获取、受击或完整数值还原。

## 正式入口

01:49 UTC 在 <http://172.30.0.16:18880/> 执行[正式迁移](correction/classic-skills-production/evidence.json)。原生保存完成、正常退出后才备份和修改技能表；`108 -> 33`，保留行的全部字段、1,000 条物品定义及已有技能/物品记录哈希一致。引擎以同容器、同镜像重启，数据库实例、存档卷保留。备份位置及哈希保存在迁移报告中。

[更新前快照](correction/classic-skills-before-deployment.json) 与[更新后核对](correction/classic-skills-deployment-evidence.json) 分别保留：30 个网页文件、7,339 个资源响应哈希匹配，11 张原生地图与浏览器资源一致，四项服务 healthy。引擎的启动时间发生变化，部署报告中 `preservedEngine=false` 表示进程连续性变化；迁移报告另确认容器 ID、镜像 ID 和存档卷全部相同。网页与 proxy 镜像、实例、启动时间保持。

实际引擎镜像为 `sha256:e2f6a9c5fc81e10ac1eff309f7701f16bbaf90f7edf87c4bb8a74eed6297548a`，网页为 `sha256:c41ba9644303d369bdd2c152002d86f60f3c500db41c809f4934a2b3ab188cbd`，proxy 为 `sha256:fe84ccf68217f12bdc3e00b8fda04912a72b4a42f4e981baebbcd93ad2bd272c`。这次没有构建或替换客户端、proxy、引擎镜像。

01:49 UTC 开始的[正式浏览器回归](correction/classic-skills-client-production/evidence.json) 全部通过：三职业正常一级、零金币注册建角，经网页穿戴初始装备、原生确认移动、桌面/手机和重登保持位置装备；原仓库跨图、空目录、拖入取消、手机存入、重登取回同一物品及往返后本人可见。无浏览器异常、资源错误或手机横向溢出，正式测试未使用离线等级、金币、坐标或技能 fixture。

## 复现

```bash
npm run test:classic-skills-sql
MIR_SKILL_GUIDES=docs/correction/classic-skills-references/references npm run test:classic-skill-references
npm run migrate:classic-skills
MIR_PROJECT=mir2-rebuild MIR_APPLY_CLASSIC_SKILLS=1 npm run migrate:classic-skills -- --apply
MIR_TEST_FIXTURES=1 MIR_PROJECT=mir2-rebuild MIR_URL=http://127.0.0.1:18883 node tests/source-skills.mjs
PYTHONPATH=.runtime/paradox-reader python3 scripts/audit-classic-skill-numbers.py
```

Paradox 审计依赖 `pypxlib==2.5`，读取固定哈希的本地候选文件，不连接运行数据库；第二张候选表的固定下载地址为 `https://raw.githubusercontent.com/pangliang/MirServer-Delphi/f829679d24acb3a097d396d737ab067db2c88ca2/MirServer/Mud2/DB/Magic.DB`，SHA-256 为 `7eb49b5efb4d41687ab1e1d20f27512e971c4c520817feeeca775328d98b2662`。

## 未完成要求

本轮只通过经典技能名称和职业范围检查。技能数值、全部技能获取及施放流程、纯净物品/怪物/掉落/NPC 数据、完整世界、匹配的 2003 原始整包和其余系统仍待核对。`scripts/audit-176.mjs` 分别报告范围外技能数量与数值未认证，完整验收继续失败，goal 保持 active。
