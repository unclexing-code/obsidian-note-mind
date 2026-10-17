import { App, Notice, TFolder, normalizePath } from "obsidian";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";

const ATTACHMENTS_DIR = "思维导图/attachments";

const extensionFromMime = (mime: string): string => {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
};

const saveImageFile = async (app: App, data: ArrayBuffer, ext: string): Promise<string> => {
  if (!(app.vault.getAbstractFileByPath(normalizePath(ATTACHMENTS_DIR)) instanceof TFolder)) {
    await app.vault.createFolder(ATTACHMENTS_DIR).catch(() => undefined);
  }
  const name = `收集箱-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const path = normalizePath(`${ATTACHMENTS_DIR}/${name}`);
  const file = await app.vault.createBinary(path, data);
  return file.path;
};

export interface LiveMarkdownEditor {
  view: EditorView;
  destroy: () => void;
}

export const createLiveMarkdownEditor = (
  app: App,
  container: HTMLElement,
  initialValue: string,
  onChange: (value: string) => void,
  extraExtensions: Extension[] = []
): LiveMarkdownEditor => {
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown({ base: markdownLanguage }),
        placeholder("输入内容（支持 Markdown，可直接粘贴图片）"),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChange(update.state.doc.toString());
        }),
        ...extraExtensions
      ]
    })
  });
  view.dom.addClass("mindmap-live-editor-view");

  view.dom.addEventListener("paste", (event) => {
    const clipboardEvent = event as ClipboardEvent;
    const files = clipboardEvent.clipboardData?.files;
    if (!files?.length) return;
    event.preventDefault();
    void (async () => {
      const links: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        try {
          const buffer = await file.arrayBuffer();
          const path = await saveImageFile(app, buffer, extensionFromMime(file.type));
          links.push(`![[${path}]]`);
        } catch (error) {
          new Notice(`图片保存失败：${error}`);
        }
      }
      if (links.length) {
        view.dispatch({ changes: { from: view.state.selection.main.to, insert: links.join("\n") } });
      }
    })();
  });

  return {
    view,
    destroy: () => view.destroy()
  };
};
