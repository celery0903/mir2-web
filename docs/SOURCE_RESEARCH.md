# 传统中文传奇 1.76 Web 源码调研

调研日期：2026-10-04。目标：接近传统中文 1.76、浏览器操作、Docker 部署、保留可二次开发的真实源码。

## 结论与采用路线

正式运行的纠正原型采用 **OpenMir2 服务端 + 自写原生 Web 客户端 + 候选经典素材**，完整 1.76 验收未通过。用户要求优先复用现成源码加 proxy 后，停止继续扩大自写客户端，改为独立验证现成 H5 客户端及其原协议网关；对应证据与接入差异见 [源码加 Proxy 核查](SOURCE_PROXY_EVALUATION.md)。游戏规则、怪物、技能、NPC 和存档继续由真实服务端处理。

没有找到经实测证明“完整原版 1.76、源码和素材授权齐全、Linux Docker 开箱即用”的整包。项目说明、功能列表和测试通过数不能代替实际联机验收。原版地图、素材、数值与代码许可需要分别记录。

## 候选比较

| 项目 | 已核实的源码与原版依据 | 二次开发与运行限制 |
| --- | --- | --- |
| [mirbeta/OpenMir2](https://github.com/mirbeta/OpenMir2) | C# 服务端、传统协议；README 明确与原 1.76 客户端配合使用 | MIT；选作服务端底座。兼容不代表国服内容与数值已逐项核对 |
| [fq393/mir2-web](https://github.com/fq393/mir2-web) | Cocos + Crystal，原 WIL/WIX 帧、800×600 界面和鼠标操作的核对最细；打包比奇与店铺共 9 张地图 | 顶层未声明许可证。主动施法仅火球、治愈；153 项测试通过，但默认 Cocos 构建依赖 macOS，不能称作完整可部署私服 |
| [leiniaozl229/mir2](https://github.com/leiniaozl229/mir2/tree/77e3ff7506b1ca55cac15df247cb2fcedd69c535) | Pixi + OpenMir2 + MySQL + WebSocket + Compose；技能、交易、仓库、行会接口较广；版本清单列 570 张地图 | 集成代码未声明许可证。32 项前端回归与前端、网关、服务端编译通过；原网关已实际接入隔离引擎完成注册至移动基础流程。含演示任务、训练 NPC 及需要过滤的后期数据；网页完整流程尚未实测 |
| [lzxsz/MIR2](https://github.com/lzxsz/MIR2/tree/98711dad31567d9a7e272956f6c5a2487000848b) | Delphi 客户端与 M2Server、登录及数据库服务，明确支持 1.5/1.76 数据 | GPL-3.0；最适合传统协议和客户端规则研究。需要 Windows/Delphi/BDE 及配套数据，改成原生网页成本高 |
| [jootm2/client](https://github.com/jootm2/client/tree/31ea8f00daafb1184ab9098dbfcc0ee2a4c76068) | JavaScript + Pixi，传统 WIL/WIX 和协议；实际游戏场景主要实现入图与角色显示 | Apache-2.0；适合作组件参考，未包含完整战斗、NPC、背包及服务端，资源地址依赖外部服务 |
| [SupermeCasino/JootM2ClientH5](https://github.com/SupermeCasino/JootM2ClientH5) | Java/GWT/libGDX 网页客户端、定制协议 | MIT；旧构建栈，缺完整配套服务端和资源，不作为主方案 |
| [fluttergo/mir2-client-js](https://github.com/fluttergo/mir2-client-js) | Egret；保留的 Basic/src 只有 47 个 TypeScript 文件，主要早期界面和移动演示 | 未声明许可证；README 的完整 MMORPG 和 Java 后端未在保留源码中核实，迁移地址无法获取 |
| [pyq0109/mirgo](https://github.com/pyq0109/mirgo) | Go 原生客户端方向，README 明确处于早期 | MIT；原生图形依赖，未验证浏览器目标，不当作现成 H5 私服 |
| [etorth/mir2x](https://github.com/etorth/mir2x) | C++ 原生客户端及服务端 | 明确以 1.45 为参考，不符合本项目的 1.76 与浏览器目标 |
| [jootnet/JootM2](https://github.com/jootnet/JootM2) | JavaScript 渲染、角色与 WIL 组件 | MIT；是渲染框架，缺完整游戏与后台 |

## 实测与可信范围

- Cocos 候选：安装完成，153 项自动测试通过；Linux 默认构建缺少 Cocos，脚本使用 `CocosCreator.app` 和 `ditto`。未通过浏览器全流程验收。
- Pixi/OpenMir2 候选：前端构建、32 项回归、.NET 8 服务端及 .NET 10 网关编译通过。初次独立 Docker 启动曾失败；随后复用未经修改的网关，在隔离 OpenMir2 引擎上完成真实注册、登录、建角、地图、能力、背包和移动检查。候选比奇图与当前图有 5761 个碰撞格差异，网页渲染与全系统仍待验证。
- 传统 Delphi 候选：源码与编译产物存在；缺匹配运行数据，Wine 测试未证明可玩。
- 多个所谓“H5 传奇源码”仓库仅提供下载说明，未提供真实源码，不列为部署候选。

## 1.76 还原边界

需逐项核对地图、怪物刷新、物品和掉落、三职业技能、升级经验、NPC 脚本、交易、仓库、行会和攻沙。后期英雄、刺客、商城和演示加速内容不能混入经典配置。

Cocos 候选记录了一个 2003 安装包；Pixi 候选记录的 `mir2setup2003.exe` 大小为 326778386 字节，SHA-256 为 `46e6cf029bd33f32b9977a4184b95d056a24ac32b60d03210a50e5251dcf4d42`，但没有可复现下载地址。这些记录只作为素材来源线索，不据此宣称整个部署已还原原版。

## 源码与素材来源

OpenMir2 的 MIT、Joot 客户端的 Apache-2.0/GWT 的 MIT 分别只覆盖相应代码。两个 Web 集成候选没有顶层许可，不能把它们的集成代码改标为本项目的开源代码。商业原素材权利独立于服务端或解码器的代码许可；导入路径、固定版本和校验值单独记录。

新实现的构建、实际浏览器流程、截图和重启存档结果记录在 [测试报告](VERIFICATION.md)。本报告不把尚未验证的能力计为交付完成。
