# 源码客户端组队

本次继续使用固定 Pixi H5 源码、配套 proxy 和 OpenMir2。修复组队许可的网页同步、原生登录投影和 MySQL 存档；组队与聊天仍由原生服务端处理。

## 查实的错误

- 原生建队成功会打开队长的组队许可，网页却仍显示关闭。[旧正式入口复现](correction/source-group-before/evidence.json)保留成功回包、成员列表和错误的开关截图。
- 移除成员及解散只应清空队伍成员，网页却同时关闭组队许可，导致界面与服务端状态不同。
- `SM_LOGON` 的 `MessageBodyWL.Tag1` 低字节包含组队许可，配套 proxy 原先没有转发它。
- OpenMir2 的 MySQL 建角和保存均遗漏 `AllowGroup`，还用它填写独立的 `AllowGroupReCall`。首次修复网页及 proxy 后，普通角色的[重登验证仍失败](correction/source-group-preview-storage-failure/evidence.json)：登录回包正确转发了数据库里的关闭状态。

修复分别保存在 `server/source-group-client.patch`、`server/source-group-proxy.patch` 和 `server/openmir2-group-storage.patch`。MySQL 使用已有的两列，无需修改表结构。已有存档值的历史来源无法从现存记录反推，本次没有批量重写它们。

## 行为依据

固定参照为 [lzxsz/MIR2@98711dad31567d9a7e272956f6c5a2487000848b](https://github.com/lzxsz/MIR2/tree/98711dad31567d9a7e272956f6c5a2487000848b)。该源码含后期改动，只作为对应基础行为参照，不能认证为 2003 年盛大原发布源码。

| 文件 | 对应行为 | SHA-256 |
| --- | --- | --- |
| `GameOfMir/MirClient/ClMain.pas` | 4451 行读取登录许可；5288 行建队成功打开许可；5338 行解散只清成员 | `cf5aa4524b5067499a08da4fcd17ae4654ac491ce318fc1052fe70f5a6ed4276` |
| `GameOfMir/M2Server/ObjBase.pas` | 17572 行建队打开许可；24920 行保存组队许可，24937 行独立保存传送许可 | `622bc35df593801fce3f028497250fbf171d0c03a5dbecafd251b69045ed6148` |
| `GameOfMir/M2Server/UsrEngn.pas` | 2351 行从存档恢复组队许可 | `4f56eb729aaf002cd3dad5aa1837c5537e563dd02a98e032bd3c68855c3f5732` |

当前固定 OpenMir2 的 `WorldServer` 已正确填充及加载角色的两种许可，错误位于 MySQL 写入。登录 proxy 只接受完整的 16 字节消息体，按低字节恰为 `1` 判断开启。

## 验证

实际镜像程序集检查均核对被加载 DLL 的哈希：

| 检查 | 旧镜像 | 修复镜像 | 证据 |
| --- | --- | --- | --- |
| 登录许可投影，包括扩展位、其他消息和截断消息 | 0/8 | 8/8 | [proxy 对照](correction/source-group-proxy/evidence.json) |
| 隔离 MySQL 的建角、保存及原生重读，覆盖两种许可的全部组合 | 1/8 | 8/8 | [存档对照](correction/source-group-storage/evidence.json) |

`tests/source-social.mjs` 通过网页注册三个一级、零金币角色，装备初始木剑和布衣，从实际出生点步行进入书店。它检查拒绝邀请、建队许可、仅队长可邀请、移除与重新邀请、三人群聊、解散、断线清队及许可开启/关闭后的重登，并保存桌面和手机截图。网页流程不注入物品、等级、金币或坐标。

[独立网页验证](correction/source-group-isolated/evidence.json)全部通过，三次实际书店入口及室内移动均由网页执行；无浏览器异常或失败资源请求。首次只修网页/proxy 的重登失败报告保留，不作为通过结果。

[正式三人组队验证](correction/source-group-production/evidence.json)同样通过全部流程，包括开启和关闭许可后的重登；另一次[正式三职业及仓库验证](correction/source-group-client-production/evidence.json)全部通过。最初与另一浏览器套件并行时的[登录失败](correction/source-group-production-login-failure/evidence.json)保留，后续专门排查的原生队列与回包问题见[并发登录](CONCURRENT_LOGIN.md)。

正式入口已更换客户端、proxy 和原生引擎。[原生部署记录](correction/source-group-native-deployment.json)核对正常保存及退出、三个账号/角色/内容库的备份、31 张表的记录哈希、原数据库实例及引擎存档卷保持。备份只在忽略目录保存。[部署哈希检查](correction/source-group-deployment-evidence.json)验证 30 个网页文件、7,339 个资源及全部正式地图，并记录实际实例更换，没有将新引擎记为原实例保持。

2026-10-07 的[并发登录修复镜像组队复验](correction/source-group-login-queue-isolated/evidence.json)再次通过上述全部网页流程。该镜像的[独立存档复验](correction/source-group-storage-login-queue/evidence.json)仍为 8/8；其数据通道及正式引擎更新记录见[并发登录](CONCURRENT_LOGIN.md)。

该并发修复镜像后续的[正式组队复验](correction/source-group-login-queue-production-reconnect-failure/evidence.json)在重登阶段超时，随后查实认证通道断线不重连及 LoginSrv 半包缓存串线。认证修复后的[隔离完整流程](correction/source-group-login-reconnect-isolated/evidence.json)和[正式完整流程](correction/source-group-login-reconnect-production/evidence.json)均通过十项检查。正式复验使用原失败的三名普通角色，保留原存档及许可状态，无离线修改；两次许可重登均成功。桌面与手机截图已检查，无页面异常、资源失败或意外浏览器断开。新旧 DLL 对照、真实心跳超时恢复及正式存档保留证据见[并发登录](CONCURRENT_LOGIN.md)。

```bash
MIR_GROUP_PROXY_BEFORE_IMAGE=旧proxy镜像 MIR_GROUP_PROXY_IMAGE=修复proxy镜像 npm run test:source-group-proxy
MIR_GROUP_STORAGE_BEFORE_IMAGE=旧引擎镜像 MIR_GROUP_STORAGE_ENGINE_IMAGE=修复引擎镜像 npm run test:source-group-storage
MIR_URL=http://127.0.0.1:18887 npm run test:source-social
```

镜像对照需保留对应旧镜像；存档检查创建临时隔离 MySQL，不连接正式角色库。网页账号凭据只保存在被忽略的 `.state/`，公开报告不包含密码。

本次范围不包含组队人数上限、经验分配、组队战斗、完整原组队对话框、面对面交易、行会和攻沙。组队窗口仍为上游通用布局；完整原版 1.76 目标继续未完成。
