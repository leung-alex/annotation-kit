# 宿主接入说明

宿主就是引用这个库的应用。它管理会话、文件预览、输入草稿、附件、发送和来源导航；库管理批注的选区、快照、评论和界面。继续使用应用原来的 React 18 根节点。

## 1. 连接应用服务

实现 `ComposerBridge`：

| 方法或属性 | 应用需要做什么 |
| --- | --- |
| `hasTarget()` / `targetKey()` | 返回当前是否可添加批注，以及当前会话的稳定标识 |
| `subscribe(listener)` | 会话、草稿或可用能力变化时通知库；返回取消订阅函数 |
| `add(request)` | 校验目标会话和取消状态，把原文引用、评论和图片一起加入现有草稿 |
| `sendPages(request)` | 将文档或表格批次作为独立消息提交，不改动普通输入草稿 |
| `responses` | 读取、编辑、移除实际持久化的助手引用，以及聚焦草稿、打开来源 |
| `dispose()` | 释放应用接入层自己的资源 |

`request.expectedTarget` 是开始选取时的会话。提交前再次校验，防止把旧页面的选择放进刚切换的新会话。把 `AbortSignal` 传递给截图、图片写入、上传和提交。失败保留待处理内容；只有确认接收成功，发送函数才能成功返回。

如果服务端已经接收，但网络响应丢失，宿主必须先核对提交结果再重试。模型在接收成功之后生成失败，不能被当作“批注未提交”。库负责阻止同一个界面的并发操作和仅确认已接收的原批次；持久化提交的最终确认属于宿主。

可以直接运行的简洁实现见 [DemoHost](../examples/react/host.ts)。完整 DSH 适配见 [Composer 接入](../examples/dsh/plugin/src/client/composer/index.tsx)，包含草稿版本校验、附件回滚和会话保留。

## 2. 网页元素与区域

创建 `AnnotationsModel(截图桥, ComposerBridge, leaseOf)`，然后渲染 `AnnotationButton` 和 `AnnotationOverlay`。`BrowserSurfaceHandle` 提供页面标识、来源、视口元素 id、URL、可用状态和生命周期信号。

截图桥报告选区和文档版本，模型在保存时请求 PNG，随后把“原始选区＋评论＋原始图片”交给宿主。评论编辑框在应用中，访问的网页得不到应用草稿接口。

普通浏览器的[同文档示例](../examples/react/dom-surface.ts)通过 DOM 栅格化截图，只能处理应用自己拥有的内容。Electron 使用原生网页截图桥。

## 3. 代码、文本与 Markdown

`readFileSelection(range, root, kind)` 读取选区原文和位置。宿主补上来源地址与唯一 id，调用 `fileReference(snapshot)` 生成结构化引用；真正发送时调用 `serializeFileReference`。发送时使用已保存的快照，不重新读取可能已变化的文件。

`actionComponent(kind, bridge)` 为现有预览器提供选择后弹出的按钮。预览器需要提供：

- 外层的 `data-textpreview-url` 来源地址。
- 普通文本的 `data-textpreview-plain`、代码的 `data-code-preview`。
- 可确定来源行的 `data-textpreview-line`。
- Markdown 的原文块范围标记；无法证明原文与渲染块对应时不提供行号。

`contentId` 必须是完整来源 URI，不能只填写一个显示用页签 id。DSH 的 Markdown 包装继续使用 DSH 原来的解析和渲染器。

代码选区直接从 `pre code` 中的文本计算行列，不要求每行都有 `data-textpreview-line`；该行标记用于普通文本预览。

## 4. PDF、Word、PPT

预览器与 Office 转换由宿主提供。`pageActionComponent(bridge, batches)` 观察已有 DOM，不创建第二套预览器：

| 标记 | 含义 |
| --- | --- |
| `data-textpreview-url` | 源文件 URI |
| `data-pdf-page="1"` | 页码，从 1 开始 |
| 页内的 `data-pdf-text` | 可选取的文字层 |
| 页内的 canvas | 已渲染的页面像素，用于区域截图 |

