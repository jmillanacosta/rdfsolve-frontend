/**
 * Shapes Panel Component — SHACL Shape Builder
 *
 * Separate panel for interactive schema subsetting.
 * The user starts with ALL edges and removes unwanted ones.
 *
 * Features:
 *  - Search/filter bar for finding edges by subject, predicate, or object
 *  - Dual-table view: "Keeping" vs "Removed" with move buttons
 *  - Node browser: collapsible class list with per-class bulk remove
 *  - Bulk operations: remove by subject/predicate pattern
 *  - SHACL generation for subset or full schema
 *
 * Usage:
 *   <shapes-panel diagram="diagram"></shapes-panel>
 */

import type { SchemaDiagram } from './schema-diagram';
import type { DatasetSelector } from './dataset-selector';
import type { EdgeSpec } from '../sparql/shapes-client';
import { subsetSchema, generateShacl } from '../sparql/shapes-client';
import { getLocalName, escapeHtml } from '../iri/uri-utils';

// ── Edge descriptor ─────────────────────────────────────────────

interface ShapeEdge {
  edgeId: string;
  sourceUri: string;
  targetUri: string;
  predicate: string;
  predicateLabel: string;
}

// ── Component ───────────────────────────────────────────────────

export class ShapesPanel extends HTMLElement {
  private root: ShadowRoot;
  private active = false;

  /** All edges from the diagram (the full set). */
  private allEdges: Map<string, ShapeEdge> = new Map();

  /** Edge IDs the user has removed. */
  private removedIds: Set<string> = new Set();

  /** Current view: 'browse' | 'keeping' | 'removed' */
  private currentView: 'browse' | 'keeping' | 'removed' = 'browse';

