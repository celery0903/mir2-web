# 全表物品与原生引用核对

日期：2026-10-05。目标仍是 2003 年盛大原版 1.76。继续使用固定的现成 Pixi H5 源码、其配套 proxy 和 OpenMir2；本次没有替换客户端，也没有迁移物品定义。完整版本验收仍未通过。

## 范围与结果

此次核对全部 1,000 条 SQL 物品及所有定义字段，不按种子表的标题分段猜测物品范围。202 本 `StdMode=4` 技能书中，33 本精确对应已有经典技能身份，另外 169 本在该范围之外。其他物品逐行保留为待核实状态；网上候选中出现同名物品，不等于它属于 2003 版本。

普通黑铁头盔在 **ID 344**，位于首饰分段。此前“没有普通定义”的记录错误，已在[物品编号说明](ITEM_INDICES.md)更正。经典套装在 ID 608-639，包括记忆、祈祷、魔血、虹魔及三职业套装；不能用前部连续编号作为允许范围。ID 625 的“神秘腰带”实际 `StdMode=26`，两个候选和旧资料页也使用这个名字，不能按名称把它当成后期的腰带槽装备。

[`audit-classic-items.mjs`](../scripts/audit-classic-items.mjs) 从正在运行的引擎提取 DLL，使用实际 `ScriptParsers.LoadScriptFile()`、`LocalDb.LoadMonitems()` 和 `HUtil32` 编译脚本、商品及掉落。查询正式数据库只使用 SELECT/SHOW。原生读取器以读写方式打开文件，因此只挂载离线副本，并逐文件核对解析前后哈希；还校验被测 DLL 与 `/data/server/Mir200/` 实际运行文件一致。

| 项目 | 正式 18880 | 完整世界候选 18883 |
| --- | ---: | ---: |
| 地图声明 | 11 | 256 |
| 物品定义 | 1,000 | 1,000 |
| 声明的脚本根 | 15 | 107 |
| 配置及脚本中的怪物名称 | 10 | 176 |
| 编译分支、商品和掉落的潜在物品引用 | 164 | 8,417 |
| 缺失定义的引用次数 | 27 | 142 |
| 原生解析日志中的错误 | 0 | 84 |
| 已检查引用中的范围外技能书 | 0 | 0 |

引用缺项包括无字天书、八卦宝石、未指定份量的药粉及其他任务物品。候选还引用罗刹、精灵头盔和带 `[!]` 前缀的武器等缺失名称。每条保留文件、脚本标签、分支位置或原生掉落位置；详见[正式报告](correction/classic-items-production/evidence.json)与[候选报告](correction/classic-items-candidate/evidence.json)。没有把整个目录里未声明的假人 NPC 脚本算作已开放内容。

这里的“潜在引用”是原生编译器收集的所有分支，尚未证明玩家能执行该分支。动态物品名、其他物品指令、包含文件来源闭包和原生报错分别列为待核实项。蛤蟆没有掉落文件，原生加载器会接受为空；该记录也不证明缺失某种原版掉落。

角色装备、背包、仓库的正编号均能找到定义，没有指向范围外技能书。编号 0 是空存档槽，单独统计，不是待迁移物品。角色引用检查尚未覆盖商人库存、市场/交易序列化数据、初始物品规则、合成表和硬编码创建；没有据此删除上述 169 本书。

## 两份候选与资料页

固定来源见 [`classic-item-sources.json`](../shared/classic-item-sources.json)。两份 Paradox 数据库分别有 468 和 345 行；Git blob、SHA-256、行数和原始字段均核对后才读取。使用 `pypxlib==2.5` 与 `gb18030`，按实际字段名称映射，保存未映射扩展字段；不把来源编号当成正式 SQL ID。

全表逐行比较中，两个候选分别有 274 和 287 个精确、唯一的同名匹配，其中 166 和 200 个匹配行有已映射字段差异。所有 1,000 行都有结果，未匹配和重名明确保留。详见[数值比较](correction/classic-items-production/numbers.json)。普通黑铁头盔与第一个候选的 22 个已映射字段一致，与第二个候选仍有字段差异；一致并不认证原版来源。

七个 17173 资料页按完整 HTML 的 SHA-256 保存，DOM 提取 164 条记录，精确名称和明确的男女衣服变体对应 158 条当前定义，15 个标签仍无法对应。网页中的屏蔽名、简写、错字和损坏文本没有推断改名。详见[资料页比较](correction/classic-items-production/guides.json)及[来源快照](correction/classic-item-guide-sources/)。这些是现存页面，含现代侧栏和页脚，并非认证的 2003 快照。

