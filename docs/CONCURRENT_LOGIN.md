# 原生并发登录修复

本次继续使用固定 Pixi H5 源码、配套 proxy 和 OpenMir2，没有新增游戏服务端实现。基础组队验证后，又通过三个普通网页角色同时进入游戏，查实原生登录请求队列及数据库回包处理的问题。

## 查实的问题

`WorldServer.ProcessHumans` 把处理过的请求下标放入 `LoadPlayerQueue`，却执行 `LoadPlayList.RemoveAt(i)`。这会删除其他未完成请求，并在同时处理多个请求时越界。修复按记录的实际下标倒序移除，保存在 `server/openmir2-login-queue.patch`。

只修队列后的[隔离网页测试仍失败](correction/source-concurrent-login-queue-only-failure/evidence.json)，并观察到 GameSrv 以 `SIGABRT` 退出，异常栈位于 `ThreadInt64PersistentCounter`。进一步检查发现 `DataQueryServer` 在存在前一片回包时，把网络池中整个 `ByteBlock.Buffer.Length` 复制进固定 20 KB 数组，而不是只复制有效字节，造成原生越界写入。错误也存在于修复前的正式引擎；不能将这个运行时异常当作队列修复后的通过结果。

`server/openmir2-data-channel.patch` 改用项目已有的 TouchSocket `PlayerDataFixedHeaderDataHandlingAdapter`，由库处理拆包和粘包。该分包器原先返回静态共享的可变消息对象，现改为每次创建独立对象。消息头和签名仍按现有协议校验。GameSrv 和 DBSrv 四个发送方法原先把六字节包头按整个消息长度复制，读取源数组外的内存；现改用有边界检查的数组复制，保持原消息字节。

## 原生对照

全部检查从实际镜像提取 DLL，核对编译检查程序实际加载的程序集哈希。数据库通道检查与回包模拟器只使用隔离容器中的 loopback TCP，不连接正式引擎或角色库。每个通道用例运行在独立容器，关闭 core dump。

| 检查 | 修复前 | 最终修复 | 证据 |
| --- | --- | --- | --- |
| 实际 `ProcessHumans`，四个请求中不同位置的完成/待处理组合 | 2/9 | 9/9 | [登录队列](correction/source-login-queue/evidence.json) |
| 实际数据库通道：请求字节、完整回包、粘包、包头/包体拆分、尾部半包、大批回包、拒绝错误签名、连接状态隔离 | 6/8 | 8/8 | [数据库通道](correction/source-data-channel/evidence.json) |
| 最终引擎的隔离 MySQL 建角、保存及原生重读，覆盖组队/传送许可全部组合 | 旧存档 1/8 | 8/8 | [存档复验](correction/source-group-storage-login-queue/evidence.json) |

大批回包用例是三个独立且签名正确的回包，每包的待编码内容为 9,000 字节，低于原编码器 10,000 字节上限；合并后在 18,000 字节处分片。旧 DLL 在两次独立对照中均以 `139` 退出，新 DLL 完整接收三个回包。这个测试直接证明旧通道存在内存破坏，不能仅凭浏览器错误栈断言所有历史异常都来自同一位置。

测试开发时遗漏锁、编码初始化及超过单包编码上限的三个作废报告保留在忽略的 `.runtime/reports/`，不作为修复前失败证据。上表只引用补齐原生初始化、遵守单包上限后的结果。

```bash
MIR_LOGIN_QUEUE_BEFORE_IMAGE=旧引擎 MIR_LOGIN_QUEUE_ENGINE_IMAGE=修复引擎 npm run test:source-login-queue
MIR_DATA_CHANNEL_BEFORE_IMAGE=仅队列修复引擎 MIR_DATA_CHANNEL_ENGINE_IMAGE=最终引擎 npm run test:source-data-channel
MIR_URL=http://127.0.0.1:18887 npm run test:source-concurrent-login
```

`tests/source-concurrent-login.mjs` 通过网页注册三个普通一级、零金币角色，各对应一个职业；同一轮同时点击进入，连续进行三轮，核对原生人物 ID、背包、地图及绘制就绪。失败的进入不重试，凭据只保存在忽略的 `.state/`。正式旧引擎的[失败结果](correction/source-concurrent-login-before/evidence.json)和只修队列引擎的失败结果均保留。

## 最终镜像与部署

并发修复引擎 `sha256:6ac84b5d5365c4f13be863918fc793dd527f948f7e3a1650abc0d0100c5cfd1a` 的[隔离三职业并发登录](correction/source-concurrent-login-isolated/evidence.json)已通过三轮。2026-10-07 的[隔离组队复验](correction/source-group-login-queue-isolated/evidence.json)也全部通过：三个普通角色经网页步行进入书店，检查邀请、移除、群聊、解散、断线及许可开启/关闭后的重登；无浏览器异常或资源失败，桌面与手机截图已检查。

2026-10-07 已将该镜像部署到正式入口。[原生部署记录](correction/source-login-queue-native-deployment.json)确认原生保存完成、正常退出、三个数据库及完整引擎存档备份，重启前后 31 张表的记录哈希一致。数据库、网页与 proxy 保持原实例，引擎更换为实测镜像并保留原存档卷；运行中的 GameSrv、M2Server 及 MySQL 存档 DLL 哈希与测试程序集一致。私有 SQL 和存档备份保存在忽略的 `.runtime/reports/login-queue-deployment/backup/`，公开报告只记录路径与哈希。