  /** Current search filter text. */
  private filterText = '';

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.wireExternalEvents();
  }

  // ── Helpers ────────────────────────────────────────────────────

  private getDiagram(): SchemaDiagram | null {
    const id = this.getAttribute('diagram');
    return id ? (document.getElementById(id) as SchemaDiagram | null) : null;
  }

  private keptEdges(): ShapeEdge[] {
    return [...this.allEdges.values()].filter(e => !this.removedIds.has(e.edgeId));
  }

  private removedEdges(): ShapeEdge[] {
    return [...this.allEdges.values()].filter(e => this.removedIds.has(e.edgeId));
  }

  /** Match an edge against the current filter text. */
  private matchesFilter(e: ShapeEdge): boolean {
    if (!this.filterText) return true;
    const q = this.filterText.toLowerCase();
    return (
      getLocalName(e.sourceUri).toLowerCase().includes(q) ||
      getLocalName(e.targetUri).toLowerCase().includes(q) ||
      (e.predicateLabel || getLocalName(e.predicate)).toLowerCase().includes(q) ||
      e.sourceUri.toLowerCase().includes(q) ||
      e.predicate.toLowerCase().includes(q) ||
      e.targetUri.toLowerCase().includes(q)
    );
  }

  // ── External events ────────────────────────────────────────────

  private wireExternalEvents(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    diagram.addEventListener('shape-edge-toggle', ((ev: CustomEvent) => {
      const { edgeId } = ev.detail ?? {};
      if (edgeId && this.active) {
        this.toggleEdge(edgeId);
      }
    }) as EventListener);
  }

  // ── Render ─────────────────────────────────────────────────────

  private render(): void {
    this.root.innerHTML = /* html */`
<style>
  :host { display: block; font-family: system-ui, -apple-system, sans-serif; font-size: 12px; }
  *, *::before, *::after { box-sizing: border-box; }

  .sp { display: flex; flex-direction: column; gap: 8px; }

  /* ── Toggle button ── */
  .sp-toggle {
    padding: 8px 14px; font-size: 12px; font-weight: 600;
    border: 1px solid #bbb; border-radius: 6px;
    background: #fff; cursor: pointer; text-align: center;
    transition: background .15s, color .15s, border-color .15s;
  }
  .sp-toggle:hover { background: #f5f5f5; border-color: #999; }
  .sp-toggle.on { background: #333; color: #fff; border-color: #333; }

  .sp-hint { font-size: 11px; color: #888; margin: 0; line-height: 1.35; }

  /* ── Stats bar ── */
  .sp-stats {
    display: flex; gap: 12px; font-size: 11px; color: #555;
    padding: 6px 0; border-bottom: 1px solid #e8e8e8;
  }
  .sp-stats b { font-weight: 600; }
  .sp-stat-keep { color: #2a7d2a; }
  .sp-stat-rm   { color: #b33; }

  /* ── Tab bar ── */
  .sp-tabs {
    display: flex; border-bottom: 2px solid #e0e0e0;
  }
  .sp-tab {
    flex: 1; padding: 7px 0; font-size: 11px; font-weight: 600;
    border: none; background: none; cursor: pointer;
    color: #888; text-align: center; position: relative;
    transition: color .15s;
  }
  .sp-tab:hover { color: #333; }
  .sp-tab.active { color: #333; }
  .sp-tab.active::after {
    content: ''; position: absolute; bottom: -2px; left: 8px; right: 8px;
    height: 2px; background: #333; border-radius: 1px;
  }
  .sp-tab .sp-tab-count {
    font-size: 9px; font-weight: 700; color: #fff; padding: 1px 5px;
    border-radius: 8px; margin-left: 4px; min-width: 16px;
    display: inline-block; text-align: center;
  }
  .sp-tab .cnt-keep { background: #3a8a3a; }
  .sp-tab .cnt-rm   { background: #c44; }
  .sp-tab .cnt-all  { background: #888; }

  /* ── Search ── */
  .sp-search {
    width: 100%; padding: 6px 10px; font-size: 11px;
    border: 1px solid #ccc; border-radius: 4px;
    outline: none; transition: border-color .15s;
  }
  .sp-search:focus { border-color: #666; }
  .sp-search::placeholder { color: #aaa; }

  /* ── Edge lists ── */
  .sp-list {
    display: flex; flex-direction: column; gap: 2px;
    max-height: 36vh; overflow-y: auto;
  }
  .sp-row {
    display: flex; align-items: center; gap: 4px; padding: 3px 6px;
    border: 1px solid transparent; border-radius: 3px;
    font-size: 10.5px; font-family: 'SF Mono', Monaco, Consolas, monospace;
    transition: background .1s; cursor: default;
  }
  .sp-row:hover { background: #f0f0f0; }
  .sp-row .sp-s { color: #555; }
  .sp-row .sp-p { color: #222; font-weight: 600; }
  .sp-row .sp-o { color: #555; }
  .sp-row .sp-arr { color: #bbb; margin: 0 2px; flex-shrink: 0; }
  .sp-row .sp-lbl { flex: 1; display: flex; align-items: center; gap: 0; min-width: 0; overflow: hidden; }
  .sp-row .sp-lbl span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .sp-row-btn {
    width: 20px; height: 20px; flex-shrink: 0; border: none; border-radius: 3px;
    font-size: 12px; cursor: pointer; display: flex; align-items: center;
    justify-content: center; padding: 0; transition: background .1s, color .1s;
  }
  .sp-rm-btn  { background: #fee; color: #c44; }
  .sp-rm-btn:hover  { background: #fcc; color: #a00; }
  .sp-add-btn { background: #efe; color: #3a3; }
  .sp-add-btn:hover { background: #cfc; color: #080; }

  .sp-empty { padding: 20px; text-align: center; font-size: 11px; color: #aaa; }

  /* ── Browse: grouped by class ── */
  .sp-class-group { margin-bottom: 4px; }
  .sp-class-header {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    background: #f3f3f3; border: 1px solid #e4e4e4; border-radius: 4px;
    cursor: pointer; font-size: 11px; font-weight: 600; color: #333;
    user-select: none; transition: background .1s;
  }
  .sp-class-header:hover { background: #eaeaea; }
  .sp-class-header .sp-arrow { font-size: 9px; color: #999; transition: transform .15s; width: 10px; }
  .sp-class-header .sp-arrow.open { transform: rotate(90deg); }
  .sp-class-header .sp-class-stats { margin-left: auto; font-weight: 400; font-size: 10px; color: #888; }
  .sp-class-header .sp-class-rm-all {
    font-size: 10px; padding: 2px 6px; border: 1px solid #dbb; border-radius: 3px;
    background: #fff; color: #b44; cursor: pointer; margin-left: 4px;
  }
  .sp-class-header .sp-class-rm-all:hover { background: #fee; }
  .sp-class-header .sp-class-add-all {
    font-size: 10px; padding: 2px 6px; border: 1px solid #bdb; border-radius: 3px;
    background: #fff; color: #484; cursor: pointer; margin-left: 4px;
  }
  .sp-class-header .sp-class-add-all:hover { background: #efe; }
  .sp-class-edges { display: none; padding: 2px 0 2px 18px; }
  .sp-class-edges.open { display: flex; flex-direction: column; gap: 2px; }

  /* ── Action bar ── */
  .sp-actions { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 4px; border-top: 1px solid #e8e8e8; }
  .sp-btn {
    font-size: 11px; padding: 6px 12px; border: 1px solid #bbb;
    border-radius: 4px; background: #fff; cursor: pointer; transition: background .1s;
  }
  .sp-btn:hover { background: #f0f0f0; }
  .sp-btn.primary { background: #333; color: #fff; border-color: #333; }
  .sp-btn.primary:hover { background: #555; }
  .sp-btn:disabled { opacity: .35; cursor: default; pointer-events: none; }

  /* ── SHACL output ── */
  .sp-shacl { display: flex; flex-direction: column; gap: 6px; }
  .sp-shacl-label { font-size: 12px; font-weight: 600; color: #333; }
  .sp-shacl-box {
    width: 100%; min-height: 180px; max-height: 50vh; resize: vertical;
    font-family: 'SF Mono', Monaco, 'Courier New', monospace;
    font-size: 11px; line-height: 1.5; padding: 10px;
    border: 1px solid #ccc; border-radius: 6px;
    background: #fafafa; color: #333; white-space: pre; overflow: auto;
  }
  .sp-shacl-box.error { border-color: #d30000; color: #d30000; }
</style>

<div class="sp">
  <button class="sp-toggle" id="sp-toggle">Edit Shapes</button>
  <p class="sp-hint">
    Remove edges to define the intended schema subset.
    Click an edge on the diagram or use the lists below. Generate SHACL from the remaining edges.
  </p>

  <!-- Stats -->
  <div class="sp-stats" id="sp-stats"></div>

  <!-- Search -->
  <input class="sp-search" id="sp-search" type="text"
         placeholder="Filter by class, predicate, or object..." />

  <!-- View tabs: Browse | Keeping | Removed -->
  <div class="sp-tabs">
    <button class="sp-tab active" data-view="browse">
      Browse <span class="sp-tab-count cnt-all" id="cnt-all">0</span>
    </button>
    <button class="sp-tab" data-view="keeping">
      Keeping <span class="sp-tab-count cnt-keep" id="cnt-keep">0</span>
    </button>
    <button class="sp-tab" data-view="removed">
      Removed <span class="sp-tab-count cnt-rm" id="cnt-rm">0</span>
    </button>
  </div>

  <!-- Content area -->
  <div class="sp-list" id="sp-content">
    <div class="sp-empty">Load a schema and click "Edit Shapes" to begin.</div>
  </div>

  <!-- Actions -->
  <div class="sp-actions">
    <button class="sp-btn" id="sp-reset">Reset All</button>
    <button class="sp-btn primary" id="sp-shacl-btn" disabled>Get SHACL (subset)</button>
    <button class="sp-btn primary" id="sp-shacl-full" disabled>Get SHACL (full)</button>
  </div>

  <!-- SHACL output -->
  <div class="sp-shacl" id="sp-shacl-section" style="display:none">
    <span class="sp-shacl-label">SHACL Shapes (Turtle)</span>
    <textarea class="sp-shacl-box" id="sp-shacl-box" readonly></textarea>
  </div>
</div>
    `;

    this.wireInternalEvents();
  }

  // ── Internal events ────────────────────────────────────────────

  private wireInternalEvents(): void {
    const toggle = this.$<HTMLButtonElement>('sp-toggle')!;
    const search = this.$<HTMLInputElement>('sp-search')!;
    const resetBtn = this.$<HTMLButtonElement>('sp-reset')!;
    const shaclBtn = this.$<HTMLButtonElement>('sp-shacl-btn')!;
    const shaclFull = this.$<HTMLButtonElement>('sp-shacl-full')!;

    // Toggle mode
    toggle.addEventListener('click', () => {
      const diagram = this.getDiagram();
      if (!diagram) return;
      this.active = !this.active;
      if (this.active) {
        diagram.enterShapesMode();
        toggle.classList.add('on');
        toggle.textContent = 'Editing Shapes -- click edges to remove';
        this.initEdges();
      } else {
        diagram.exitToViewMode();
        toggle.classList.remove('on');
        toggle.textContent = 'Edit Shapes';
      }
    });

    // Search
    search.addEventListener('input', () => {
      this.filterText = search.value.trim();
      this.renderContent();
    });

    // Tabs
    this.root.querySelectorAll<HTMLButtonElement>('.sp-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentView = (btn.dataset.view as any) || 'browse';
        this.root.querySelectorAll('.sp-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        this.renderContent();
      });
    });

    // Reset
    resetBtn.addEventListener('click', () => {
      for (const id of this.removedIds) this.setEdgeVisual(id, 'normal');
      this.removedIds.clear();
      this.updateCounts();
      this.renderContent();
      const s = this.$('sp-shacl-section');
      if (s) (s as HTMLElement).style.display = 'none';
    });

    // SHACL
    shaclBtn.addEventListener('click', () => this.handleGetShacl(false));
    shaclFull.addEventListener('click', () => this.handleGetShacl(true));
  }

  private $<T extends HTMLElement>(id: string): T | null {
    return this.root.getElementById(id) as T | null;
  }

  // ── Edge management ────────────────────────────────────────────

  private initEdges(): void {
    this.allEdges.clear();
    this.removedIds.clear();
    const diagram = this.getDiagram();
    if (!diagram) return;

    for (const e of diagram.getAllVisibleEdges()) {
      this.allEdges.set(e.edgeId, { ...e });
    }
    this.updateCounts();
    this.renderContent();
  }

  private toggleEdge(edgeId: string): void {
    if (this.removedIds.has(edgeId)) {
      this.restoreEdge(edgeId);
    } else {
      this.removeEdge(edgeId);
    }
  }

  private removeEdge(edgeId: string): void {
    if (!this.allEdges.has(edgeId) || this.removedIds.has(edgeId)) return;
    this.removedIds.add(edgeId);
    this.setEdgeVisual(edgeId, 'deleted');
    this.updateCounts();
    this.renderContent();
  }

  private restoreEdge(edgeId: string): void {
    if (!this.removedIds.has(edgeId)) return;
    this.removedIds.delete(edgeId);
    this.setEdgeVisual(edgeId, 'normal');
    this.updateCounts();
    this.renderContent();
  }

  private removeBySubject(subjectUri: string): void {
    for (const e of this.allEdges.values()) {
      if (e.sourceUri === subjectUri && !this.removedIds.has(e.edgeId)) {
        this.removedIds.add(e.edgeId);
        this.setEdgeVisual(e.edgeId, 'deleted');
      }
    }
    this.updateCounts();
    this.renderContent();
  }

  private restoreBySubject(subjectUri: string): void {
    for (const e of this.allEdges.values()) {
      if (e.sourceUri === subjectUri && this.removedIds.has(e.edgeId)) {
        this.removedIds.delete(e.edgeId);
        this.setEdgeVisual(e.edgeId, 'normal');
      }
    }
    this.updateCounts();
    this.renderContent();
  }

  private setEdgeVisual(edgeId: string, state: 'normal' | 'deleted'): void {
    const diagram = this.getDiagram();
    if (!diagram) return;
    const svg = (diagram as any).diagramContainer?.querySelector('svg');
    if (!svg) return;
    const edgeEl = svg.querySelector(`[data-edge-id="${edgeId}"]`);
    if (!edgeEl) return;
    const path = edgeEl.querySelector('.edge-path') as SVGPathElement | null;
    const label = edgeEl.querySelector('.edge-label') as SVGTextElement | null;

    if (state === 'deleted') {
      if (path) {
        path.setAttribute('stroke', '#d44');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('stroke-dasharray', '4,4');
        path.setAttribute('opacity', '0.35');
      }
      if (label) {
        label.setAttribute('fill', '#d44');
        label.setAttribute('opacity', '0.35');
        label.style.textDecoration = 'line-through';
      }
    } else {
      if (path) {
        path.removeAttribute('stroke-dasharray');
        path.setAttribute('opacity', '1');
        path.setAttribute('stroke', '#999');
        path.setAttribute('stroke-width', '1.5');
      }
      if (label) {
        label.removeAttribute('opacity');
        label.setAttribute('fill', '#333');
        label.style.textDecoration = '';
      }
    }
  }

  // ── Counts ─────────────────────────────────────────────────────

  private updateCounts(): void {
    const total = this.allEdges.size;
    const rm = this.removedIds.size;
    const keep = total - rm;

    const stats = this.$('sp-stats');
    if (stats) {
      stats.innerHTML = total > 0
        ? `<span><b>${total}</b> total</span>`
          + `<span class="sp-stat-keep"><b>${keep}</b> keeping</span>`
          + `<span class="sp-stat-rm"><b>${rm}</b> removed</span>`
        : '';
    }

    const cntAll = this.$('cnt-all');
    const cntKeep = this.$('cnt-keep');
    const cntRm = this.$('cnt-rm');
    if (cntAll) cntAll.textContent = String(total);
    if (cntKeep) cntKeep.textContent = String(keep);
    if (cntRm) cntRm.textContent = String(rm);

    const shaclBtn = this.$<HTMLButtonElement>('sp-shacl-btn');
    const shaclFull = this.$<HTMLButtonElement>('sp-shacl-full');
    if (shaclBtn) shaclBtn.disabled = keep === 0;
    if (shaclFull) shaclFull.disabled = total === 0;
  }

  // ── Render content area ────────────────────────────────────────

  private renderContent(): void {
    const container = this.$('sp-content');
    if (!container) return;

    if (this.allEdges.size === 0) {
      container.innerHTML = '<div class="sp-empty">Load a schema and click "Edit Shapes" to begin.</div>';
      return;
    }

    switch (this.currentView) {
      case 'browse':  this.renderBrowse(container); break;
      case 'keeping': this.renderFlat(container, this.keptEdges(), 'keep'); break;
      case 'removed': this.renderFlat(container, this.removedEdges(), 'removed'); break;
    }
  }

  // ── Browse view: grouped by class ──────────────────────────────

  private renderBrowse(container: HTMLElement): void {
    // Group edges by source class
    const groups = new Map<string, { label: string; edges: ShapeEdge[] }>();
    for (const e of this.allEdges.values()) {
      if (!this.matchesFilter(e)) continue;
      if (!groups.has(e.sourceUri)) {
        groups.set(e.sourceUri, { label: getLocalName(e.sourceUri), edges: [] });
      }
      groups.get(e.sourceUri)!.edges.push(e);
    }

    if (groups.size === 0) {
      container.innerHTML = '<div class="sp-empty">No edges match the filter.</div>';
      return;
    }

    // Sort classes alphabetically
    const sorted = [...groups.entries()].sort((a, b) =>
      a[1].label.localeCompare(b[1].label)
    );

    container.innerHTML = sorted.map(([uri, g]) => {
      const kept = g.edges.filter(e => !this.removedIds.has(e.edgeId)).length;
      const total = g.edges.length;
      const allRemoved = kept === 0;
      const allKept = kept === total;
      const classLabel = escapeHtml(g.label);

      const edgeRows = g.edges.map(e => {
        const removed = this.removedIds.has(e.edgeId);
        const pLabel = escapeHtml(e.predicateLabel || getLocalName(e.predicate));
        const oLabel = escapeHtml(getLocalName(e.targetUri));
        const btnClass = removed ? 'sp-row-btn sp-add-btn' : 'sp-row-btn sp-rm-btn';
        const btnTitle = removed ? 'Restore' : 'Remove';
        const btnIcon = removed ? '+' : '\u2715';
        const rowOpacity = removed ? 'opacity:.45;text-decoration:line-through;' : '';
        return `<div class="sp-row" style="${rowOpacity}" data-eid="${escapeHtml(e.edgeId)}">
          <span class="sp-lbl">
            <span class="sp-p">${pLabel}</span>
            <span class="sp-arr">&rarr;</span>
            <span class="sp-o">${oLabel}</span>
          </span>
          <button class="${btnClass}" data-action="${removed ? 'restore' : 'remove'}" data-eid="${escapeHtml(e.edgeId)}" title="${btnTitle}">${btnIcon}</button>
        </div>`;
      }).join('');

      // Show "remove all" or "restore all" based on state
      const bulkBtn = allRemoved
        ? `<button class="sp-class-add-all" data-bulk-restore="${escapeHtml(uri)}">restore all</button>`
        : allKept
        ? `<button class="sp-class-rm-all" data-bulk-rm="${escapeHtml(uri)}">remove all</button>`
        : `<button class="sp-class-rm-all" data-bulk-rm="${escapeHtml(uri)}">remove all</button>`
          + `<button class="sp-class-add-all" data-bulk-restore="${escapeHtml(uri)}">restore all</button>`;

      return `<div class="sp-class-group">
        <div class="sp-class-header" data-class-uri="${escapeHtml(uri)}">
          <span class="sp-arrow">&#x25B6;</span>
          ${classLabel}
          <span class="sp-class-stats">${kept}/${total}</span>
          ${bulkBtn}
        </div>
        <div class="sp-class-edges">${edgeRows}</div>
      </div>`;
    }).join('');

    this.wireContentButtons(container);
  }

  // ── Flat list views (keeping / removed) ────────────────────────

  private renderFlat(container: HTMLElement, edges: ShapeEdge[], mode: 'keep' | 'removed'): void {
    const filtered = edges.filter(e => this.matchesFilter(e));

    if (filtered.length === 0) {
      container.innerHTML = mode === 'keep'
        ? '<div class="sp-empty">All edges removed. Click "Reset All" to start over.</div>'
        : '<div class="sp-empty">No edges removed yet.</div>';
      return;
    }

    container.innerHTML = filtered.map(e => {
      const sLabel = escapeHtml(getLocalName(e.sourceUri));
      const pLabel = escapeHtml(e.predicateLabel || getLocalName(e.predicate));
      const oLabel = escapeHtml(getLocalName(e.targetUri));
      const btnClass = mode === 'keep' ? 'sp-row-btn sp-rm-btn' : 'sp-row-btn sp-add-btn';
      const btnAction = mode === 'keep' ? 'remove' : 'restore';
      const btnIcon = mode === 'keep' ? '\u2715' : '+';
      const btnTitle = mode === 'keep' ? 'Remove' : 'Restore';

      return `<div class="sp-row" data-eid="${escapeHtml(e.edgeId)}">
        <span class="sp-lbl">
          <span class="sp-s">${sLabel}</span>
          <span class="sp-arr">&rarr;</span>
          <span class="sp-p">${pLabel}</span>
          <span class="sp-arr">&rarr;</span>
          <span class="sp-o">${oLabel}</span>
        </span>
        <button class="${btnClass}" data-action="${btnAction}" data-eid="${escapeHtml(e.edgeId)}" title="${btnTitle}">${btnIcon}</button>
      </div>`;
    }).join('');

    this.wireContentButtons(container);
  }

  // ── Wire buttons inside content ────────────────────────────────

  private wireContentButtons(container: HTMLElement): void {
    // Per-edge action buttons
    container.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const eid = btn.dataset.eid!;
        if (btn.dataset.action === 'remove') this.removeEdge(eid);
        else this.restoreEdge(eid);
      });
    });

    // Bulk remove/restore per class
    container.querySelectorAll<HTMLButtonElement>('[data-bulk-rm]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.removeBySubject(btn.dataset.bulkRm!);
      });
    });
    container.querySelectorAll<HTMLButtonElement>('[data-bulk-restore]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.restoreBySubject(btn.dataset.bulkRestore!);
      });
    });

    // Collapsible class groups
    container.querySelectorAll<HTMLElement>('.sp-class-header').forEach(hdr => {
      hdr.addEventListener('click', (ev) => {
        // Don't toggle if a button inside was clicked
        if ((ev.target as HTMLElement).closest('button')) return;
        const arrow = hdr.querySelector('.sp-arrow');
        const edges = hdr.nextElementSibling;
        if (arrow && edges) {
          arrow.classList.toggle('open');
          edges.classList.toggle('open');
        }
      });
    });
  }

  // ── SHACL generation ───────────────────────────────────────────

  private async handleGetShacl(fullDiagram: boolean): Promise<void> {
    const schemaJsonld = this.getOriginalSchemaJsonld();
    if (!schemaJsonld) {
      this.showShacl('# Error: no schema loaded. Select a dataset first.', true);
      return;
    }

    const section = this.$('sp-shacl-section') as HTMLElement;
    const box = this.$<HTMLTextAreaElement>('sp-shacl-box');
    if (section) section.style.display = '';
    if (box) { box.value = '# Generating SHACL shapes...'; box.classList.remove('error'); }

    try {
      let targetJsonld: Record<string, unknown>;

      if (fullDiagram) {
        targetJsonld = schemaJsonld;
      } else {
        const keepEdges: EdgeSpec[] = this.keptEdges().map(e => ({
          subject: e.sourceUri,
          predicate: e.predicate,
          object: e.targetUri,
        }));
        targetJsonld = await subsetSchema(schemaJsonld, keepEdges) as unknown as Record<string, unknown>;
      }

      const result = await generateShacl(targetJsonld);
      if (result.error) {
        this.showShacl(`# Error: ${result.error}`, true);
      } else {
        this.showShacl(result.shacl, false);
      }
    } catch (err) {
      this.showShacl(`# Error: ${err}`, true);
    }
  }

  private showShacl(text: string, isError: boolean): void {
    const section = this.$('sp-shacl-section') as HTMLElement;
    const box = this.$<HTMLTextAreaElement>('sp-shacl-box');
    if (section) section.style.display = '';
    if (box) {
      box.value = text;
      box.classList.toggle('error', isError);
    }
  }

  /**
   * Get the raw JSON-LD from the dataset-selector (not reconstructed).
   */
  private getOriginalSchemaJsonld(): Record<string, unknown> | null {
    const selector = document.querySelector<DatasetSelector>('dataset-selector');
    if (!selector) return null;

    const loadedSchemas = selector.getLoadedSchemas();
    if (!loadedSchemas || loadedSchemas.size === 0) return null;

    const schemas = [...loadedSchemas.values()];
    if (schemas.length === 1) {
      return schemas[0] as Record<string, unknown>;
    }

    const mergedContext: Record<string, string> = {};
    const mergedGraph: Array<Record<string, unknown>> = [];
    for (const s of schemas) {
      const ctx = (s as any)['@context'];
      if (ctx && typeof ctx === 'object') Object.assign(mergedContext, ctx);
      const graph = (s as any)['@graph'];
      if (Array.isArray(graph)) mergedGraph.push(...graph);
    }
    return { '@context': mergedContext, '@graph': mergedGraph };
  }

  /** Refresh when a new schema is loaded. */
  refresh(): void {
    if (this.active) {
      this.initEdges();
    } else {
      this.allEdges.clear();
      this.removedIds.clear();
      const c = this.$('sp-content');
      if (c) c.innerHTML = '<div class="sp-empty">Load a schema and click "Edit Shapes" to begin.</div>';
      this.updateCounts();
    }
    const s = this.$('sp-shacl-section') as HTMLElement;
    if (s) s.style.display = 'none';
  }
}

customElements.define('shapes-panel', ShapesPanel);
