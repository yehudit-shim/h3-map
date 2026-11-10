// Pure operations on the layer tree. No React, no stores, no deck.gl.
//
// The tree is an array of nodes in UI order: index 0 is the TOP of the list and is drawn on top of
// everything below it. A node is either
//   layer: { kind: 'layer', id, name, type, sourceId, visible, opacity, style }
//   group: { kind: 'group', id, name, visible, opacity, expanded, children: Node[] }
// Groups nest. A group's visibility and opacity apply to everything inside it
// (effective visibility = AND along the path, effective opacity = product along the path).
//
// Every function returns new arrays/objects and never mutates its input (unchanged branches are shared).
import { createId } from '../lib/ids.js'

export const MAX_DEPTH = 6

export const isGroup = (n) => n?.kind === 'group'
export const isLayer = (n) => n?.kind === 'layer'

export function createGroup(name = 'New group', children = [], overrides = {}) {
  return { kind: 'group', id: createId('group'), name, visible: true, opacity: 1, expanded: true, children, ...overrides }
}

/** Depth-first walk in UI order. fn(node, parent, depth) */
export function walk(tree, fn, parent = null, depth = 0) {
  for (const n of tree) {
    fn(n, parent, depth)
    if (isGroup(n)) walk(n.children, fn, n, depth + 1)
  }
}

export function findNode(tree, id) {
  let found = null
  walk(tree, (n) => {
    if (!found && n.id === id) found = n
  })
  return found
}

/** { node, parent, siblings, index, depth } or null */
export function locate(tree, id, parent = null, depth = 0) {
  for (let i = 0; i < tree.length; i++) {
    const n = tree[i]
    if (n.id === id) return { node: n, parent, siblings: tree, index: i, depth }
    if (isGroup(n)) {
      const r = locate(n.children, id, n, depth + 1)
      if (r) return r
    }
  }
  return null
}

/** Ids from the root group down to the direct parent. */
export function ancestorIds(tree, id) {
  const out = []
  const visit = (nodes, path) => {
    for (const n of nodes) {
      if (n.id === id) {
        out.push(...path)
        return true
      }
      if (isGroup(n) && visit(n.children, [...path, n.id])) return true
    }
    return false
  }
  visit(tree, [])
  return out
}

/** True when `id` is inside the subtree of `ancestorId` (not equal to it). */
export function isDescendant(tree, ancestorId, id) {
  const a = findNode(tree, ancestorId)
  if (!isGroup(a)) return false
  return findNode(a.children, id) !== null
}

/** Layer configs in UI order (top first). */
export function flattenLayers(tree) {
  const out = []
  walk(tree, (n) => {
    if (isLayer(n)) out.push(n)
  })
  return out
}

export function allIds(tree) {
  const out = []
  walk(tree, (n) => out.push(n.id))
  return out
}

export function layerIdsOf(node) {
  return isGroup(node) ? flattenLayers(node.children).map((l) => l.id) : [node.id]
}

export function countNodes(tree) {
  let n = 0
  walk(tree, () => n++)
  return n
}

/** Nodes as the manager shows them: collapsed groups hide their children. */
export function visibleRows(tree) {
  const out = []
  const visit = (nodes, depth, parentId) => {
    for (const n of nodes) {
      out.push({ node: n, depth, parentId })
      if (isGroup(n) && n.expanded) visit(n.children, depth + 1, n.id)
    }
  }
  visit(tree, 0, null)
  return out
}

/**
 * Layers to draw, BOTTOM FIRST (deck.gl order), each with `visible` and `opacity` resolved through
 * their groups. Does not filter hidden layers; callers decide.
 */
export function effectiveLayers(tree) {
  const out = []
  const visit = (nodes, visible, opacity) => {
    for (const n of nodes) {
      const v = visible && n.visible
      const o = opacity * n.opacity
      if (isGroup(n)) visit(n.children, v, o)
      else out.push({ ...n, visible: v, opacity: o })
    }
  }
  visit(tree, true, 1)
  return out.reverse()
}

/** Replace a node by the result of fn(node). fn may return null to delete it. */
export function mapNode(tree, id, fn) {
  let changed = false
  const visit = (nodes) => {
    const next = []
    let touched = false
    for (const n of nodes) {
      if (n.id === id) {
        const r = fn(n)
        touched = true
        if (r) next.push(r)
        continue
      }
      if (isGroup(n)) {
        const children = visit(n.children)
        if (children !== n.children) {
          touched = true
          next.push({ ...n, children })
          continue
        }
      }
      next.push(n)
    }
    if (!touched) return nodes
    changed = true
    return next
  }
  const result = visit(tree)
  return changed ? result : tree
}

/** Replace a node by 0..n nodes in place (used for ungroup and grouping). */
export function replaceNode(tree, id, replacement) {
  const visit = (nodes) => {
    let touched = false
    const next = []
    for (const n of nodes) {
      if (n.id === id) {
        next.push(...replacement)
        touched = true
      } else if (isGroup(n)) {
        const children = visit(n.children)
        if (children !== n.children) {
          touched = true
          next.push({ ...n, children })
        } else next.push(n)
      } else next.push(n)
    }
    return touched ? next : nodes
  }
  return visit(tree)
}

export function removeNode(tree, id) {
  const found = findNode(tree, id)
  if (!found) return { tree, removed: null }
  return { tree: mapNode(tree, id, () => null), removed: found }
}

/** Depth of the deepest group nesting inside a node (a layer is 0). */
function subtreeHeight(node) {
  if (!isGroup(node)) return 0
  return 1 + node.children.reduce((m, c) => Math.max(m, subtreeHeight(c)), 0)
}

