# Mindmap Notes

> An Obsidian plugin for standalone mindmaps with node-level Markdown notes, cross-file navigation, and mobile-first interaction design.

`Mindmap Notes` 是一个面向 Obsidian 的思维导图插件。它把导图作为独立文件来管理，并让每个节点既能承担结构化组织作用，也能承载 Markdown 笔记、链接跳转与跨导图导航。

## Overview

这个项目想解决的核心问题是：

- 思维导图适合组织结构
- Markdown 适合沉淀内容
- Obsidian 适合管理知识网络

`Mindmap Notes` 将三者结合起来，让你可以在 Obsidian 中：

- 用导图组织知识结构
- 用节点记录 Markdown 笔记
- 在导图、笔记、导图之间自由跳转
- 在桌面端和移动端都获得较顺滑的编辑体验

## Screenshots

你可以在这里补充截图：

- 导图总览
- 节点笔记抽屉
- 移动端浮动操作区
- 节点链接跳转示意

建议截图文件路径：

```text
assets/screenshots/mindmap-overview.png
assets/screenshots/mobile-actions.png
assets/screenshots/note-drawer.png
assets/screenshots/link-navigation.png
```

如果你还没有截图，可以先使用仓库内的模板文件：

- `SCREENSHOTS.md`

## Features

### Core Features

- Standalone mindmap files using `.mindmap`
- Legacy `.mindmap.json` compatibility
- Node-level Markdown notes
- Drawer-based note viewing and editing
- Node link targets for navigation
- Map-to-map and note-to-note jumping
- SVG-based mindmap rendering
- Inline node title editing
- Expand / collapse node branches
- Drag to reorder sibling nodes
- Drag to reparent nodes

### Mobile Features

- Floating action cluster in the bottom-right corner
- Lock / unlock mode for mobile interaction
- One-finger panning while locked
- Two-finger pinch zoom
- Double tap node to edit
- Collapse / expand tap support in locked mode
- Conditional mobile jump button when node has link
- Reduced accidental system side-swipe interference

### UX Details

- Linked node titles are visually marked
- Add / delete node sound feedback via Web Audio API
- Selected node highlight and drag emphasis
- Drawer note preview and edit mode switching
- Paste image into note and auto-save attachment

## Why This Plugin

相比传统“把思维导图嵌入笔记”的方式，这个插件更强调：

1. **独立文件化**：导图是正式文件，可被同步、版本管理与链接引用。
2. **节点内容化**：节点不是只有标题，还可以有完整 Markdown 笔记。
3. **导航网络化**：节点可跳转到其他导图或 Obsidian 笔记。
4. **移动端可用性**：不是桌面端功能的简单缩小版，而是专门适配手机交互。

## Use Cases

适用于以下场景：

- 知识结构梳理
- 课程 / 读书笔记导图
- 项目规划与任务分解
- 写作提纲与章节组织
- 多导图之间的知识导航网络
- 个人知识库中的结构化思考

## Tech Stack

### Language

- `TypeScript`
- `CSS`

### Platform

- `Obsidian Plugin API`

### Build Tools

- `esbuild`
- `TypeScript (tsc)`

### Rendering & Interaction

- `SVG` for nodes and edges
- `foreignObject` for inline node text editing
- `MarkdownRenderer` for note preview
- `Web Audio API` for lightweight UI sound effects

### Data & Persistence

- JSON-based mindmap document model
- Obsidian Vault API for file read/write
- Tree-based node structure and custom layout logic

## Project Structure

```text
obsidian-note-mind/
├── main.ts            # 插件入口、命令注册、视图注册、文件创建
├── src/
│   ├── view.ts        # 导图视图、交互逻辑、移动端适配、节点编辑
│   ├── store.ts       # 树结构操作、查找、排序、重挂载等逻辑
│   └── types.ts       # 类型定义与默认导图结构
├── styles.css         # 桌面端与移动端样式
├── manifest.json      # Obsidian 插件清单
├── package.json       # 构建脚本与依赖
├── esbuild.config.mjs # 打包配置
├── CHANGELOG.md       # 版本变更记录
├── SCREENSHOTS.md     # 截图与演示素材模板
├── main.js            # 构建产物
└── versions.json      # 版本兼容信息
```

## Data Model

每份导图文档是一个树结构，核心字段包括：

- `root`: 根节点
- `children`: 子节点数组
- `title`: 节点标题
- `note`: 节点 Markdown 笔记
- `linkTarget`: 节点链接目标
- `collapsed`: 是否折叠
- `x / y / width / height`: 布局与渲染信息

## Installation

### For Development

```bash
npm install
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Type Check

```bash
npm run check
```

### Manual Installation in Obsidian

将以下文件复制到你的 vault：

```text
.obsidian/plugins/obsidian-note-mind/
├── manifest.json
├── main.js
└── styles.css
```

然后在 Obsidian 社区插件中启用该插件。

## Usage

1. 启用插件
2. 执行命令 `Create a new mindmap file`
3. 创建并打开 `.mindmap` 文件
4. 新增、删除、拖拽、折叠节点
5. 双击节点进行标题编辑
6. 在右侧抽屉中编辑节点笔记与链接
7. 通过链接在导图与笔记之间跳转

## Commands

当前已提供命令：

- `Create a new mindmap file`
- `Open active mindmap in mindmap view`

## Roadmap

下面是适合继续迭代的方向：

- [ ] 更完整的 GitHub 发布说明与截图
- [ ] 节点快捷操作菜单增强
- [ ] 更多导图主题与样式配置
- [ ] 更细腻的移动端拖拽与排序体验
- [ ] 导图导出能力
- [ ] 搜索 / 定位节点能力
- [ ] 更丰富的链接类型与链接管理

## Development Notes

当前项目特征：

- 已具备完整导图编辑基本能力
- 已支持节点笔记与 Markdown 预览
- 已支持移动端浮动操作区与手势锁定
- 已具备跨导图 / 跨笔记跳转能力
- 目前仍处于早期可用版本，适合继续快速迭代

## Manifest

- Plugin ID: `mindmap-notes`
- Name: `Mindmap Notes`
- Version: `0.1.0`
- Min Obsidian Version: `1.4.0`
- Desktop only: `false`

## Author

- `zhoushengjia`

## License

MIT
