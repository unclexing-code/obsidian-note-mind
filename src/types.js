export const createDefaultMindmap = () => ({
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
                note: "可以填写任务、引用、清单等内容。",
                children: []
            },
            {
                id: crypto.randomUUID(),
                title: "子主题 B",
                x: 460,
                y: 260,
                linkTarget: "",
                note: "设置链接后可跳转到其他导图文件或普通笔记。",
                children: []
            }
        ]
    }
});
//# sourceMappingURL=types.js.map