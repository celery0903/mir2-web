# 现成源码加 Proxy 接入

日期：2026-10-04。正式入口 <http://172.30.0.16:18880/> 已改用现成 H5 源码和配套 proxy。目标仍为 2003 年盛大原版 1.76，完整版本验收仍未通过。

最新地图更新已将比奇改为固定服务端种子的旧 12 字节格式地图和对应 WemadeMir2 库，严格资源检查通过，未解析引用为零；下文 71 个缺项和 Mir3 资源的记录属于此前转换图。世界范围仍为 11 张图，沃玛森林和毒蛇山谷只有候选资源检查，尚未正式开放。更新证据见本文末尾“原生比奇地图与素材库”。

后续 [经典世界整理](CLASSIC_WORLD.md) 已将 249 张候选图固定到原始 Git blob，完成全部单元与 48,229 个可用帧的像素检查、36 处区域和边界画面，以及十张店铺画面。全目录仍因石墓四层的一帧缺项而失败，候选目录未整包开放。现有 11 张已开放地图统一使用 WemadeMir2 图库，继续沿用现成 H5 源码、配套 proxy 和原引擎。

最新目录补上六件新衣服区域共 256 张图，通过实际原生引擎的全部碰撞格核对及新增区域桌面/手机图形检查；全目录资源仍缺石墓一帧。已另部署 [原生安全区修正](SAFE_ZONES.md)，数据库与存档保留，客户端与 proxy 继续使用上述现成源码。完整 1.76 尚未交付。

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
npm run prepare:source
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

## 投射物追踪与等待回包

在上一轮实际部署的 `e4c2aa6` 源码上，新增回归再次复现两项偏差：未收到效果回包时蓄力已经消失；目标由 `y=618` 移到 `y=620` 后，命中特效仍落在旧位置，误差 64 像素。真实失败输出见 [修复前回归](correction/source-flight-before-fix.json)。

本轮移植传统 `TMagicEff.Shift` 与 `TBujaukGroundEffect.Run` 的运动部分：按像素主轴初始化速度，逐帧平滑追踪目标，采用原命中距离、穿越判断、Delphi 偶数舍入和十秒寿命。符的飞行和地面符分别处理；没有目标的普通投射物不再凭空在目标格播放爆炸。命中后的附着效果继续跟随目标，跨图及新施法会使旧等待任务失效。

人物和蓄力效果共享等待时序，保留倒数第二帧直至原生效果或失败回包到达；本人采用 60 毫秒间隔和三秒超时，旁观者按原 `Round(interval / 1.8)` 取 33 毫秒及两秒超时。人物保留最后的准备姿势，成功释放后结束动作。尚未实现的持续特效也会正确释放蓄力，但没有用其他效果替代它们。

`tests/source-flight-reference.mjs` 校验固定源码哈希后，实际提取方向、速度初始化、Shift、Run 和地面符 Run，使用 Free Pascal 3.2.2 编译参照程序。[比较记录](correction/source-flight-reference/evidence.json) 包含九种场景、1,344 个步骤，逐项核对坐标、命中、超时、方向和飞行帧计数，零差异；同目录保存原始 CSV、编译输出及方法/程序/浏览器源码哈希。场景包括静止、移动、穿越施法者、目标消失、符、地面符、无目标、北向扇区和负坐标。测试使用受控角色和固定相机变换，仅核对提取的传统运动分支；没有认证整份后期源码、完整图形绘制或盛大 2003 客户端。

第一次独立浏览器复验虽然完成伤害和特效流程，轨迹仍显示旁观者首帧从 `x=288` 倒退到 `x=287.75`，见 [首帧修复前记录](correction/source-flight-clock-before-fix/evidence.json)。原因是异步素材加载后的起始时间可能晚于已排队的动画帧时间戳，现拒绝这种负时间步；对应回归未修复时得到 `x=89`，正确值应为 `100`。这份早期报告未包含首帧断言，不能作为最终修复验收。

20:12 UTC 开始的 [最终独立浏览器复验](correction/source-flight-skills-isolated/evidence.json) 通过新增首帧检查。双方弹道从 `(288,619)` 出发并在 `(284,615)` 命中，实际原生扣蓝 `38 -> 36`、伤害 3，人物动作和特效均结束。报告包含双方实际飞行路径和原生效果包，截图保存在同目录；桌面/手机无溢出、异常或资源请求失败，画布非空。真实目标在该次施法中未移动，双方 `targetMoves=0`；没有据此声称真实联机的移动追踪已经验收。桌面截图局部地图仍在加载，非空检查不证明地图资源完整。

