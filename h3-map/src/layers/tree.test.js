import { describe, expect, it } from 'vitest'
import {
  MAX_DEPTH, allIds, createGroup, duplicateNode, effectiveLayers, findNode, flattenLayers, groupNodes, indentNode, insertNode, moveNode,
  moveSibling, outdentNode, pathOf, setAllExpanded, ungroup, visibleRows,
} from './tree.js'

const L = (id, extra = {}) => ({ kind: 'layer', id, name: id, type: 'point', sourceId: 's', visible: true, opacity: 1, style: { r: 1 }, ...extra })
const G = (id, children, extra = {}) => ({ kind: 'group', id, name: id, visible: true, opacity: 1, expanded: true, children, ...extra })
const ids = (tree) => flattenLayers(tree).map((l) => l.id)

describe('layer tree', () => {
  it('groups nodes in place, keeping order and not losing any node', () => {
    const tree = [L('a'), L('b'), L('c'), L('d')]
    const { tree: next, group } = groupNodes(tree, ['b', 'd'])
    expect(next.map((n) => n.id)).toEqual(['a', group.id, 'c'])
    expect(group.children.map((n) => n.id)).toEqual(['b', 'd'])
    expect(ids(next)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('ignores selected nodes already inside a selected group', () => {
    const tree = [G('g', [L('a')]), L('b')]
    const { tree: next, group } = groupNodes(tree, ['g', 'a', 'b'])
    expect(group.children.map((n) => n.id)).toEqual(['g', 'b'])
    expect(allIds(next).filter((x) => x === 'a')).toHaveLength(1)
  })

  it('ungroups, keeping the children where the group was', () => {
    const tree = [L('a'), G('g', [L('b'), L('c')]), L('d')]
    expect(ungroup(tree, 'g').map((n) => n.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves before / after / inside and refuses to move a group into itself', () => {
    const tree = [L('a'), G('g', [L('b')]), L('c')]
    expect(ids(moveNode(tree, 'c', 'a', 'before'))).toEqual(['c', 'a', 'b'])
    expect(ids(moveNode(tree, 'a', 'c', 'after'))).toEqual(['b', 'c', 'a'])
    const inside = moveNode(tree, 'c', 'g', 'inside')
    expect(findNode(inside, 'g').children.map((n) => n.id)).toEqual(['c', 'b'])
    expect(moveNode(tree, 'g', 'b', 'before')).toBe(tree)
    expect(moveNode(tree, 'g', 'g', 'inside')).toBe(tree)
    expect(ids(moveNode(tree, 'a', null, 'end'))).toEqual(['b', 'c', 'a'])
  })

  it('swaps siblings without leaving the parent', () => {
    const tree = [G('g', [L('a'), L('b')]), L('c')]
    expect(ids(moveSibling(tree, 'b', -1))).toEqual(['b', 'a', 'c'])
    expect(moveSibling(tree, 'a', -1)).toBe(tree)
  })

  it('indents into the group above and outdents below the parent', () => {
    const tree = [G('g', [L('a')]), L('b')]
    const indented = indentNode(tree, 'b')
    expect(findNode(indented, 'g').children.map((n) => n.id)).toEqual(['a', 'b'])
    expect(outdentNode(indented, 'a').map((n) => n.id)).toEqual(['g', 'a'])
    expect(indentNode(tree, 'g')).toBe(tree) // nothing above
  })

  it('limits nesting depth', () => {
    let tree = [L('x')]
    for (let i = 0; i < MAX_DEPTH + 2; i++) tree = [G(`g${i}`, tree)]
    const deepest = `g0`
    expect(insertNode(tree, L('y'), deepest, 'inside')).toBe(tree)
  })

  it('resolves visibility (AND) and opacity (product) through groups, bottom first', () => {
    const tree = [G('outer', [G('inner', [L('a', { opacity: 0.5 })], { opacity: 0.5 }), L('b')], { opacity: 0.8 }), L('c', { visible: false })]
    const eff = effectiveLayers(tree)
    expect(eff.map((l) => l.id)).toEqual(['c', 'b', 'a'])
    expect(eff.find((l) => l.id === 'a').opacity).toBeCloseTo(0.2)
    const hidden = effectiveLayers([G('g', [L('a')], { visible: false })])
    expect(hidden[0].visible).toBe(false)
  })

  it('duplicates a group deeply with fresh ids', () => {
    const tree = [G('g', [L('a'), G('h', [L('b')])])]
    const { tree: next, copy } = duplicateNode(tree, 'g')
    expect(next[0]).toBe(copy)
    expect(copy.name).toBe('g copy')
    const copied = allIds([copy])
    expect(copied.some((id) => ['g', 'a', 'h', 'b'].includes(id))).toBe(false)
    copy.children[0].style.r = 9
    expect(findNode(next, 'a').style.r).toBe(1)
  })

  it('collapsed groups hide their rows; path lists the ancestors', () => {
    const tree = [G('g', [G('h', [L('a')])])]
    expect(visibleRows(tree).map((r) => r.node.id)).toEqual(['g', 'h', 'a'])
    expect(visibleRows(setAllExpanded(tree, false)).map((r) => r.node.id)).toEqual(['g'])
    expect(pathOf(tree, 'a').map((g) => g.id)).toEqual(['g', 'h'])
    expect(createGroup('X').children).toEqual([])
  })
})