鹤嘴锄、布衣等条目仍有明显数值冲突。药品及蜡烛的网页价格还可能包含商人倍率；原生 `Merchant.PriceRate` 已随商品记录保存，不能直接把网页价格导入 SQL `Price`。两份社区库均包含后续内容，完整导入和自动数值替换继续拒绝。

## 引号解析修复

实际原生脚本回归首次失败：商品 `"火球术"` 被解析为带残留引号的名称。失败报告保存在[原生解析记录](correction/classic-item-audit-quote-failure/evidence.json)，没有把错误结果改成正确名称来通过审计。

[`openmir2-quoted-names.patch`](../server/openmir2-quoted-names.patch) 修正 `HUtil32.CaptureString` 从 Pascal 移植时混用一基与零基下标的问题，并恢复三个 `GetValidStrCap` 重载的左侧空白处理。固定参考为 `lzxsz/MIR2@98711dad31567d9a7e272956f6c5a2487000848b` 的 `GameOfMir/Common/HUtil32.pas`，SHA-256 `7f6445e6b14c3e9bc012c14c8c4bdb7cc46cd276bce0765bb0bb243fda8be240`。该后期源码用于字符串语义参照，不作为 2003 版本认证。

[实际镜像检查](correction/quoted-names-native/evidence.json) 为旧镜像 **11/39**、修复镜像 **39/39**，包括中文、名称内空格、前导空白、空引号、连续引号、未闭合引号、单独引号及全部三个重载。修复后的[原生脚本用例](correction/classic-item-audit-checks/evidence.json) 还验证报价倍率、商品补货参数、掉落分数和数量、金币例外、条件及 else 分支、动态名称、地图别名和未声明脚本排除。物品编号的真实 MySQL 检查仍为 **14/14**。

## 复现

```bash
npm run fetch:classic-item-candidates
python3 -m pip install --target .runtime/paradox-reader pypxlib==2.5
npm run audit:classic-items -- mir2-web .runtime/reports/classic-items-production
PYTHONPATH=.runtime/paradox-reader python3 scripts/audit-classic-item-numbers.py .runtime/reports/classic-items-production/snapshot.json .runtime/reports/classic-items-production/numbers.json
npm run audit:classic-item-guides -- .runtime/reports/classic-items-production/snapshot.json .runtime/reports/classic-items-production/guides.json
npm run test:classic-item-audit
npm run test:source-quoted-names
```

原生检查需要 Docker、运行中的引擎及本地 `mcr.microsoft.com/dotnet/sdk:8.0`。修复对照检查默认使用 `mir2-web-engine:before-quoted-names` 和 `mir2-quoted-engine:test`；这两个本地镜像已保留，可通过 `MIR_QUOTED_NAMES_ENGINE_IMAGE` 和 `MIR_QUOTED_NAMES_BEFORE_IMAGE` 显式指定其他修复前后镜像。新克隆环境需要先准备这些镜像，不能把两个已修复镜像作为旧问题复现。资料页已保存在仓库中，浏览器检查需要 Playwright Chromium，检查期间阻止所有外部资源请求。

版本审计会核对报告中的整表哈希与当前 SQL，并将脚本引用数字标为历史检查结果，避免把过期报告当成当前迁移依据。

修复已部署到[候选引擎](correction/quoted-names-candidate/evidence.json)和[正式引擎](correction/quoted-names-production/evidence.json)，保留原数据库、网页、proxy 实例和存档卷，1,000 条物品、33 条技能及原生保存后的角色记录哈希一致。正式镜像为 `sha256:48092dd5906bf7e5db0d57a3b210937f0dbb4565930569ef31bd18a8be71c728`，运行中原生 DLL 与已测文件匹配。

[正式浏览器复验](correction/quoted-names-client-production/evidence.json) 通过三职业正常一级零金币注册、装备、移动、桌面/手机和重登，以及仓库跨图、手机存入、重登取回同一实例和往返人物可见；未使用离线 fixture。[部署核对](correction/quoted-names-deployment-evidence.json) 校验 30 个网页文件、7,339 个资源哈希、原生地图及四项服务健康。候选三职业基础流程通过，但[仓库长途行走](correction/quoted-names-client-candidate-failure/evidence.json) 在 `0/345,575` 因角色死亡失败，保留独立失败报告，没有据正式短途通过接受完整世界路线。

此阶段解决的是全表核对和一个原生解析缺陷；原版物品范围、数值、完整地图及其余系统仍未验收，goal 保持 active。
