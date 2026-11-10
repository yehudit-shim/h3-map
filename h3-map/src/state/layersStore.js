import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { createLayerConfig, forgetLayer, readProject, sanitizeTree, serializeProject, SCHEMA_VERSION } from '../layers/index.js'
import * as T from '../layers/tree.js'
import { migrateProject } from '../layers/project.js'
import { pruneUserSources, restoreSourceRefs, sourceRefsFor } from '../data/userSources.js'
import { useDataStore } from './dataStore.js'
import { useSelectionStore } from './selectionStore.js'

export const STORAGE_KEY = 'h3map.layers'

/** First-run layers so the map shows something meaningful (sample data, no database needed). */
export function createInitialLayers() {
  return [
    createLayerConfig('h3', 'sample-events', { name: 'H3 · Event intensity' }),
    createLayerConfig('line', 'sample-routes'),
    createLayerConfig('polygon', 'sample-districts', { opacity: 0.6 }),
  ]
}

/**
 * Every tree change goes through here so the derived flat list can never drift from the tree.
 * `layers` = layer configs in UI order (top first), groups flattened away.
 */
const withTree = (tree, extra = {}) => ({ tree, layers: T.flattenLayers(tree), ...extra })

function forgetSubtree(node) {
  for (const id of T.layerIdsOf(node)) forgetLayer(id)
}

/** Free user-loaded sources (and their cached data) that no layer in the tree uses any more. */
function pruneSources(tree) {
  const removed = pruneUserSources(T.flattenLayers(tree).map((l) => l.sourceId))
  if (removed.length) useDataStore.getState().forget(removed)
}

function clearSelectionIfGone(tree) {
  const sel = useSelectionStore.getState().selected
  if (sel && !T.findNode(tree, sel.layerId)) useSelectionStore.getState().clear()
}

/**
 * Layer tree in UI order: index 0 is the TOP node (drawn last). Nodes are plain serialisable JSON
 * (layer configs and groups, see layers/tree.js). The map draws `effectiveLayers(tree)`.
 *
 * - `activeId`: the node whose details/style are shown (layer or group).
 * - `selectedIds`: multi-selection in the manager (Ctrl/Cmd+click), used for grouping.
 * The tree is saved to localStorage automatically and restored on reload.
 */
