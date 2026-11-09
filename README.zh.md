---
kind: package-library
description: 为 DSH 插件保留原始媒体字节并隔离会话引用。
---

# dsh-media-kit

## 摘要

为 DSH 插件提供原始媒体检查、原生附件逐字节存储和会话范围内的不透明引用。这是独立库，没有 bundle、GUI、模型客户端或应用启动器，不包含生产数据。

## 目录

- [媒体检查](#媒体检查)
- [原生存储](#原生存储)
- [会话引用](#会话引用)
- [消息原件](#消息原件)
- [示例](#示例)
- [验证与限制](#验证与限制)

## 媒体检查

`inspectOriginal` 在异步工作前复制输入，检测二进制签名，校验配置的 MIME、字节和尺寸限制，并对完整原件计算 SHA256。扩展名不决定格式；导出的字节副本不能修改已保留原件。图片头检查不等于完整解码或恶意文件检查；不缩放、旋转或重新压缩。

格式检测复用 [file-type](https://github.com/sindresorhus/file-type)，尺寸检测复用 [image-size](https://codeberg.org/image-size/image-size)。MIME 白名单填写 `audio/ogg` 等明确类型，检测结果中的编码参数仍会保留。没有二进制签名时，可明确声明有效 UTF-8 的纯文本、HTML 或 JSON。检查器拒绝不认识的二进制格式。需要保留未知编码时，Host 可显式调用 `createUnclassifiedOriginal` 并允许 `application/octet-stream`；结果标为未识别，不声称可播放或已验证格式。文本文件不会被执行。

## 原生存储

可选入口 `dsh-media-kit/dsh-attachments` 使用 DSH 公开的 `saveFileStream` 和 `readFileStream`。各种媒体都通过逐字节文件通道保存，不调用图片归一化。统一的内部文件名使不同展示名的相同字节复用原生对象，展示文件名另存于元数据。

`saveNativeOriginal` 返回带版本的 Host 回执。原生附件 ID 始终视为不透明值，不假设它等于无前缀哈希。`parseNativeOriginal` 校验持久化记录；`readNativeOriginal` 在返回原件前核对完整长度、哈希、签名和图片元数据，字节或尺寸记录不一致时失败。显式未识别原件只校验字节和标签，不推断编码。原生后端负责文件及保留期限；本库不推导路径，不直接打开或删除它的文件。错误仅返回稳定代码，不带后端路径和异常正文。

## 会话引用

可选入口 `dsh-media-kit/scoped-native` 提供 `ScopedNativeMedia`。消费插件必须绑定确切的认证会话，不能让模型自行选择。`register` 生成随机 256 位引用；跨会话或不存在的引用返回相同的未找到代码。公开视图不含后端和来源标识。配额覆盖引用数、唯一原件逻辑字节、租约和同时读取数；超限拒绝新工作，不驱逐其他引用。

读取前取得租约；有租约的引用不能撤销。释放只取消并等待自身读取，关闭先停止接收，再等所有租约读取结束，最后清理内存索引；不会删除原始附件。逻辑字节数不代表共享后端全部磁盘占用。

引用簿不拥有元数据数据库。消费插件须在向进程外暴露引用前，把 `exportGrant` 写入自己的所有者日志，并在重启后恢复可信记录。`restore` 不得作为模型或普通成员操作。请求身份与数据披露权限由消费插件验证，模型可见的引用和元数据必须记入该插件的 DSH 会话事件。本库不能防御恶意 Host 代码或拥有文件系统特权的用户。

## 消息原件

可选入口 `dsh-media-kit/im` 定义 `ImMediaRuntime` 及按账号绑定的提供方接口。提供方数量和在途操作容量均显式配置，超限直接拒绝而不排队。运行时只按完整可信账号路由，提供方进一步绑定会话；取消会拒绝迟到的成功结果。注销和关闭均取消并等待已受理操作结束，异常只返回稳定错误码，不自动重试。导入库不会创建运行时或提供方。

`dsh-media-kit/im-native` 在原生原件存储和范围引用簿上实现 `NativeImMediaProvider`。所属插件提供账号、已解析的存储与引用策略、日志写入器和此前保留的授权记录。仅在授权记录追加完成后返回句柄。恢复记录必须含精确且规范化的账号和会话范围；外来或格式错误的记录会在构建时拒绝。同一会话号的群聊与私聊仍严格区分。

消费插件负责持久化并保护日志，将模型可见的元数据写入 Session 事件，并检查向别处发送原件的权限。失败或取消的导入仍可能保留原生字节及未返回的引用元数据，包括日志追加结果不确定的情况。适配器不自动重试或删除这些数据。原生存储拥有保留策略，逻辑引用额度不等于其全部磁盘用量上限。

这些入口需要另装 `dsh-im-kit` 0.2.1 peer，原生入口还需要 DSH 附件接口。只含类型的 `dsh-media-kit/im-cordis` 在提供方插件通过 Cordis 效果贡献服务时声明 `ctx.imMedia`。根入口的媒体检查不需要这些可选入口；不会自动启用任何媒体提供方。

## 示例

```ts
import {inspectOriginal, resolveInspection, mediaProvider, mediaSource} from 'dsh-media-kit'
import {saveNativeOriginal, resolveNativeStorage} from 'dsh-media-kit/dsh-attachments'
import {ScopedNativeMedia, resolveReferences, mediaScope} from 'dsh-media-kit/scoped-native'

const policy = {
  maxBytes: 8 * 1024 * 1024, maxDetectorBuffer: 1024 * 1024,
  maxWidth: 8192, maxHeight: 8192, maxPixels: 32_000_000,
  allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'audio/wav'],
}
const inspection = resolveInspection(policy)
const storage = resolveNativeStorage({chunkBytes: 65536, maxReadBytes: policy.maxBytes, inspection: policy})
// bytes、signal、attachments 和 persistToOwnerJournal 由 Host 插件提供。
const original = await inspectOriginal(inspection, {
  bytes, fileName: 'incoming.jpg',
  source: {provider: mediaProvider('example'), id: mediaSource('input-1'), kind: 'received'},
}, signal)
const stored = await saveNativeOriginal(attachments, original, storage, signal)
const book = new ScopedNativeMedia(resolveReferences({
  maxReferences: 100, maxOriginalBytes: 64 * 1024 * 1024, maxLeases: 4, maxConcurrentReads: 2,
}), attachments, storage)
const owner = mediaScope('authenticated-account-and-conversation')
const reference = book.register(owner, stored)
await persistToOwnerJournal(book.exportGrant(owner, reference))
const lease = book.acquire(owner, reference)
try { const exactBytes = (await lease.read(signal)).copyBytes() } finally { await lease.release() }
await book.close()
```

此片段仅说明库接入，不是独立应用；DSH 应用仍通过 profile 启动。peer API 目标为 DSH 0.2.2-rc.1，原生入口要求对应附件能力。所有资源容量由消费方明确提供，不隐藏部署默认值。

## 验证与限制

本地 Node 22.19 和 Node 24 测试覆盖签名与后缀不一致、原件隔离副本、文本与 WAV、会话引用、容量与租约清理、真实原生附件服务重启、完整性失败、1080p/2K/4K PNG 和双帧 GIF。消息提供方还验证精确账号/会话绑定、持久授权恢复、原生多会话导入、日志保留期间的取消和关闭等待。原始字节均逐一比对；动图和大图均为生成的测试资料，不是用户图片。没有模型请求或 QQ 发信。

执行 `npm run test:consumer -- --im-kit-archive <dsh-im-kit-0.2.1.tgz>`，安装发行包并检查实际文件与严格 NodeNext 声明，同时挂载真实原生附件服务。本仓库定义 Windows/Linux × Node 22/24 CI，发行说明记录实际结果。离线实验室插件另行交付媒体适配；这些检查不能证明 OCR、人物识别、语音播放、完整视频解码或优于其他项目，尚未进行真实 QQ、桌面或竞品运行比较。

## 开发备注

本库不提供 profile 安装命令；消费插件声明依赖并选择所需公开入口。
