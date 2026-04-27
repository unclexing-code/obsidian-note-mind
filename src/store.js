"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.visibleEdges = exports.visibleNodes = exports.reorderNodeWithinParent = exports.reparentNode = exports.isDescendantNode = exports.removeNode = exports.addChildNode = exports.findParentOfNode = exports.findNodeById = exports.normalizeMindmapDocument = exports.walkNodes = void 0;
const walkNodes = (node, visitor, parent = null) => {
    visitor(node, parent);
    node.children.forEach((child) => (0, exports.walkNodes)(child, visitor, node));
};
exports.walkNodes = walkNodes;
const normalizeMindmapDocument = (doc) => {
    const normalized = {
        version: 1,
        root: doc.root,
        selfPath: doc.selfPath
    };
    (0, exports.walkNodes)(normalized.root, (node) => {
        if (typeof node.linkTarget !== "string") {
            const legacyLink = node.jumpToMap;
            node.linkTarget = typeof legacyLink === "string" ? legacyLink : "";
        }
    });
    return normalized;
};
exports.normalizeMindmapDocument = normalizeMindmapDocument;
const findNodeById = (doc, id) => {
    let found = null;
    (0, exports.walkNodes)(doc.root, (node) => {
        if (node.id === id) {
            found = node;
        }
    });
    return found;
};
exports.findNodeById = findNodeById;
const findParentOfNode = (doc, id) => {
    if (doc.root.id === id) {
        return null;
    }
    let output = null;
    (0, exports.walkNodes)(doc.root, (node) => {
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
exports.findParentOfNode = findParentOfNode;
const addChildNode = (doc, parentId, initialPosition) => {
    const parent = (0, exports.findNodeById)(doc, parentId);
    if (!parent) {
        return null;
    }
    const nextIndex = parent.children.length;
    const child = {
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
exports.addChildNode = addChildNode;
const removeNode = (doc, id) => {
    if (doc.root.id === id) {
        return null;
    }
    const lookup = (0, exports.findParentOfNode)(doc, id);
    if (!lookup) {
        return null;
    }
    const [removed] = lookup.parent.children.splice(lookup.index, 1);
    if (!removed) {
        return null;
    }
    return { removed, parent: lookup.parent };
};
exports.removeNode = removeNode;
const isDescendantNode = (ancestor, targetId) => {
    let found = false;
    (0, exports.walkNodes)(ancestor, (node) => {
        if (node.id === targetId) {
            found = true;
        }
    });
    return found;
};
exports.isDescendantNode = isDescendantNode;
const reparentNode = (doc, nodeId, nextParentId) => {
    if (doc.root.id === nodeId || nodeId === nextParentId) {
        return null;
    }
    const movingNode = (0, exports.findNodeById)(doc, nodeId);
    const nextParent = (0, exports.findNodeById)(doc, nextParentId);
    const currentParentLookup = (0, exports.findParentOfNode)(doc, nodeId);
    if (!movingNode || !nextParent || !currentParentLookup) {
        return null;
    }
    if ((0, exports.isDescendantNode)(movingNode, nextParentId)) {
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
exports.reparentNode = reparentNode;
const reorderNodeWithinParent = (doc, nodeId, targetIndex) => {
    const lookup = (0, exports.findParentOfNode)(doc, nodeId);
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
exports.reorderNodeWithinParent = reorderNodeWithinParent;
const visibleNodes = (root) => {
    const output = [];
    const walk = (node) => {
        output.push(node);
        if (!node.collapsed) {
            node.children.forEach(walk);
        }
    };
    walk(root);
    return output;
};
exports.visibleNodes = visibleNodes;
const visibleEdges = (root) => {
    const output = [];
    const walk = (node) => {
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
exports.visibleEdges = visibleEdges;
//# sourceMappingURL=store.js.map