/**
 * Insert a node relative to a target.
 * position: 'before' (above the target in the list) | 'after' (below) | 'inside' (first child of a group)
 *           | 'end' (bottom of the root list; targetId ignored) | 'start' (top of the root list)
 * Returns the same tree when the insertion is invalid (unknown target, nesting too deep).
 */
export function insertNode(tree, node, targetId, position) {
  if (position === 'start') return [node, ...tree]
  if (position === 'end') return [...tree, node]
  const loc = locate(tree, targetId)
  if (!loc) return tree
  const depthAfter = (position === 'inside' ? loc.depth + 1 : loc.depth) + subtreeHeight(node)
  if (depthAfter >= MAX_DEPTH) return tree
  if (position === 'inside') {
    if (!isGroup(loc.node)) return tree
    return mapNode(tree, targetId, (g) => ({ ...g, expanded: true, children: [node, ...g.children] }))
  }
  const at = position === 'before' ? loc.index : loc.index + 1
  const place = (siblings) => [...siblings.slice(0, at), node, ...siblings.slice(at)]
  if (!loc.parent) return place(tree)
  return mapNode(tree, loc.parent.id, (g) => ({ ...g, children: place(g.children) }))
}

/**
 * Move a node. Refuses to move a node onto itself or into its own subtree.
 * Returns the same tree reference when the move is invalid or a no-op.
 */
export function moveNode(tree, id, targetId, position) {
  const node = findNode(tree, id)
  if (!node) return tree
  if (position !== 'end' && position !== 'start') {
    if (targetId === id || isDescendant(tree, id, targetId)) return tree
    if (!findNode(tree, targetId)) return tree
  }
  const { tree: without } = removeNode(tree, id)
  const next = insertNode(without, node, targetId, position)
  // insertNode returns its input unchanged when the target is invalid: detect by identity of the node
  return findNode(next, id) ? next : tree
}

/** Swap with the neighbouring sibling. direction -1 = up (towards the top), +1 = down. */
export function moveSibling(tree, id, direction) {
  const loc = locate(tree, id)
  if (!loc) return tree
  const to = loc.index + direction
  if (to < 0 || to >= loc.siblings.length) return tree
  const swap = (arr) => {
    const next = arr.slice()
    ;[next[loc.index], next[to]] = [next[to], next[loc.index]]
    return next
  }
  if (!loc.parent) return swap(tree)
  return mapNode(tree, loc.parent.id, (g) => ({ ...g, children: swap(g.children) }))
}

/** Deep copy with fresh ids. The root of the copy gets `name` (default: "<name> copy"). */
export function cloneNode(node, name) {
  const copy = structuredClone(node)
  const rename = (n, isRoot) => {
    n.id = createId(n.kind === 'group' ? 'group' : n.type)
    if (isRoot) n.name = name ?? `${n.name} copy`
    if (n.kind === 'group') for (const c of n.children) rename(c, false)
  }
  rename(copy, true)
  return copy
}

/** Duplicate a node and place the copy directly above the original. */
export function duplicateNode(tree, id) {
  const node = findNode(tree, id)
  if (!node) return { tree, copy: null }
  const copy = cloneNode(node)
  return { tree: insertNode(tree, copy, id, 'before'), copy }
}

/**
 * Wrap nodes in a new group placed where the top-most selected node was.
 * Nodes nested inside another selected node are ignored (they travel with their parent).
 * Returns { tree, group } (group null when nothing could be grouped).
 */
export function groupNodes(tree, ids, name = 'New group') {
  const wanted = new Set(ids)
  const top = []
  walk(tree, (n) => {
    if (!wanted.has(n.id)) return
    const covered = ancestorIds(tree, n.id).some((a) => wanted.has(a))
    if (!covered) top.push(n)
  })
  if (!top.length) return { tree, group: null }
  const group = createGroup(name, top)
  if (locate(tree, top[0].id).depth + subtreeHeight(group) >= MAX_DEPTH) return { tree, group: null }
  // Detach the other nodes first: once they are inside the new group, removing them by id would
  // also remove them from the group.
  let next = tree
  for (const n of top.slice(1)) next = removeNode(next, n.id).tree
  next = replaceNode(next, top[0].id, [group])
  return { tree: next, group }
}

/** Dissolve a group, keeping its children in place. */
export function ungroup(tree, id) {
  const g = findNode(tree, id)
  if (!isGroup(g)) return tree
  return replaceNode(tree, id, g.children)
}

export function setExpanded(tree, id, expanded) {
  return mapNode(tree, id, (n) => (isGroup(n) && n.expanded !== expanded ? { ...n, expanded } : n))
}

export function setAllExpanded(tree, expanded) {
  const visit = (nodes) => nodes.map((n) => (isGroup(n) ? { ...n, expanded, children: visit(n.children) } : n))
  return visit(tree)
}

/** Move a node into the group directly above it (as its last child). Keyboard "indent". */
export function indentNode(tree, id) {
  const loc = locate(tree, id)
  if (!loc || loc.index === 0) return tree
  const prev = loc.siblings[loc.index - 1]
  if (!isGroup(prev)) return tree
  if (loc.depth + 1 + subtreeHeight(loc.node) >= MAX_DEPTH) return tree
  const { tree: without } = removeNode(tree, id)
  return mapNode(without, prev.id, (g) => ({ ...g, expanded: true, children: [...g.children, loc.node] }))
}

/** Move a node out of its group, directly below the group. Keyboard "outdent". */
export function outdentNode(tree, id) {
  const loc = locate(tree, id)
  if (!loc?.parent) return tree
  return moveNode(tree, id, loc.parent.id, 'after')
}

/** Group ids along the path, root first, with names (for breadcrumbs). */
export function pathOf(tree, id) {
  return ancestorIds(tree, id).map((gid) => findNode(tree, gid))
}
