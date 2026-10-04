# 归档 1.76 升级补丁

在 [Internet Archive 的 ChuanQi2005 光盘](https://archive.org/details/ChuanQi2005) 找到包装标注“传奇（热血）1.76 版重装上阵客户端”的安装包。ISO 记录创建日期为 2004-08-23，归档另提供实物包装照片。它是包含多个传奇版本和私服工具的合辑，包装本身不能认证原版。

已完整下载 714,835,968 字节镜像，MD5 `a4720cda5ba84bfe7fd75b2ec17a90d5`、SHA-1 `3ca4396c3fbef1e353015bb929f4d20f073afe66` 与归档记录一致。新增锁固定 ISO、93,450,196 字节安装器及三个嵌入 Cabinet 的 SHA-256；只提取选定安装包，未执行安装器或导入合辑中的私服程序。[下载记录](correction/archived-client-download.json)与[解包记录](correction/archived-client-extraction.json)均保留。

安装器原 `setup.ini` 明确写着 `AppName=热血传奇1.76完整版升级补丁`、`CompanyName=上海盛大网络发展有限公司`。内含盛大《热血传奇》最终用户许可文本。7-Zip 提取 ISO 文件，按已固定安装器的精确嵌入范围取得数据，再由现成 unshield 解压 Cabinet。不是通过猜测文件尾部删改原始资源。

解压后只有 39 张地图、部分角色/怪物/物品/地图 WIL/WIX、Mir.update 和数据文件，缺少完整基础客户端。不能将此补丁当成找到的完整 `mir2setup2003.exe`，也没有因此标记原始完整客户端已取得。

[实际文件审计](archived-176-client-audit.json) 记录所有客户端文件哈希，并与候选目录比较：23 张地图完全一致，苍月岛 `5.map` 不同，15 张图未纳入目录。苍月岛差异包含 304 个地图单元，尚未据此替换候选地图或猜测传送与任务配置。

原 Objects3 有 9,229 帧，仍没有石墓四层所引用的第 9,799 帧。四个图库各抽取七帧核对原索引、几何和像素；28 个选取帧均未与现有转换 Lib 完全一致，部分几何一致，逐项哈希保留在审计中。该检查不覆盖全部图库帧，也未将扩展 Tiles 的 155,305 帧当成补丁原有的 7,910 帧。

安装包来源和内部标注提供了新的历史线索；缺少官方签名或同版本官方哈希，完整 2003 原包真实性仍未认证。原文件保留在 `.runtime/original-client-research`，本轮正式地图、素材和数据库没有替换。

复现需要 Node.js、7-Zip、unshield 和现有候选图库：

```bash
node scripts/fetch-archived-176-client.mjs
npm run audit:archived-client
```

下载及解包会严格核对 `shared/archived-176-client.lock.json` 的来源哈希，提取报告保存在该运行目录；核对报告写入 `docs/archived-176-client-audit.json`。