export const useLayersStore = create(
  persist(
    (set, get) => {
      const commit = (tree, extra) => {
        if (tree === get().tree && !extra) return
        set(withTree(tree, extra))
      }
      const patch = (id, fn) => commit(T.mapNode(get().tree, id, fn))
      return {
        ...withTree(createInitialLayers()),
        activeId: null,
        selectedIds: [],

        // ---- selection in the manager ------------------------------------------------------
        setActive: (id) => set({ activeId: id, selectedIds: id ? [id] : [] }),
        /** Ctrl/Cmd+click: add or remove from the multi-selection. */
        toggleSelected: (id) =>
          set((s) => {
            const has = s.selectedIds.includes(id)
            const selectedIds = has ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
            return { selectedIds, activeId: has ? (selectedIds.at(-1) ?? null) : id }
          }),

        // ---- add / remove / duplicate / rename ----------------------------------------------
        addLayer: (typeId, sourceId, overrides) => {
          const layer = createLayerConfig(typeId, sourceId, overrides)
          commit([layer, ...get().tree], { activeId: layer.id, selectedIds: [layer.id] })
          return layer
        },
        /** Remove a layer or a whole group. */
        removeNode: (id) => {
          const { tree, removed } = T.removeNode(get().tree, id)
          if (!removed) return
          forgetSubtree(removed)
          const gone = new Set(T.allIds([removed]))
          const s = get()
          commit(tree, { activeId: gone.has(s.activeId) ? null : s.activeId, selectedIds: s.selectedIds.filter((x) => !gone.has(x)) })
          pruneSources(tree)
          clearSelectionIfGone(tree)
        },
        duplicateNode: (id) => {
          const { tree, copy } = T.duplicateNode(get().tree, id)
          if (!copy) return null
          commit(tree, { activeId: copy.id, selectedIds: [copy.id] })
          return copy
        },
        /** Point a layer at another source and layer type (e.g. GeoJSON -> vector tiles); the style restarts from the new type's defaults. */
        retargetLayer: (id, typeId, sourceId) => {
          const next = createLayerConfig(typeId, sourceId)
          forgetLayer(id)
          patch(id, (n) => (T.isLayer(n) ? { ...n, type: typeId, sourceId, style: next.style } : n))
          pruneSources(get().tree)
        },
        renameNode: (id, name) => {
          const trimmed = String(name ?? '').trim()
          if (!trimmed) return
          patch(id, (n) => (n.name === trimmed ? n : { ...n, name: trimmed }))
        },

        // ---- display properties (layers and groups) -----------------------------------------
        toggleVisible: (id) => patch(id, (n) => ({ ...n, visible: !n.visible })),
        setVisible: (id, visible) => patch(id, (n) => (n.visible === visible ? n : { ...n, visible })),
        setOpacity: (id, opacity) => patch(id, (n) => ({ ...n, opacity: Math.min(1, Math.max(0, Number(opacity) || 0)) })),
        updateStyle: (id, stylePatch) => patch(id, (n) => (T.isLayer(n) ? { ...n, style: { ...n.style, ...stylePatch } } : n)),

        // ---- ordering ---------------------------------------------------------------------
        /** direction -1 = towards the top of the list (drawn above), +1 = towards the bottom. Stays within the parent. */
        moveLayer: (id, direction) => commit(T.moveSibling(get().tree, id, direction)),
        /** Drag and drop. position: 'before' | 'after' | 'inside' | 'start' | 'end'. Returns false if refused. */
        moveNode: (id, targetId, position) => {
          const before = get().tree
          const next = T.moveNode(before, id, targetId, position)
          commit(next)
          return next !== before
        },
        indent: (id) => commit(T.indentNode(get().tree, id)),
        outdent: (id) => commit(T.outdentNode(get().tree, id)),

        // ---- groups -------------------------------------------------------------------------
        /** Group the given nodes (default: the multi-selection). With nothing selected, adds an empty group on top. */
        createGroup: (ids = get().selectedIds, name = 'New group') => {
          const s = get()
          if (!ids.length) {
            const group = T.createGroup(name)
            commit([group, ...s.tree], { activeId: group.id, selectedIds: [group.id] })
            return group
          }
          const { tree, group } = T.groupNodes(s.tree, ids, name)
          if (!group) return null
          commit(tree, { activeId: group.id, selectedIds: [group.id] })
          return group
        },
        ungroup: (id) => {
          const s = get()
          const tree = T.ungroup(s.tree, id)
          commit(tree, s.activeId === id ? { activeId: null, selectedIds: [] } : undefined)
        },
        toggleExpanded: (id) => patch(id, (n) => (T.isGroup(n) ? { ...n, expanded: !n.expanded } : n)),
        setAllExpanded: (expanded) => commit(T.setAllExpanded(get().tree, expanded)),

        // ---- save / restore -----------------------------------------------------------------
        exportProject: () => serializeProject(get().tree),
        /** Replace the tree with a project (object or JSON text). Throws on unreadable input; returns problems. */
        loadProject: (input) => {
          const { tree, problems } = readProject(input)
          for (const l of get().layers) forgetLayer(l.id)
          commit(tree, { activeId: null, selectedIds: [] })
          pruneSources(tree)
          useSelectionStore.getState().clear()
          return { problems, count: T.flattenLayers(tree).length }
        },
        /** Replace the tree directly (tests, programmatic setups). */
        setTree: (tree) => commit(tree, { activeId: null, selectedIds: [] }),
        resetLayers: () => {
          for (const l of get().layers) forgetLayer(l.id)
          const tree = createInitialLayers()
          commit(tree, { activeId: null, selectedIds: [] })
          pruneSources(tree)
          useSelectionStore.getState().clear()
        },

        // ---- Phase 1-2 names (kept so existing callers keep working) ------------------------
        removeLayer: (id) => get().removeNode(id),
        duplicateLayer: (id) => get().duplicateNode(id),
        renameLayer: (id, name) => get().renameNode(id, name),
      }
    },
    {
      name: STORAGE_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      // Only references to user-loaded data are saved (URL / file name / columns), never the data itself.
      partialize: (s) => ({ tree: s.tree, sources: sourceRefsFor(s.layers) }),
      migrate: (persisted, version) => {
        const m = migrateProject({ schemaVersion: version, layers: persisted?.tree ?? [], sources: persisted?.sources })
        return { tree: m.layers, sources: m.sources }
      },
      // Saved configs are validated: unknown types/sources are dropped and new style defaults filled in.
      merge: (persisted, current) => {
        if (!persisted || !Array.isArray(persisted.tree)) return current
        try {
          const sourceProblems = restoreSourceRefs(persisted.sources)
          const { tree, problems: layerProblems } = sanitizeTree(persisted.tree)
          const problems = [...sourceProblems, ...layerProblems]
          if (problems.length) console.warn('Some saved layers could not be restored:', problems)
          // Nothing usable left (e.g. a layer type was removed): keep the current layers rather than an empty map.
          if (persisted.tree.length && !tree.length) return current
          return { ...current, ...withTree(tree) }
        } catch (error) {
          console.warn('Saved layers could not be restored', error)
          return current
        }
      },
    },
  ),
)