20:16 UTC 已仅替换正式网页，最终实测镜像为 `sha256:3336af0c6d5dbdbd2a1e358dbad129e4cb5419f61c8180360e4ab64b338c6444`，资源目录保持不变。独立栈和正式入口均通过该镜像 ID 的显式断言。[部署前](correction/source-flight-before-deployment.json) 与 [部署后](correction/source-flight-deployment-evidence.json) 分别记录：正式响应 30 个网页文件、910 个资源文件哈希一致，数据库、引擎、proxy 实例及启动时间保持，全部服务 healthy，原生地图匹配。旧镜像保留为 `mir2-web-web:before-flight`；历史引擎更换证据保持原记录。

20:16 UTC 开始的 [正式入口浏览器回归](correction/source-flight-client-production/evidence.json) 全部通过三职业一级零金币注册、建角、换装、移动、桌面/手机与重登存档，以及原仓库跨图、手机存入、重登取回同一物品、金币保持及往返后本人可见。正式回归未使用离线等级或金币 fixture，也未注入技能。浏览器无异常或资源请求失败。

`node scripts/audit-176.mjs --check` 仍返回退出码 1。完整世界只有 11 张图，仍有 71 个未解析地图引用和 108 个混合版本技能；持续效果、方向火焰、战士叠加、召唤及其他技能的完整浏览器工作流尚未验收，原始 2003 安装包也未取得。本轮运动参照通过及源码复用不改变完整 1.76 验收失败，goal 未完成。

## 原生状态与魔法盾接入

`server/openmir2-status.patch` 恢复原引擎已有状态数组与逐角色计时，修复 buff 插入顺序导致红毒、盾都误报绿毒，以及未运行的计时循环。防御恢复、绿毒伤害、盾减伤和隐身改为一致的原生状态路径。[真实程序集对照](correction/source-status-native/evidence.json) 以镜像 DLL 哈希验证测试加载对象，修复前 0/8、修复后 8/8，包含大于 40 秒的盾、受击扣时和到期清理；传统源码参照不构成 2003 数值认证。

`server/source-magic.patch` 将盾 Sprite 挂在现成 actor 上，保留原偏移、加法混合、`0x00100000` 状态位及严格 120 毫秒三帧循环。盾随人物移动，由原生关闭状态隐藏；聚焦回归执行真实 actor 的受击序列和清理。镜像内 19 项魔法回归、39 项已有前端检查和构建通过。[素材核对](correction/source-status-magic-assets.json) 覆盖 746 帧及 20,318,916 个 RGBA 像素，无缺帧或偏移差异。

[独立浏览器实测](correction/source-status-shield-isolated/evidence.json) 通过双方施盾、三帧循环、扣蓝、移动附着、自然到期及桌面/手机。实际当前零级参数对应 4 至 5 秒，收到关闭包用时 5.392 秒。测试使用离线 31 级、20,000 金币及临时原生书店库存，实际买书和使用后学习，随后恢复原脚本并核对哈希；未注入技能。原书店不卖魔法盾，当前未开放尸王地图，这个 fixture 不证明原版掉落获取流程。大于 40 秒的错误浏览器断言及库存诊断见纠正报告，未将其计为通过。真实受击联机画面、带盾跨图、原毒调色板和完整三职业技能仍未验收。

[火球复验](correction/source-status-fireball-isolated/evidence.json) 的原生扣蓝 `65 -> 63`、伤害 3、双方弹道和动作清理通过，原生魔法值包保存在报告中。满蓝测试数据只在独立库离线设置，未修改技能表；当前值在拍图后受自然回蓝影响的旧检查失败单独保留。该次目标未移动，不构成真实移动目标验收。

原生空背包查询不发回包，造成复活后背包一直未知。Linux 补丁改为发送数量 0、没有正文的原生 `SM_BAGITEMS`，配套 proxy 已能正确解析，无需合成背包数据。[程序集对照](correction/source-status-native/evidence.json) 的真实 gate 包检查旧镜像失败、新镜像通过；[浏览器复验](correction/source-status-empty-inventory-isolated/evidence.json) 用同一角色通过桌面/手机重登，保持装备实例、耐久和金币。

本轮商人长途路线仍因角色死亡而失败。[修理续测](correction/source-status-repair-isolated/evidence.json) 只在隔离库调整专用角色位置到原铁匠铺，真实修理从 `3974/4000` 到 `4000/4000`，保持原生先对话、后确认的顺序，并核对桌面/手机。该 fixture 不改变正式规则，也不验收失败的长途路线。

