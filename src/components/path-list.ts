/**
 * Path List Component — Full Path Builder & Manager
 *
 * PATH BUILDING:
 *  1. "Add Path" button enters path-drawing mode
 *  2. User clicks nodes to build a multi-node path
 *  3. Each click extends the path; preview is shown live
 *  4. "Save Path" finalises and stores it
 *  5. "Cancel" discards the path in progress
 *
 * PATH LIST (sidebar):
 *  - Each saved path shown as colored bubble
 *  - Triple-pattern text per edge
 *  - Remove (✕) button per path
 *  - Focus (🔍) button to isolate path elements
 *  - Click to re-highlight + zoom
 *  - "Clear All" removes everything
 *
 * Usage:
 *   <path-list diagram="diagram"></path-list>
 */

import type { SchemaDiagram } from './schema-diagram';
import type { PathNode } from '../types';
import type { EdgePath, PathEdgeInfo } from '../algorithms/path-finder';
import { STYLE } from '../layout/styles';
import { getLocalName, escapeHtml } from '../iri/uri-utils';

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (m) return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
  return hex;
}

export class PathList extends HTMLElement {
  private root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display:block; }
        .pl-wrap { display:flex; flex-direction:column; gap:8px; font-family:system-ui,-apple-system,sans-serif; }

        /* ---- Mode controls ---- */
        .pl-mode { padding:8px; background:#f5f6f8; border-radius:6px; display:flex; flex-direction:column; gap:6px; }
        .mode-row { display:flex; gap:6px; }
        .mode-btn { flex:1; padding:6px 12px; font-size:12px; border:1px solid #d2d2d7;
                    border-radius:4px; background:#fff; cursor:pointer; text-align:center; }
        .mode-btn:hover { background:#f0f4ff; }
        .mode-btn.active { background:#0066cc; color:#fff; border-color:#0066cc; }
        .mode-hint { font-size:11px; color:#6e6e73; margin:0; }

        /* ---- In-progress path preview ---- */
        .pl-preview { padding:8px; background:#fffbe6; border:1px solid #ffe58f; border-radius:6px;
                      font-size:11px; display:none; }
        .pl-preview.show { display:block; }
        .pl-preview .preview-label { font-weight:600; margin-bottom:4px; color:#d48806; }
        .pl-preview .preview-nodes { font-family:'SF Mono',Monaco,monospace; font-size:10px;
                                     line-height:1.6; color:#333; white-space:pre-wrap; }
        .pl-preview .preview-actions { display:flex; gap:6px; margin-top:8px; }
        .pl-preview .preview-actions button { font-size:11px; padding:4px 10px; border:1px solid #d2d2d7;
                                              border-radius:4px; cursor:pointer; }
        .save-path-btn { background:#34a853 !important; color:#fff !important; border-color:#34a853 !important; }
        .save-path-btn:disabled { opacity:0.4; cursor:default !important; }
        .cancel-path-btn { background:#fff; }
        .undo-last-btn { background:#fff; }
        .undo-last-btn:disabled { opacity:0.4; cursor:default !important; }

        /* ---- Path items ---- */
        .pl-items { display:flex; flex-direction:column; gap:6px; }
        .pl-empty { padding:16px; text-align:center; font-size:12px; color:#999; }

        .path-bubble { position:relative; border-radius:6px; padding:8px 12px; cursor:pointer;
                       transition:box-shadow .15s; }
        .path-bubble:hover { box-shadow:0 2px 8px rgba(0,0,0,.1); }
        .path-header { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600;
                       padding-right:48px; }
        .path-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
        .path-meta { font-weight:400; font-size:10px; color:#6e6e73; margin-left:auto; }
        .path-triples { margin-top:4px; font-family:'SF Mono',Monaco,monospace; font-size:10px;
                        line-height:1.5; color:#333; white-space:pre-wrap; word-break:break-word; }
        .path-actions { position:absolute; top:4px; right:4px; display:flex; gap:2px; }
        .path-action-btn { width:20px; height:20px; border:none; border-radius:50%; cursor:pointer;
                           font-size:11px; display:flex; align-items:center; justify-content:center; padding:0; }
        .focus-btn { background:rgba(0,0,0,.06); color:#333; }
        .focus-btn.active { background:#0066cc; color:#fff; }
        .rm-btn { background:rgba(0,0,0,.06); color:#999; }
        .rm-btn:hover { background:#ffebee; color:#c00; }

        /* ---- Footer actions ---- */
        .pl-footer { display:flex; gap:6px; flex-wrap:wrap; }
        .footer-btn { font-size:11px; padding:4px 10px; border:1px solid #d2d2d7; border-radius:4px;
                      background:#fff; cursor:pointer; }
        .footer-btn:hover { background:#f0f0f2; }
        .footer-btn.primary { background:#0066cc; color:#fff; border-color:#0066cc; }
        .footer-btn.danger { border-color:#c00; color:#c00; }
        .footer-btn.danger:hover { background:#ffebee; }
      </style>

      <div class="pl-wrap">
        <!-- Mode controls -->
        <div class="pl-mode">
          <div class="mode-row">
            <button class="mode-btn add-path-btn">Add Path</button>
          </div>
          <p class="mode-hint">Click nodes in the diagram to build a path.</p>
        </div>

        <!-- In-progress preview -->
        <div class="pl-preview">
          <div class="preview-label">Building path…</div>
          <div class="preview-nodes"></div>
          <div class="preview-actions">
            <button class="save-path-btn" disabled>Save Path</button>
            <button class="undo-last-btn" disabled>↩ Undo</button>
            <button class="cancel-path-btn">Cancel</button>
          </div>
        </div>

        <!-- Saved paths list -->
        <div class="pl-items">
          <div class="pl-empty">No paths saved yet</div>
        </div>

        <!-- Footer actions -->
        <div class="pl-footer" style="display:none">
          <button class="footer-btn danger clear-all-btn">Clear All</button>
        </div>
      </div>
    `;

    this.bindEvents();
    this.listenToDiagram();
  }

  // ===========================================================================
  // Event binding
  // ===========================================================================

  private bindEvents(): void {
    // Add path
    this.root.querySelector('.add-path-btn')?.addEventListener('click', () => this.startAddPath());

    // Save path
    this.root.querySelector('.save-path-btn')?.addEventListener('click', () => this.saveCurrentPath());

    // Cancel path
    this.root.querySelector('.cancel-path-btn')?.addEventListener('click', () => this.cancelPath());

    // Undo last node
    this.root.querySelector('.undo-last-btn')?.addEventListener('click', () => this.undoLastNode());

    // Clear all
    this.root.querySelector('.clear-all-btn')?.addEventListener('click', () => {
      const diagram = this.getDiagram();
      if (diagram) { diagram.clearPaths(); }
      this.rebuild();
    });
  }

  private listenToDiagram(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    // When the diagram fires node-click while we're building a path
    diagram.addEventListener('node-click', ((e: CustomEvent) => {
      const state = diagram.getState();
      if (!state.isPathBuildingActive()) return;

      const node = e.detail as PathNode;
      state.addPathBuildingNode(node.id, node.uri, node.label);
      this.updatePreview();
    }) as EventListener);

    // Listen for externally-driven path changes
    diagram.addEventListener('paths-changed', () => {
      this.rebuild();
    });
  }

  // ===========================================================================
  // Path building mode
  // ===========================================================================

  private startAddPath(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    const state = diagram.getState();
    state.startPathBuilding();

    // Enter draw-path mode on the diagram
    diagram.enterPathDrawingMode();

    // UI updates
    const btn = this.root.querySelector<HTMLButtonElement>('.add-path-btn')!;
    btn.textContent = 'Building…';
    btn.classList.add('active');

    const preview = this.root.querySelector<HTMLElement>('.pl-preview')!;
    preview.classList.add('show');
    this.updatePreview();
  }

  private cancelPath(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    const state = diagram.getState();
    state.cancelPathBuilding();
    diagram.exitPathDrawingMode();

    const btn = this.root.querySelector<HTMLButtonElement>('.add-path-btn')!;
    btn.textContent = 'Add Path';
    btn.classList.remove('active');

    const preview = this.root.querySelector<HTMLElement>('.pl-preview')!;
    preview.classList.remove('show');
  }

  private undoLastNode(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;
    const state = diagram.getState();
    state.undoPathBuildingNode();
    this.updatePreview();
  }

  private updatePreview(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;
    const state = diagram.getState();
    const nodes = state.getPathBuildingNodes();

    const nodesDiv = this.root.querySelector<HTMLElement>('.preview-nodes')!;
    const saveBtn = this.root.querySelector<HTMLButtonElement>('.save-path-btn')!;
    const undoBtn = this.root.querySelector<HTMLButtonElement>('.undo-last-btn')!;

    if (nodes.length === 0) {
      nodesDiv.textContent = 'Click a node to start…';
      saveBtn.disabled = true;
      undoBtn.disabled = true;
      return;
    }

    undoBtn.disabled = false;
    saveBtn.disabled = nodes.length < 2;

    // Build preview text
    const schema = diagram.getSchema();
    const lines: string[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (i === 0) {
        lines.push(`[${n.label}]`);
      } else {
        const prev = nodes[i - 1];
        // Find ALL edge labels between prev and current in the schema
        const edgeLabels = this.findAllEdgeLabels(schema, prev.nodeUri, n.nodeUri);
        lines.push(`  —[${edgeLabels.join(', ')}]→`);
        lines.push(`[${n.label}]`);
      }
    }

    nodesDiv.textContent = lines.join('\n');
  }

  /**
   * Find ALL predicate labels connecting fromUri → toUri (outgoing)
   * and toUri → fromUri (incoming, shown with ← prefix).
   */
  private findAllEdgeLabels(
    schema: import('../types').CanonicalSchema | null,
    fromUri: string,
    toUri: string
  ): string[] {
    if (!schema) return ['?'];

    const labels: string[] = [];
    const seen = new Set<string>();

    // Check outgoing from fromUri → toUri
    const outTriples = schema.outgoing.get(fromUri) || [];
    for (const t of outTriples) {
      if (t.object === toUri && t.objectType === 'uri') {
        const lbl = t.predicateLabel || getLocalName(t.predicate);
        if (!seen.has(lbl)) { seen.add(lbl); labels.push(lbl); }
      }
    }

    // Check reverse edges: toUri → fromUri (only if different nodes)
    if (fromUri !== toUri) {
      const outTriples2 = schema.outgoing.get(toUri) || [];
      for (const t of outTriples2) {
        if (t.object === fromUri && t.objectType === 'uri') {
          const lbl = '←' + (t.predicateLabel || getLocalName(t.predicate));
          if (!seen.has(lbl)) { seen.add(lbl); labels.push(lbl); }
        }
      }
    }

    return labels.length > 0 ? labels : ['?'];
  }

  private saveCurrentPath(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;
    const state = diagram.getState();
    const nodes = state.getPathBuildingNodes();

    if (nodes.length < 2) return;

    // Walk the collected nodes pairwise and find shortest path between each
    // consecutive pair.  For each hop we also collect ALL predicate alternatives
    // so the SPARQL editor can offer dropdown selectors.
    const fullNodeUris: string[] = [];
    const fullEdges: PathEdgeInfo[] = [];
    const fullAlternatives: PathEdgeInfo[][] = [];

    const finder = diagram.getPathFinder();

    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i];
      const to = nodes[i + 1];

      const segmentPath = diagram.findShortestPath(from.nodeUri, to.nodeUri, { maxDepth: 10 });

      if (!segmentPath || segmentPath.edges.length === 0) {
        // No path found — add bare edge
        if (fullNodeUris.length === 0) fullNodeUris.push(from.nodeUri);
        fullNodeUris.push(to.nodeUri);
        const bareEdge: PathEdgeInfo = {
          source: from.nodeUri,
          target: to.nodeUri,
          predicate: '',
          isForward: true,
        };
        fullEdges.push(bareEdge);
        fullAlternatives.push([bareEdge]);
      } else {
        // Merge segment into full path
        if (fullNodeUris.length === 0) {
          fullNodeUris.push(...segmentPath.nodes);
        } else {
          fullNodeUris.push(...segmentPath.nodes.slice(1));
        }

        // For each hop in the segment, collect ALL edge alternatives
        for (let h = 0; h < segmentPath.edges.length; h++) {
          const selectedEdge = segmentPath.edges[h];
          fullEdges.push(selectedEdge);

          // Gather all predicates between this hop's source and target
          let hopAlternatives: PathEdgeInfo[] = [selectedEdge];
          if (finder) {
            const hopFrom = segmentPath.nodes[h];
            const hopTo = segmentPath.nodes[h + 1];
            // expandPathToEdgeVariants gives us all edge options for each pair
            const variants = finder.expandPathToEdgeVariants([hopFrom, hopTo]);
            if (variants.length > 0 && variants[0].edges.length > 0) {
              // Collect unique predicate edges from all variants
              const allEdges: PathEdgeInfo[] = [];
              const seenPreds = new Set<string>();
              for (const v of variants) {
                for (const e of v.edges) {
                  const key = `${e.predicate}_${e.isForward}`;
                  if (!seenPreds.has(key)) {
                    seenPreds.add(key);
                    allEdges.push(e);
                  }
                }
              }
              if (allEdges.length > 0) hopAlternatives = allEdges;
            }
          }
          fullAlternatives.push(hopAlternatives);
        }
      }
    }

    // Build label showing all edges when there's only one hop
    const label = `${nodes[0].label} → ${nodes[nodes.length - 1].label}`;

    const edgePath: EdgePath = {
      nodes: fullNodeUris,
      edges: fullEdges,
      length: fullEdges.length,
    };

    diagram.addPathFromEdgePath(edgePath, label, fullAlternatives);

    // Exit build mode
    this.cancelPath();
    this.rebuild();
  }

  // ===========================================================================
  // Saved paths display
  // ===========================================================================

  /** Refresh the path list. */
  refresh(): void { this.rebuild(); }

  private rebuild(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;
    const paths = diagram.getPaths();
    const state = diagram.getState();
    const container = this.root.querySelector('.pl-items')!;
    const footer = this.root.querySelector<HTMLElement>('.pl-footer')!;

    if (paths.length === 0) {
      container.innerHTML = '<div class="pl-empty">No paths saved yet</div>';
      footer.style.display = 'none';
      return;
    }

    footer.style.display = 'flex';
    const focusedIdx = state.getFocusedPathIndex();

    container.innerHTML = paths.map((p, i) => {
      const color = STYLE.highlightColors[p.colorIndex % STYLE.highlightColors.length];
      const lightBg = hexToRgba(color, 0.08);
      const borderColor = hexToRgba(color, 0.35);

      // Build triple-pattern text — show all alternatives per hop
      const tripleLines: string[] = [];
      if (p.edgeData && p.edgeData.length > 0) {
        for (let h = 0; h < p.edgeData.length; h++) {
          const e = p.edgeData[h];
          const subj = getLocalName(e.isForward ? e.source : e.target);
          const obj = getLocalName(e.isForward ? e.target : e.source);

          // If there are alternatives for this hop, show them all
          const alts = p.edgeAlternatives?.[h];
          if (alts && alts.length > 1) {
            const predLabels = alts.map(a => getLocalName(a.predicate || '?'));
            tripleLines.push(`${subj}  [${predLabels.join(' | ')}]  ${obj} .`);
          } else {
            const pred = getLocalName(e.predicate || '?');
            tripleLines.push(`${subj}  ${pred}  ${obj} .`);
          }
        }
      } else {
        tripleLines.push(p.label || `Path ${i + 1}`);
      }

      const nodeCount = p.nodeIds.length;
      const edgeCount = p.edgeData?.length ?? p.edgeIds.length;
      const altCount = p.edgeAlternatives
        ? p.edgeAlternatives.reduce((sum, alts) => sum + (alts.length > 1 ? alts.length : 0), 0)
        : 0;
      const isFocused = focusedIdx === i;

      return `
        <div class="path-bubble" data-idx="${i}"
             style="background:${lightBg}; border:1px solid ${borderColor}; border-left:4px solid ${color};">
          <div class="path-actions">
            <button class="path-action-btn focus-btn ${isFocused ? 'active' : ''}" data-idx="${i}" title="Focus">🔍</button>
            <button class="path-action-btn rm-btn" data-idx="${i}" title="Remove">✕</button>
          </div>
          <div class="path-header" style="color:${color};">
            <span class="path-dot" style="background:${color};"></span>
            ${escapeHtml(p.label || `Path ${i + 1}`)}
            <span class="path-meta">${nodeCount}n · ${edgeCount}e${altCount > 0 ? ` · ${altCount} alt` : ''}</span>
          </div>
          <div class="path-triples">${escapeHtml(tripleLines.join('\n'))}</div>
        </div>
      `;
    }).join('');

    // Bind events for path bubbles
    container.querySelectorAll<HTMLElement>('.path-bubble').forEach(bubble => {
      bubble.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.path-action-btn')) return;
        const idx = parseInt(bubble.dataset.idx!, 10);
        this.highlightAndZoomToPath(idx);
      });
    });

    container.querySelectorAll<HTMLElement>('.rm-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx!, 10);
        if (focusedIdx === idx) state.clearFocus();
        else if (focusedIdx > idx) state.setFocusedPath(focusedIdx - 1);
        diagram.removePath(idx);
        this.rebuild();
      });
    });

    container.querySelectorAll<HTMLElement>('.focus-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx!, 10);
        if (focusedIdx === idx) {
          state.clearFocus();
        } else {
          state.setFocusedPath(idx);
        }
        // Re-render to apply focus dimming
        diagram.getRenderer()?.updateHighlighting();
        this.rebuild();
      });
    });
  }

  // ===========================================================================
  // Highlight + zoom
  // ===========================================================================

  private highlightAndZoomToPath(index: number): void {
    const diagram = this.getDiagram();
    if (!diagram) return;
    const paths = diagram.getPaths();
    if (index < 0 || index >= paths.length) return;

    const path = paths[index];
    if (path.nodeIds.length > 0) {
      diagram.zoomToNode(path.nodeIds[0]);
    }
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private getDiagram(): SchemaDiagram | null {
    const id = this.getAttribute('diagram');
    return id ? document.getElementById(id) as SchemaDiagram | null : null;
  }
}

customElements.define('path-list', PathList);