本页验证的是并发登录和原生数据传输，不证明完整 2003 年盛大 1.76 还原。完整版本目标继续未完成。

## 正式复验中的认证断线

上述镜像的[正式三职业并发登录](correction/source-concurrent-login-production/evidence.json)通过三轮，但后续[正式组队流程](correction/source-group-login-queue-production-reconnect-failure/evidence.json)在断线重登阶段超时。原日志随后记录 LoginSrv 因心跳超时关闭 GameSrv 的认证连接；GameSrv 清空授权，却没有重连机制。[同一进程的后续登录](correction/source-group-auth-disconnected/evidence.json)仍无法进入游戏。进程转储没有发现卡住的玩家处理线程，[只读健康对照](correction/source-login-reconnect-health-before.json)也确认原容器在认证连接缺失时仍返回 200。日志和转储不能确定当时首次超时的唯一触发点。

`server/openmir2-login-reconnect.patch` 为认证连接启用项目现用的 TouchSocket 被动断线重连插件，断线时同时清空旧半包。还修复 LoginSrv 的接收缓存错写：`SocketClientRead` 原先给所有连接赋值或清空 `ReceiveMsg`，现在只更新收到字节的那一条连接。两个问题都由实际镜像 DLL 的隔离检查复现，不以正式环境的超时直接推断根因。

| 检查 | 修复前基线 | 认证修复镜像 | 证据 |
| --- | --- | --- | --- |
| 初次授权、连续被动断线、新授权及旧授权失效、半包清理、主动关闭、连接缓存隔离 | 2/5 | 5/5 | [认证连接对照](correction/source-login-reconnect/evidence.json) |
| 实际请求队列 | 2/9 | 9/9 | [队列复验](correction/source-login-queue-reconnect/evidence.json) |
| 实际数据库通道 | 6/8 | 8/8 | [通道复验](correction/source-data-channel-reconnect/evidence.json) |
| 隔离 MySQL 建角、保存及重读 | 1/8 | 8/8 | [存档复验](correction/source-group-storage-login-reconnect/evidence.json) |

后三行的旧镜像分别为各错误的修复前基线，不是同一个镜像；每份报告记录实际镜像 ID 和所加载程序集的哈希。

引擎 `/health` 现在要求 GameSrv、DBSrv 与 LoginSrv 的两条认证连接、数据库通道和各网关后端连接实际建立。[真实心跳超时验证](correction/source-login-link-recovery/evidence.json)只暂停隔离临时栈的 GameSrv，等待原生 LoginSrv 关闭连接，确认健康响应从 200 变为 503；恢复 GameSrv 后，认证自动重连，健康响应恢复 200，容器 ID、启动时间与重启次数保持。它不认证所有游戏逻辑均能响应。

```bash
MIR_LOGIN_RECONNECT_BEFORE_IMAGE=并发修复引擎 MIR_LOGIN_RECONNECT_ENGINE_IMAGE=认证修复引擎 npm run test:source-login-reconnect
MIR_LOGIN_LINK_ENGINE_IMAGE=sha256:实测镜像哈希 npm run test:source-login-link-recovery
```

真实心跳测试只允许现有 `mir2-group-native` 隔离项目，并要求引擎及 MySQL 使用临时文件系统；无法通过它暂停正式引擎。网页组队测试现额外记录每次进入阶段、接收消息类型、页面崩溃和意外浏览器断开，保留失败诊断。

认证修复引擎 `sha256:6eedf853974926b78ee1fa31c7a3b02650b4c94ea1ec3e9eafcf1afcdf2be384` 的[隔离组队复验](correction/source-group-login-reconnect-isolated/evidence.json)通过全部十项检查，包括开启及关闭许可后的断线重登。桌面和手机截图已检查；网页测试未发生资源失败、页面异常或意外浏览器断开。

同一认证修复镜像的[隔离三职业同时进入](correction/source-concurrent-login-reconnect-isolated/evidence.json)也连续通过三轮，九次进入均未重试，无浏览器异常或失败资源请求。

2026-10-07 已将认证修复镜像更新到正式入口。[原生更新记录](correction/source-login-reconnect-native-deployment.json)确认原生保存及正常退出，备份三个数据库和引擎存档，重启前后 31 张表的保存记录哈希一致；数据库实例和原引擎存档卷保持，实际 GameSrv、LoginSrv、M2Server 及 MySQL 存档程序集哈希与隔离测试一致。私有备份保存在忽略的 `.runtime/reports/login-reconnect-deployment/backup/`。

更新后的[正式三职业同时登录](correction/source-concurrent-login-reconnect-production/evidence.json)通过三轮，九次进入均未重试，无浏览器异常或失败资源请求。[部署哈希复验](correction/source-login-reconnect-deployment-evidence.json)核对 30 个网页文件、7,339 个资源及全部实际地图，同时记录实测引擎更换、数据库实例和存档卷保持。

[正式组队复验](correction/source-group-login-reconnect-production/evidence.json)使用此前重登失败的三名角色，通过邀请、移除、群聊、解散、断线清队及许可开启/关闭后的重登全部十项检查。账号及角色均由原网页流程创建，本次使用保存的私有凭据重新登录，无离线修改存档。桌面与手机截图已检查，无页面异常、资源失败或意外浏览器断开。

完整 1.76 验收仍未通过；最新 `npm run audit:176 -- --check` 正常生成审计并返回退出码 1。当前正式开放 11 张地图及 33 种经典技能身份；完整世界、原版数值、完整三职业技能、交易、行会、攻沙和完整组队战斗仍未验收。
