# DSH 0.2.1-rc.5 完整示例

[English](README.md) · [库的中文首页](../../README.zh-CN.md)

固定官方标签 `dsh-v0.2.1-rc.5` 和提交 `b830ec950faba0a46dda564be3e2d854afed94f1`。脚本只管理本仓库下的 `.dsh/runtime`；数据放在 `.dsh/data`，Electron 配置放在 `.dsh/electron-data`。不会搜索或改动已有的 DSH、Aione 安装。

## 安装、构建、启动

准备 Node 22.19 或更高版本，以及仓库指定的 pnpm 11.28.5。首次会下载 DSH 依赖、Electron 和 DSH 的工具运行时，需要网络和足够磁盘空间。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm dsh:prepare
pnpm dsh:build
pnpm dsh:check
pnpm dsh:start
```

如果验证的是尚未发布的包，先执行 `pnpm pack --pack-destination .artifacts`，然后使用：

```sh
pnpm dsh:prepare --package .artifacts/annotation-kit-0.1.0.tgz
```

也可以加上 `--source <干净的本地克隆目录>`，但其中必须存在固定标签和提交。这两种方式都通过正常包管理安装库，不引用 Aione 目录。

`prepare` 先核对提交和源码状态，再应用登记补丁、复制完整接入层、生成开发依赖路径并安装。`check` 核验基线、补丁指纹、所有登记源码和锁文件的哈希。有版本差异或未登记修改即停止，不自动覆盖。构建缓存与数据独立，日志在 `.dsh/runtime/.logs/annotation-kit`。

## 实际操作

1. 在示例中打开包含 [`examples/fixtures`](../fixtures) 的工作区。模型选择 **Annotation demo (local)**，先发送一条普通消息建立会话。演示模型只返回固定文字，无远程请求或工具调用；也可以自行按正常方式配置真实模型。
2. 在右侧浏览器打开自带演示网页，点击批注，选择元素或拖选区域，填写评论并保存。核对它进入普通草稿，带有原始截图。编辑、发送，再展开消息中的卡片。
3. 打开 `example.ts`、`notes.md`，选择文字并加入草稿。确认引用保留的是选择时的原文。
4. 打开 `launch-review.pdf`、`launch-review.docx`、`launch-review.pptx`，选择文字或页面区域，评论后保存。确认批注在文件独立批次中，普通草稿不变。再发送独立批次；PPT 普通文字的快捷请求会直接提交。
5. 打开 `launch-plan.xlsx`、`launch-plan.csv`，选择矩形单元格区域，评论、保存、查看原始值和公式，再发送。普通输入草稿应保留。
6. 在助手回复中选择正文，加入草稿并编辑评论；从引用卡片返回原始回复。
7. 留下一批未发送的文档批注，重启示例，打开同一会话和文件，核对评论、原文和图片恢复；也核对已发送卡片。

样例文件均为生成的演示材料。直接使用不需要安装生成工具。如需重新生成：安装 `reportlab python-docx python-pptx openpyxl`，运行 `python examples/fixtures/generate.py`。

在另一个终端运行 `pnpm fixtures:serve`，再在 DSH 浏览器打开 `http://127.0.0.1:4180/`。模型选择器先进入“模型”子菜单，即可看到本地演示模型。示例启动器设置 `ANNOTATION_KIT_LOCAL_DEMO=1`，让本地模型不依赖产品账号欢迎页；Host 的正常认证和网页所有权检查仍保留。不设置该标志的原版启动保持原有欢迎流程。

## 补丁具体负责什么

[配套补丁](patches/dsh-0.2.1-rc.5.patch) 增加浏览器工具栏与面板插槽、助手正文选区入口、结构化引用与消息呈现、图片接入、受控网页的原生截图桥。接入层通过标准 web-app bundle 注册。

继续使用 DSH 官方外壳、文件预览、Office 转换、浏览器权限与导航规则。不包含 MOM 登录、Aione 外壳、品牌或加载动画改动。应用主框架获得 `window.annotationKitDesktop`；被访问的网页只加载私有选取脚本，不获得应用 API。

原生截图要求应用窗口可见。补丁只验证固定 rc.5，其他版本应重新检查代码和行为。

## 撤销

先停止示例，再运行：

```sh
pnpm dsh:check
pnpm dsh:revert
```

撤销会先检查登记文件的哈希，再反向应用补丁、恢复原始锁文件，只移除脚本生成的接入目录。保留数据和构建缓存。若之后要运行官方原版，重新安装和构建。存在未登记修改时先自行导出，脚本不会覆盖。

这是带源码补丁的接入示例。普通开发者可以直接安装 npm 库；未经修改的 DSH 用户仍需上游提供对应扩展点，或自行使用此明确打过补丁的构建，不能把这个库直接当作官方市场插件安装。