通过 `DocumentWorkflow` 统一保存、移除、发送。`PageBatches` 把 JSON 快照写到宿主提供的 Storage，图片写到 `PageImageStore`，默认实现是 IndexedDB。先写图片再保存引用；恢复时核验图片；发送成功只移除这次提交的原始版本，期间产生的新编辑仍保留。

```ts
import { PageBatches, pageImageStore, DocumentWorkflow } from 'annotation-kit'
const images = pageImageStore('my-app-annotation-images')
const batches = new PageBatches(images, localStorage, 'my-app.annotations.v1')
const workflow = new DocumentWorkflow(bridge, batches)
// await workflow.commit(scope, { kind: 'batch', snapshot, image }, signal)
// await workflow.send(scope, signal)
```

`presentation-request` 仅接受 PPT 的普通文字请求，直接提交；该路径不能操作普通输入草稿。没有独立发送能力时，界面显示不可用原因，不回退到其他发送方式。

## 5. 表格

用 `spreadsheetSnapshot(address, format, sheet, selection, cells)` 固定工作表和单元格证据，保留显示值、原始值、公式和合并范围。不连续选区、超过限制的范围会被拒绝。

`SheetSurface` 接收宿主提供的稳定 FortuneSheet Workbook、解析后的工作表、工作簿 CSS 和布局类。表格解析、只读补丁和工作簿实例仍由宿主管理。完整示例见 [SheetBody](../examples/dsh/plugin/src/client/files/sheets/SheetBody.tsx)。`registerSpreadsheet` / `revealSpreadsheet` 供发送后卡片定位原始工作表及选区。

## 6. 助手回复

创建 `ResponseController`，注册实际渲染的回复节点和 `ResponseSource`，再挂载 `ResponseOverlay`。来源包含会话、消息节点、轮次、步骤、序号和原始块下标。只把助手正文交给该入口，工具、图片、推理和临时按钮不进入正文选区。

`bridge.responses` 必须操作输入草稿里真正持久化的引用，不能另建一个仅在窗口内存在的副本。通过 `ResponseCard` 定位来源、编辑评论；`responseReference` 和 `serializeResponseReference` 负责引用和发送格式。需要加载更早消息时，由宿主提供加载回调。

## 7. 发送后卡片

`SentAnnotations` 接收宿主自己的消息内容和附件类型。传入 `imageName`、`renderImage`、`renderText`、`renderDefault`，以及可选的打开来源方法。只匹配唯一、准确的截图文件名；普通消息和其他图片继续交给默认渲染器。未知版本返回 `fallback`。

`renderText` 应使用应用正常的用户文字渲染器，保留原有脱敏等规则。快照文字只作为数据展示，不执行 HTML、不作为隐藏指令。

## 8. Electron 原生接入

```ts
import { installDesktopAnnotations, renderAnnotationGuestPreload } from 'annotation-kit/electron'
const annotations = installDesktopAnnotations(policy, ipcMain, randomUUID, {
  channelPrefix: 'my-app', sourceOf: lease => 'browser',
})
const preload = renderAnnotationGuestPreload({ channelPrefix: 'my-app' })
```

`policy` 提供 `leases`、`owners`、`ownsApplicationFrame(event)`。每个受控页面包含 `id`、所属应用窗口 `owner`、网页 `guest` 和库管理的 `annotation` 状态。页面绑定、完整导航、同文档导航、销毁分别调用 `attached`、`navigation`、`disposed`。完整的版本相关接线见 [DSH 补丁](../examples/dsh/patches/dsh-0.2.1-rc.5.patch)。

把生成的字符串写成沙箱可用的 CJS 预加载脚本；只把它装到已经通过宿主所有权检查的网页。应用侧 API 仅暴露给应用主框架，不向访问的网页暴露 `ipcRenderer`。截图桥会核验 URL、坐标、文档版本和 PNG，等待标记绘制后截图，再次检查页面没有变化。

`AnnotationUiProvider` 可接入宿主自己的浮层与可交互窗口区域属性。全窗口浮层根节点不占用原生拖拽命中，只给实际按钮、表单等有界区域设置不可拖拽属性。Aione 使用自己的共享窗口区域组件；DSH 示例使用库的默认实现。