21:21 UTC 更新正式引擎、网页和素材，关闭前原生保存完成并正常退出。最终盾与火球检查分别保存在 [盾](correction/source-status-shield-final/evidence.json) 和 [火球](correction/source-status-fireball-final/evidence.json)。[部署核对](correction/source-status-deployment-evidence.json) 确认声明的实测镜像、30 个网页文件和 916 个资源文件，原数据库与 proxy 实例、存档卷和书店脚本保持；引擎实例已更换，旧资源及镜像保留。

[正式入口回归](correction/source-status-client-production/evidence.json) 通过三职业一级零金币注册、装备、移动、桌面/手机及重登，以及仓库存取与往返；未修改正式账号的等级、金币或位置。完整审计仍失败，11 张地图、71 个未解析引用、108 个混合版本技能和原包缺口仍在，goal 未完成。

## 原生比奇地图与素材库

21:47 UTC 正式比奇改用 `mirbeta/MirServer@f38deae64c521a28f8e0d86f2bf24d4ba7c9ea5c` 的 `0.map`，SHA-256 `183e9d545e284275d7955e56dfc4af301e8af9e54c46470a4c7817ee7c5742e7`。保留原始 700×700、52 字节头与每格 12 字节，没有裁剪成其他格式。对应地图不再引用旧转换图中的 Mir3 snow 库；前景文件字节 0/3/4/5 分别使用 Objects/Objects4/Objects5/Objects6，背景与中景使用同一 WemadeMir2 命名空间。新锁文件记录地图、整库的大小与 SHA-256；公共 Crystal 转换库和社区地图仍未认证为 2003 盛大原包。

[源文件检查](correction/source-native-world-assets.json) 核对 490,000 个地图单元、4,807 帧、40,668,892 个 RGBA 像素及偏移，含原库遮罩。新导入流程拒绝额外尾部，也拒绝可能被旧工具误判的 14 字节布局。所有 11 张网页地图块重组后与原生文件逐字节一致，严格资源准备通过，未解析引用从 71 降为零。[八处画面对照](correction/source-native-world-browser/evidence.json) 包含出生点、仓库、城内、城南、西南、东北与两个野外入口，桌面/手机均非空、零未解析引用，无异常、资源失败或横向溢出；这些是比奇内的入口画面，未验收未开放的野外跨图。

新地图相对旧部署有 5,761 格碰撞变化。[保存后的位置检查](correction/source-native-world-positions.json) 核对 17 个已有比奇角色，没有新增阻挡，不调整坐标。现有 44 个店铺连接保留；[隔离浏览器验收](correction/source-native-world-client-isolated/evidence.json) 通过三职业一级零金币建角、装备、原生确认移动、桌面/手机、重登及仓库存取与往返。一次隔离栈端口冲突导致的连接失败单独保存在 [失败记录](correction/source-native-world-port-failure.json)，不计为游戏流程通过。

[候选地图检查](correction/source-native-world-candidates-assets.json) 另外核对沃玛森林与毒蛇山谷，共 1,210,000 个单元、5,447 帧、44,733,724 个 RGBA 像素，无未解析引用；这不是正式开放、出入口/刷怪验收或官方版本认证。候选沃玛森林与另一份社区数据有 515 格碰撞差异，不能仅凭双方同名认定版本一致。

引擎保存后正常退出，见 [关闭记录](correction/source-native-world-shutdown.json)。新引擎镜像 `sha256:62d10be31891bc4cac795ceda5eacbbfabc89105c3d316049e7347075e5095ea` 与隔离实测一致；网页镜像仍为 `sha256:19f73b86862742547304110a0c1bd989cb22623a4ee413668e1378d81fe181d1`，继续复用现成客户端和 proxy。更新前快照与新部署分别保存在 [更新前](correction/source-native-world-before-deployment.json) 和 [部署核对](correction/source-native-world-deployment-evidence.json)。新部署核对 30 个网页文件、7,155 个资源文件，其中 6,247 个为地图 PNG（含遮罩），原生地图匹配，四项服务健康。数据库与 proxy 实例、引擎存档卷、原书店脚本保持；引擎实例已更换，旧资源与镜像保留。

21:47 UTC 开始的 [正式入口回归](correction/source-native-world-client-production/evidence.json) 全部通过：三职业一级零金币建角、装备、服务端确认移动、桌面/手机与重登存档，仓库原入口、手机存入、重登取回同一物品及往返后本人可见。正式测试没有使用离线等级、金币或位置 fixture，无浏览器异常或资源失败。地图资源检查通过不构成完整 1.76 验收；完整审计仍返回 1，11 张地图、108 个混合版本技能、纯净数据、其余技能和系统及原安装包仍未完成，goal 保持 active。
