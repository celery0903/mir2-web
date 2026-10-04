# 现成源码加 Proxy 接入

日期：2026-10-04。正式入口 <http://172.30.0.16:18880/> 已改用现成 H5 源码和配套 proxy。目标仍为 2003 年盛大原版 1.76，完整版本验收仍未通过。

## 运行链路与来源

浏览器使用 [leiniaozl229/mir2](https://github.com/leiniaozl229/mir2/tree/77e3ff7506b1ca55cac15df247cb2fcedd69c535) 的 `apps/web` Pixi 客户端；同源 Nginx 转发 `/ws` 给它的 `services/web-gateway` .NET 10 proxy，再连接原有 OpenMir2 六个服务和 MySQL。源码作为 `upstream/mir2-client` 子模块固定在 `77e3ff7506b1ca55cac15df247cb2fcedd69c535`，上游检出保持干净。

默认 Compose 和 `npm run build` 使用这条链路。此前自写的 Phaser 客户端及网关保留为历史参考，不在默认镜像中构建。最初切换只更新 `web` 和 `source-proxy`；随后正式复验查实 LoginGate 返回通道因断连发送异常退出，本轮另补上引擎修复。数据库实例和存档卷保留，引擎更换单独记录。具体镜像、启动时间、文件哈希见 [部署证据](correction/source-deployment-evidence.json)。

上游没有顶层许可证；其代码未重新标为本项目 MIT 代码。代码与商业素材来源分别保留在 [第三方说明](../THIRD_PARTY_NOTICES.md)。

## 接入补丁

补丁保存在 `server/source-client.patch` 和 `server/source-proxy.patch`，由 Docker 构建应用；游戏规则、物品、金币和存档仍由原生服务端处理。

| 差异 | 修正 |
| --- | --- |
| 比奇怪物 RaceImg/Appr 不同 | 映射到已校验的鸡、鹿、稻草人等十种现有动画库 |
| 室内地图引用多个 Objects 库 | 按原地图单元的文件索引选择室内素材，补齐 Objects2/Objects3；未改服务端碰撞 |
| 低级战士血球 | 28 级前绘制第 5 帧灰色底图和第 6 帧红色填充，其余状态分红蓝球；按位图对齐 |
| 跨图后角色消失 | proxy 的 `SM_CHANGEMAP` 634 事件包含权威角色 ID、坐标及亮度，客户端独立保留本人外观并在新图恢复；该消息的 Series 是亮度，保留人物朝向 |
| 柜台后 NPC 无法接近 | 同地图已知 NPC 距离上限与当前服务端的 15 格一致；proxy 校验目标和当前位置 |
| 连续点击 NPC 被静默丢弃 | proxy 按原生默认 1000 毫秒限制留出 1100 毫秒间隔，再核对 NPC 后发送 |
| 窗口背景 404 | 移除 CSS 中固定的旧图片哈希，使用素材清单实际地址 |
| NPC 链接被移到独立按钮组 | proxy 增加逐行结构，保留脚本中的链接位置、空格和空行；客户端继续发送原 `dialogueSelect` |
| NPC、商店和仓库共用 402 面板 | 对话改用 384，商店及取回目录用 385，出售、修理、保管框及确认用 392/393；背包在服务窗口打开时默认靠右 |
| 用药或丢弃后两个物品视图不同步 | 已确认且仍有对应待处理请求的回包同步更新背包与快捷槽；拒绝及迟到回包不移除物品 |
| 修理成功后背包耐久未更新 | 原生对话先于修理回包到达时保留已提交请求，按后续回包更新耐久与金币；迟到询价及重复回包不生效 |
| 两格跑步受阻后请求远处开门 | 回滚到服务端位置，先尝试同方向单步行走，再处理单步受阻；避免发送超出距离的开门请求 |
| LoginGate 连接可用却不再返回登录结果 | 原生返回队列逐条处理断连发送的 `ObjectDisposedException` 和 `SocketException`，继续转发其他客户端回包 |

服务窗口尺寸和按钮坐标对照固定的 `lzxsz/MIR2` 源码 `FState.pas` 的 `DMerchantDlg`、`DMenuDlg`、`DSellDlg` 和现有位图。NPC 416×176、目录 308×205、出售/修理/保管框 140×181；目录每页十行，选择后确认或双击，商品成色分页仍请求原生服务端。物品槽位于 `(27,67)`，确认按钮位于 `(85,150)`。出售和修理支持背包点选、拖入及取消，先询价再确认；服务窗口打开期间拦截背包点击及双击，避免等待询价时误用或误装备物品。出售、保管收到服务端确认才移除物品，修理保留服务端返回的当前及最大耐久。这些对应修复没有认证现有素材为 2003 原始整包。

## 资源与地图

`npm run prepare:source` 初始化子模块、空账号 SQL、固定资源和世界配置，运行上游导出，再生成 `.runtime/source-assets/`。经典转换资源的 718 个文件按锁定大小和 Git blob 校验，原始 Crystal 库按上游记录的大小和 SHA-256 校验。UI、室内、NPC 和比奇怪物的转换保留来源。

采用与当前引擎一致的 11 张图、44 个原出入口。候选 `0.map` 与当前原始图虽同为 700×700，仍有 5761 个碰撞格、70846 个单元字节不同，因此未直接采用它的地图。新网页地图的源 SHA-256 与正式引擎全部一致，见 [版本审计](version-audit.json) 的 `clientImplementation.nativeMapsMatch`。

当前比奇按正确素材库核对后有 71 个未解析引用：Objects 16 个、BichonObjects257 11 个、BichonObjects253 1 个、BichonObjects7 6 个、Tiles 18 个、SmTiles 19 个。严格准备会拒绝缺项；明确使用 `--allow-missing-references` 才允许部署这一未完成版本，`integration.json` 的资源验收仍为 `failed`。这些候选素材未认证为 2003 原始客户端，未启用候选的 570 张混合版本地图。

18:58 UTC 的逐单元审计查实旧转换丢失了 6,851 个非默认前景素材库编号。现已保留原库编号，并从固定候选的对应图集导出各库，而不再把不同库的同号帧合并为一套 Objects。还查实旧转换截断 835 格宽背景图像编号，涉及 291 种图像；现将这些编号确定性映射到未使用的传统格式槽位，并在浏览器清单保留原编号。771 格宽编号在固定图集中实际有帧。比奇原生地图 SHA-256 更新为 `34bdc4cef9233eda50588b0d05181f371279771c94774c7804e2053c019e6cc2`，49 万格的碰撞保持一致。

19 个 SmTiles 缺项对应原始候选的 33 个单元，均在 `x=0`、`y=1..165`；这些引用继续保留。固定候选还把部分图像同时列为缺失和空帧，现以缺失记录为准。城南 `(336,358)` 的 Tiles 帧 434 属于这种情况，浏览器仍显示一个未解析引用。此前使用不同库的同号图像或只看空帧清单会掩盖这些缺口。详细坐标、源哈希与映射见 [版本审计](version-audit.json) 的 `clientImplementation.mapConversion`。保留候选的编号不构成盛大 2003 原版认证；该候选混有 Wemade/Mir3 素材族。

`tests/source-map-libraries.mjs` 已核对 8,482 帧、54,646,044 个 RGBA 像素与固定源图集逐像素一致，并检查边界、城内、城南、西南、东北和宽编号地砖六处桌面/手机画布、库请求、错误与溢出。转换检查通过，城南资源检查和全图资源验收仍失败。首次要求所有场景零未解析引用的测试在城南失败，后续报告明确记录源缺口和资源失败，不将其计为完整通过。

19:21 UTC 已将对应地图和素材更新到正式入口。详见 [转换证据](correction/source-map-libraries/evidence.json)、[独立仓库检查](correction/source-map-warehouse-isolated/evidence.json)、[独立商人检查](correction/source-map-services-isolated/evidence.json) 和 [部署检查](correction/source-map-deployment-evidence.json)。部署检查新增所有地图块与素材库清单的响应哈希，以及原生地图匹配；当前核对 30 个网页文件和 167 个资源文件。数据库实例和存档卷保留，引擎实例更换。

19:22 UTC 开始的 [正式入口仓库回归](correction/source-map-warehouse-production/evidence.json) 通过，包含战士注册、装备、移动、重登存档、桌面/手机和跨图存取同一物品，无浏览器异常或资源请求失败。完整版本验收仍未通过。

## 实测证据

正式入口的 [外部浏览器验收](correction/source-original-ui-production/evidence.json) 于 2026-10-04 16:37 UTC 通过，截图包含三职业桌面、手机和原仓库窗口。`tests/source-client.mjs` 实际注册账号、建角和操作，不修改数据库或注入物品：

- 三职业一级零金币开始，装备木剑和布衣，移动收到服务端确认；重登后位置和装备保留。
- 桌面和 390×844 手机画布非空，手机无横向溢出；比奇小地图和真实怪物帧加载成功。
- 从比奇 `307,627` 实际跨图到仓库 `0140`，距离 6 格点击柜台后的保管员。
- 原脚本行内链接、窗口尺寸、十行目录和红色选中项已核对；背包拖入后取消选择、蜡烛图标实际加载、手机点选存入、重登取回同一 makeIndex、金币保持零。
- 仓库与比奇往返后再次进仓，地图加载完成且本人原动画帧可见；没有浏览器异常或素材失败。修复前的实际跨图失败保留在 [失败记录](correction/source-original-ui-before-fix.json)。
- 同源 WebSocket 可用，不可信 Origin 返回 403，缺失资源返回 404。

镜像构建现在执行前端和网关回归，测试增量固定在 `server/source-tests.patch`。前端 39 项回归包含目录分页、选择确认、拒绝恢复、服务端成色页、出售询价与取消、修理报价拒绝和服务端最大耐久损耗、先到对话后到修理回包、跑步拒绝后的单步回退，以及用药/丢弃后的背包与快捷槽同步；网关回归增加链接与空行位置和输入链接投影检查。这不替代其余业务验收。

登录故障的堆诊断确认 `ClientManager.ProcessSendMessage` 已完成，其异常为断连发送时的 `ObjectDisposedException`。脱敏结果见 [登录失败记录](correction/source-login-before-fix.json)，未保存凭据或堆内容。`tests/login-channel` 直接编译上游 `ClientManager.cs`，用测试依赖模拟断连：未修复源码在正常客户端回包处超时，修复后已释放 socket、连接重置及正常回包依次通过。`tests/source-login.mjs` 另验证真实 WebSocket 断连后仍有原生登录响应。

2026-10-04 18:38 UTC 开始的正式入口 [登录断连检查](correction/source-login-fixed-production/evidence.json) 和 [仓库验收](correction/source-warehouse-login-fixed-production/evidence.json) 已通过。50 次主动断连后，每轮原生登录响应仍正常；战士网页注册、建角、装备、移动、桌面/手机、重登存档、仓库存取和往返跨图通过，浏览器无异常或素材请求失败。引擎更新前正常退出并输出保存完成确认，部署记录中 `preservedDatabase`、`preservedEngineStorage` 为 `true`，`preservedEngine` 为 `false`。

18:42 UTC 开始的正式入口 [商人验收](correction/source-services-confirmed-production/evidence.json) 已通过：初始蜡烛出售得到 6 金币，11 金币商品收到原生金币不足拒绝；正常战斗与行走造成木剑耐久 `3978/4000`，原生零价修理恢复为 `4000/4000`，先到 NPC 对话、后到修理回包时背包仍正确更新。药品从背包与快捷槽同时移除。低级战士血球空白区 532 个不透明像素均与原第 5 帧一致，桌面/手机原出售和修理窗口无溢出，浏览器无异常或素材失败。行走采用 45 个短路段和两次重新点选到铁匠铺，不计为远距自动寻路稳定性通过。前一次正式商人进程在行走阶段收到终止信号，未生成完整报告，不计为通过；上述结果对应独立重跑。

上游完整 Python 测试未通过：92 项，4 个失败、6 个错误，包含候选运行 SQL、国服 UI 导出缺失、`Merchant.txt` 大小写和试验地图/世界目录差异。此前隔离引擎也曾出现登录等待超时，重启后恢复；当时没有保留相同的堆诊断，不能直接归为本次异常。长期稳定性尚未完成验证。这些情况不计为全套检查通过。

## 复现与剩余要求

```bash
npm ci
npm run prepare:source -- --allow-missing-references
docker compose up -d --build --wait
MIR_URL=http://127.0.0.1:18880 npm test
MIR_URL=http://127.0.0.1:18880 npm run test:source-services
MIR_URL=http://127.0.0.1:18880 npm run test:source-login
npm run audit:176 -- --check
npm run verify:deployment
```

上面的 1.76 审计当前返回退出码 1。仍需取得并校验原安装包、完整经典世界和纯净版本数据，并在这套客户端上验收完整三职业技能、交易、组队、行会与攻沙。其他工具窗口仍有通用源码布局，未完成原帧还原。小地图远距寻路仅掌握已载入视野的碰撞格，遇到阻挡可能停止；商人测试采用短路段跑步和重新点选，不计为长距寻路稳定性通过。历史自写客户端的技能和重启测试不作为新入口的对应验收。

这里复用的是能在浏览器执行的 H5 源码和协议 proxy。原 Windows/Delphi PC 客户端仅转发 TCP 仍不能在浏览器执行，采用该客户端还需要 Windows/Wine 和画面输入流。

## 原生施法消息与特效修复

`server/source-magic.patch` 继续修改固定 H5 源码。实际旁观者测试查实，`SM_SPELL` 携带目标格而非施法者所在格；旧处理把法师从 `(288,619)` 显示到 `(294,618)`，见 [修复前记录](correction/source-skills-before-fix/evidence.json)。现保留施法者坐标，按原方向阈值转向，并用消息里的 `effect` 选择蓄力帧。原引擎只向其他玩家发送该消息，本人蓄力改从已学习技能的原生元数据触发。效果回包不再重新播放人物施法动作，旁观者的人物动作在一轮帧结束后回到站立。

31 个传统蓄力基址对照固定 `lzxsz/MIR2` 的 `magiceff.pas`；火球、大火球、灵魂火符、毒、雷电及部分落点分别选择对应序列。`shared/classic-magic.json` 保存源码版本、文件哈希和未完成项，导出继续使用上游 Crystal 解码器。740 张 PNG、20,256,644 个 RGBA 像素及尺寸、偏移与固定 Magic/Magic2 库一致，见 [素材核对](correction/source-magic-assets.json)。这套源码含后期改动，素材也尚未对照 2003 原始整包认证。

最终独立镜像通过 8 项特效回归、39 项已有前端检查及 TypeScript/Vite 构建。[真实火球流程](correction/source-skills-isolated/evidence.json) 使用两个新账号，只在独立库离线设置七级和 20,000 金币，随后全部买书、学习、行走和施法通过网页执行。测试核对双方蓄力序列、旁观者位置保持、原生扣蓝 `38 -> 36`、怪物伤害 3、人物动作结束和效果精灵释放，以及桌面/手机非空画布、无横向溢出、无异常或资源失败。第一次修复复验因附近没有适用怪物而失败，见 [寻怪前失败](correction/source-skills-no-target-failure.json)；随后增加真实寻怪路线，最终完整流程通过。

本轮只更新正式网页镜像和配套素材。旧镜像及旧资源目录保留用于回退；[更新前快照](correction/source-skills-before-deployment.json) 与 [更新后核对](correction/source-skills-deployment-evidence.json) 分别保存。30 个网页文件及 910 个资源文件哈希通过，原数据库、引擎、proxy 的实例和启动时间均保持。未覆盖此前实际引擎更换记录。

19:49 UTC 开始的 [正式入口回归](correction/source-skills-client-production/evidence.json) 通过三职业注册、建角、换装、移动、桌面/手机画布和重登存档，以及原仓库跨图、手机存入、重登取回同一件物品、金币保持和往返后本人可见。正式回归未修改数据库或注入技能；火球实测仅在独立栈执行。浏览器无异常或资源请求失败。

本次火球实测不证明其他技能的完整动作、消耗、伤害和工作流。持续盾、毒与地面魔法、方向火焰、战士攻击叠加、召唤、原投射物追踪/时序和原人物等待施法回包的细节仍未完成。桌面行走后的地图画面可能尚在加载，非空画布检查不证明地图资源完整。完整 1.76 审计继续失败，goal 未完成。
