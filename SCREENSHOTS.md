# Screenshots Template

这个文件用于规划 GitHub README 中的截图、动图和演示素材。

## Recommended Assets

建议准备以下素材：

### 1. Mindmap Overview

- 文件名建议：`assets/screenshots/mindmap-overview.png`
- 内容建议：
  - 展示完整导图画布
  - 包含节点层级、连线、展开收起按钮
  - 最好能体现整体布局风格

推荐说明文案：

> Overview of the standalone mindmap canvas with hierarchical nodes and SVG connectors.

---

### 2. Note Drawer

- 文件名建议：`assets/screenshots/note-drawer.png`
- 内容建议：
  - 展示右侧笔记抽屉
  - 包含节点标题、链接输入、跳转按钮、Markdown 预览
  - 最好展示编辑态和预览态之一

推荐说明文案：

> Node-level Markdown note drawer with title editing, link target input, and live note content.

---

### 3. Mobile Action Cluster

- 文件名建议：`assets/screenshots/mobile-actions.png`
- 内容建议：
  - 展示移动端右下角浮动操作区
  - 包含新增、删除、跳转、笔记、居中、锁住等按钮
  - 尽量在真机或移动端模拟器中截取

推荐说明文案：

> Mobile floating action cluster designed for quick node operations and navigation.

---

### 4. Link Navigation

- 文件名建议：`assets/screenshots/link-navigation.png`
- 内容建议：
  - 展示节点带链接的状态
  - 展示跳转按钮或跨导图导航效果
  - 可截取跳转前后的两个画面

推荐说明文案：

> Linked nodes can jump to other mindmaps or regular Obsidian notes.

---

### 5. Mobile Locked Interaction

- 文件名建议：`assets/screenshots/mobile-locked-mode.png`
- 内容建议：
  - 展示移动端锁住模式
  - 强调单指平移、双指缩放、避免系统侧滑干扰

推荐说明文案：

> Locked mobile mode supports one-finger panning and two-finger zoom with reduced gesture conflicts.

---

## Optional GIF / Demo Ideas

如果你想做更强的展示，可以补充以下动图：

### A. Node Editing Demo

建议文件名：

```text
assets/demos/node-editing.gif
```

演示内容：

- 双击节点
- 进入标题编辑
- 修改标题
- 保存后节点自动更新

### B. Drag and Reorder Demo

建议文件名：

```text
assets/demos/drag-reorder.gif
```

演示内容：

- 拖拽节点
- 同级排序变化
- 拖拽到其他父节点下

### C. Mobile Navigation Demo

建议文件名：

```text
assets/demos/mobile-navigation.gif
```

演示内容：

- 锁住模式
- 单指平移
- 双指缩放
- 点击跳转按钮

## Suggested README Embeds

未来你可以在 `README.md` 中这样嵌入：

```md
## Screenshots

### Mindmap Overview
![Mindmap Overview](assets/screenshots/mindmap-overview.png)

### Note Drawer
![Note Drawer](assets/screenshots/note-drawer.png)

### Mobile Action Cluster
![Mobile Action Cluster](assets/screenshots/mobile-actions.png)
```

## Capture Tips

### Desktop

- 尽量使用一致的 Obsidian 主题
- 避免过多私人笔记内容暴露
- 保持节点标题简洁、易读
- 截图时尽量让导图处于整洁布局

### Mobile

- 优先使用真机截图
- 保证状态栏简洁
- 浮动操作区完整可见
- 如果要展示锁住模式，尽量让交互重点明确

## Suggested Asset Folder Layout

```text
assets/
├── screenshots/
│   ├── mindmap-overview.png
│   ├── note-drawer.png
│   ├── mobile-actions.png
│   ├── link-navigation.png
│   └── mobile-locked-mode.png
└── demos/
    ├── node-editing.gif
    ├── drag-reorder.gif
    └── mobile-navigation.gif
```
