export interface MindmapComment {
  id: string;
  text: string;
  comment: string;
  position?: number; // Deprecated, kept for backward compatibility
  length?: number;   // Deprecated, kept for backward compatibility
  footnoteId?: string; // New: unique footnote identifier like "c1", "c2"
  createdAt: number;
  updatedAt?: number;
}

export interface MindmapNode {
  id: string;
  title: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  manualSize?: boolean;
  collapsed?: boolean;
  note?: string;
  linkTarget?: string;
  comments?: MindmapComment[];
  children: MindmapNode[];
}

export interface MindmapDocument {
  version: 1;
  root: MindmapNode;
  selfPath?: string;
}

export const createDefaultMindmap = (): MindmapDocument => ({
  version: 1,
  root: {
    id: crypto.randomUUID(),
    title: "中心主题",
    x: 240,
    y: 200,
    collapsed: false,
    note: "这里支持 **Markdown** 笔记。",
    children: [
      {
        id: crypto.randomUUID(),
        title: "子主题 A",
        x: 460,
        y: 140,
        note: "暂无内容",
        children: []
      },
      {
        id: crypto.randomUUID(),
        title: "子主题 B",
        x: 460,
        y: 260,
        linkTarget: "",
        note: "暂无内容",
        children: []
      }
    ]
  }
});
