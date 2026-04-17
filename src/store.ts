import type { MindmapDocument, MindmapNode } from "./types";

export const walkNodes = (
  node: MindmapNode,
  visitor: (current: MindmapNode, parent: MindmapNode | null) => void,
  parent: MindmapNode | null = null
): void => {
  visitor(node, parent);
  node.children.forEach((child) => walkNodes(child, visitor, node));
};

export const normalizeMindmapDocument = (doc: MindmapDocument): MindmapDocument => {
  const normalized: MindmapDocument = {
    version: 1,
    root: doc.root,
    selfPath: doc.selfPath
  };
  walkNodes(normalized.root, (node) => {
    if (typeof node.linkTarget !== "string") {
      const legacyLink = (node as MindmapNode & { jumpToMap?: string }).jumpToMap;
      node.linkTarget = typeof legacyLink === "string" ? legacyLink : "";
    }
  });
  return normalized;
};

export const findNodeById = (doc: MindmapDocument, id: string): MindmapNode | null => {
  let found: MindmapNode | null = null;
  walkNodes(doc.root, (node) => {
    if (node.id === id) {
      found = node;
    }
  });
  return found;
};

export interface ParentLookup {
  parent: MindmapNode;
  index: number;
}

export const findParentOfNode = (doc: MindmapDocument, id: string): ParentLookup | null => {
  if (doc.root.id === id) {
    return null;
  }

  let output: ParentLookup | null = null;
  walkNodes(doc.root, (node) => {
    if (output) {
      return;
    }
    const index = node.children.findIndex((child) => child.id === id);
    if (index >= 0) {
      output = { parent: node, index };
    }
  });
  return output;
};

export const addChildNode = (
  doc: MindmapDocument,
  parentId: string,
  initialPosition?: { x: number; y: number }
): MindmapNode | null => {
  const parent = findNodeById(doc, parentId);
  if (!parent) {
    return null;
  }

  const nextIndex = parent.children.length;
  const child: MindmapNode = {
    id: crypto.randomUUID(),
    title: `新节点 ${nextIndex + 1}`,
    x: initialPosition?.x ?? parent.x + 180,
    y: initialPosition?.y ?? parent.y + nextIndex * 72,
    children: []
  };
  parent.children.push(child);
  parent.collapsed = false;
  return child;
};

export const removeNode = (
  doc: MindmapDocument,
  id: string
): { removed: MindmapNode; parent: MindmapNode } | null => {
  if (doc.root.id === id) {
    return null;
  }
  const lookup = findParentOfNode(doc, id);
  if (!lookup) {
    return null;
  }

  const [removed] = lookup.parent.children.splice(lookup.index, 1);
  if (!removed) {
    return null;
  }
  return { removed, parent: lookup.parent };
};

export const isDescendantNode = (ancestor: MindmapNode, targetId: string): boolean => {
  let found = false;
  walkNodes(ancestor, (node) => {
    if (node.id === targetId) {
      found = true;
    }
  });
  return found;
};

export const reparentNode = (
  doc: MindmapDocument,
  nodeId: string,
  nextParentId: string
): { moved: MindmapNode; previousParent: MindmapNode; nextParent: MindmapNode } | null => {
  if (doc.root.id === nodeId || nodeId === nextParentId) {
    return null;
  }

  const movingNode = findNodeById(doc, nodeId);
  const nextParent = findNodeById(doc, nextParentId);
  const currentParentLookup = findParentOfNode(doc, nodeId);
  if (!movingNode || !nextParent || !currentParentLookup) {
    return null;
  }
  if (isDescendantNode(movingNode, nextParentId)) {
    return null;
  }
  if (currentParentLookup.parent.id === nextParentId) {
    return null;
  }

  const [detached] = currentParentLookup.parent.children.splice(currentParentLookup.index, 1);
  if (!detached) {
    return null;
  }
  nextParent.children.push(detached);
  nextParent.collapsed = false;
  return {
    moved: detached,
    previousParent: currentParentLookup.parent,
    nextParent
  };
};

export const reorderNodeWithinParent = (
  doc: MindmapDocument,
  nodeId: string,
  targetIndex: number
): { moved: MindmapNode; parent: MindmapNode; fromIndex: number; toIndex: number } | null => {
  const lookup = findParentOfNode(doc, nodeId);
  if (!lookup) {
    return null;
  }
  const siblings = lookup.parent.children;
  const boundedIndex = Math.max(0, Math.min(targetIndex, siblings.length - 1));
  if (boundedIndex === lookup.index) {
    return null;
  }
  const [moved] = siblings.splice(lookup.index, 1);
  if (!moved) {
    return null;
  }
  siblings.splice(boundedIndex, 0, moved);
  return {
    moved,
    parent: lookup.parent,
    fromIndex: lookup.index,
    toIndex: boundedIndex
  };
};

export const visibleNodes = (root: MindmapNode): MindmapNode[] => {
  const output: MindmapNode[] = [];
  const walk = (node: MindmapNode): void => {
    output.push(node);
    if (!node.collapsed) {
      node.children.forEach(walk);
    }
  };
  walk(root);
  return output;
};

export const visibleEdges = (root: MindmapNode): Array<{ from: MindmapNode; to: MindmapNode }> => {
  const output: Array<{ from: MindmapNode; to: MindmapNode }> = [];
  const walk = (node: MindmapNode): void => {
    if (node.collapsed) {
      return;
    }
    node.children.forEach((child) => {
      output.push({ from: node, to: child });
      walk(child);
    });
  };
  walk(root);
  return output;
};
