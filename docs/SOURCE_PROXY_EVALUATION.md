# 现成源码加 Proxy 接入

日期：2026-10-04。正式入口 <http://172.30.0.16:18880/> 已改用现成 H5 源码和配套 proxy。目标仍为 2003 年盛大原版 1.76，完整版本验收仍未通过。

## 运行链路与来源

浏览器使用 [leiniaozl229/mir2](https://github.com/leiniaozl229/mir2/tree/77e3ff7506b1ca55cac15df247cb2fcedd69c535) 的 `apps/web` Pixi 客户端；同源 Nginx 转发 `/ws` 给它的 `services/web-gateway` .NET 10 proxy，再连接原有 OpenMir2 六个服务和 MySQL。源码作为 `upstream/mir2-client` 子模块固定在 `77e3ff7506b1ca55cac15df247cb2fcedd69c535`，上游检出保持干净。

默认 Compose 和 `npm run build` 使用这条链路。此前自写的 Phaser 客户端及网关保留为历史参考，不在默认镜像中构建。此次切换只更新 `web` 和 `source-proxy`；正式数据库、引擎容器及存档卷未替换。具体镜像、启动时间、文件哈希见 [部署证据](correction/source-deployment-evidence.json)。

上游没有顶层许可证；其代码未重新标为本项目 MIT 代码。代码与商业素材来源分别保留在 [第三方说明](../THIRD_PARTY_NOTICES.md)。

## 接入补丁

补丁保存在 `server/source-client.patch` 和 `server/source-proxy.patch`，由 Docker 构建应用；游戏规则、物品、金币和存档仍由原生服务端处理。

| 差异 | 修正 |
| --- | --- |
| 比奇怪物 RaceImg/Appr 不同 | 映射到已校验的鸡、鹿、稻草人等十种现有动画库 |
| 室内地图引用多个 Objects 库 | 按原地图单元的文件索引选择室内素材，补齐 Objects2/Objects3；未改服务端碰撞 |
| 低级战士血球 | 28 级前单红球，其余状态分红蓝球；按位图对齐 |
| 跨图后角色消失 | proxy 的 `SM_CHANGEMAP` 634 事件包含权威角色 ID、坐标及亮度，客户端独立保留本人外观并在新图恢复；该消息的 Series 是亮度，保留人物朝向 |
| 柜台后 NPC 无法接近 | 同地图已知 NPC 距离上限与当前服务端的 15 格一致；proxy 校验目标和当前位置 |
| 连续点击 NPC 被静默丢弃 | proxy 按原生默认 1000 毫秒限制留出 1100 毫秒间隔，再核对 NPC 后发送 |
| 窗口背景 404 | 移除 CSS 中固定的旧图片哈希，使用素材清单实际地址 |
| NPC 链接被移到独立按钮组 | proxy 增加逐行结构，保留脚本中的链接位置、空格和空行；客户端继续发送原 `dialogueSelect` |
| NPC、商店和仓库共用 402 面板 | 对话改用 384，商店及取回目录用 385，保管框及确认用 392/393；背包在服务窗口打开时默认靠右 |

服务窗口尺寸和按钮坐标对照固定的 `lzxsz/MIR2` 源码 `FState.pas` 的 `DMerchantDlg`、`DMenuDlg`、`DSellDlg` 和现有位图。NPC 416×176、目录 308×205、保管框 140×181；目录每页十行，选择后确认或双击，商品成色分页仍请求原生服务端。保管支持背包点选和拖入，收到服务端确认才移除物品。这些对应修复没有认证现有素材为 2003 原始整包。

## 资源与地图

`npm run prepare:source` 初始化子模块、空账号 SQL、固定资源和世界配置，运行上游导出，再生成 `.runtime/source-assets/`。经典转换资源的 718 个文件按锁定大小和 Git blob 校验，原始 Crystal 库按上游记录的大小和 SHA-256 校验。UI、室内、NPC 和比奇怪物的转换保留来源。

采用与当前引擎一致的 11 张图、44 个原出入口。候选 `0.map` 与当前原始图虽同为 700×700，仍有 5761 个碰撞格、70846 个单元字节不同，因此未直接采用它的地图。新网页地图的源 SHA-256 与正式引擎全部一致，见 [版本审计](version-audit.json) 的 `clientImplementation.nativeMapsMatch`。

当前比奇仍有 19 个越界 SmTiles 引用。严格准备会拒绝缺项；明确使用 `--allow-missing-references` 才允许部署这一未完成版本，`integration.json` 的资源验收仍为 `failed`。这些候选素材未认证为 2003 原始客户端，未启用候选的 570 张混合版本地图。

## 实测证据

正式入口的 [外部浏览器验收](correction/source-original-ui-production/evidence.json) 于 2026-10-04 16:37 UTC 通过，截图包含三职业桌面、手机和原仓库窗口。`tests/source-client.mjs` 实际注册账号、建角和操作，不修改数据库或注入物品：

- 三职业一级零金币开始，装备木剑和布衣，移动收到服务端确认；重登后位置和装备保留。
- 桌面和 390×844 手机画布非空，手机无横向溢出；比奇小地图和真实怪物帧加载成功。
- 从比奇 `307,627` 实际跨图到仓库 `0140`，距离 6 格点击柜台后的保管员。
- 原脚本行内链接、窗口尺寸、十行目录和红色选中项已核对；背包拖入后取消选择、蜡烛图标实际加载、手机点选存入、重登取回同一 makeIndex、金币保持零。
- 仓库与比奇往返后再次进仓，地图加载完成且本人原动画帧可见；没有浏览器异常或素材失败。修复前的实际跨图失败保留在 [失败记录](correction/source-original-ui-before-fix.json)。
- 同源 WebSocket 可用，不可信 Origin 返回 403，缺失资源返回 404。

镜像构建现在执行前端和网关回归，测试增量固定在 `server/source-tests.patch`。前端 34 项回归包含目录分页、选择确认、拒绝恢复和服务端成色页；网关回归增加链接与空行位置和输入链接投影检查。这不替代其余业务验收。

上游完整 Python 测试未通过：92 项，4 个失败、6 个错误，包含候选运行 SQL、国服 UI 导出缺失、`Merchant.txt` 大小写和试验地图/世界目录差异。隔离引擎也曾出现登录等待超时，重启该测试引擎后恢复；根因和长期稳定性尚未完成验证。这些情况不计为全套检查通过。

## 复现与剩余要求

```bash
npm ci
npm run prepare:source -- --allow-missing-references
docker compose up -d --build --wait
MIR_URL=http://127.0.0.1:18880 npm test
npm run audit:176 -- --check
npm run verify:deployment
```

上面的 1.76 审计当前返回退出码 1。仍需取得并校验原安装包、完整经典世界和纯净版本数据，并在这套客户端上验收完整三职业技能、交易、组队、行会与攻沙。出售、修理及其他工具窗口仍有通用源码布局，未完成原帧还原。历史自写客户端的技能和重启测试不作为新入口的对应验收。

这里复用的是能在浏览器执行的 H5 源码和协议 proxy。原 Windows/Delphi PC 客户端仅转发 TCP 仍不能在浏览器执行，采用该客户端还需要 Windows/Wine 和画面输入流。
