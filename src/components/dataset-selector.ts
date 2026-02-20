/**
 * Dataset Selector Component
 *
 * Self-contained web component that:
 * - Renders a multi-select dropdown of datasets (for diagram visualisation)
 * - Renders a second multi-select dropdown for "Mapping datasets" (probe targets)
 * - Loads JSON-LD files on "Render"
 * - Parses each schema individually so node colors can be tracked per-source
 * - Merges multiple schemas and feeds the result into a <schema-diagram>
 *
 * Usage:
 *   <dataset-selector diagram="diagram"></dataset-selector>
 *   <schema-diagram id="diagram"></schema-diagram>
 *
 * Configure datasets via JS:
 *   const sel = document.querySelector('dataset-selector');
 *   sel.setDatasets({
 *     wikipathways: { name: 'WikiPathways', url: './wikipathways_schema.jsonld', color: '#3380cc' },
 *   });
 */

import type { JSONLDSchema, CanonicalSchema } from '../types';
import type { SchemaDiagram } from './schema-diagram';
import { parseJSONLD } from '../parsers/jsonld-parser';

export interface DatasetEntry {
  name: string;
  url: string;
  color: string;
  about?: Record<string, unknown>;
}

export class DatasetSelector extends HTMLElement {
  /** All available datasets (both dropdowns can draw from this by default) */
  private datasets: Record<string, DatasetEntry> = {};
  /**
   * Separate dataset pool for the Mapping dropdown.
   * Falls back to `datasets` if not explicitly set (e.g. in demo mode where
   * there is no API to filter by strategy).
   */
  private mappingDatasets: Record<string, DatasetEntry> | null = null;
  private selected: Set<string> = new Set();
  private mappingSelected: Set<string> = new Set();
  private loadedSchemas: Map<string, JSONLDSchema> = new Map();
  private root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  connectedCallback(): void {
    this.renderUI();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Set available datasets. */
  setDatasets(datasets: Record<string, DatasetEntry>): void {
    this.datasets = datasets;
    this.renderUI();
  }

  /** Return the raw JSON-LD schemas that have been fetched so far. */
  getLoadedSchemas(): Map<string, JSONLDSchema> {
    return this.loadedSchemas;
  }

  /** Return the configured datasets (id → entry). */
  getDatasets(): Record<string, DatasetEntry> {
    return this.datasets;
  }

  /**
   * Override the dataset pool for the Mapping dropdown.
   * Call this with the filtered (miner-only) set from the API.
   * If never called, the Mapping dropdown shows the same list as Diagram.
   */
  setMappingDatasets(datasets: Record<string, DatasetEntry>): void {
    this.mappingDatasets = datasets;
    this.renderUI();
  }

  /** Return the IDs selected in the Mapping datasets dropdown. */
  getMappingDatasets(): string[] {
    return [...this.mappingSelected];
  }

  /** Programmatically select datasets and render. */
  async selectAndRender(ids: string[]): Promise<void> {
    this.selected = new Set(ids);
    this.syncSelect();
    await this.loadAndRender();
  }

  /**
   * Force a re-parse and re-render of the currently selected datasets.
   * Clears the schema cache so that changes in parsing settings
   * (e.g. namespace filters) take effect.
   */
  async reloadAndRender(): Promise<void> {
    // Clear cached parsed schemas so they get re-fetched and re-parsed
    this.loadedSchemas.clear();
    if (this.selected.size > 0) {
      await this.loadAndRender();
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate the tooltip HTML for a dataset's @about metadata.
   * Returns an empty string when `about` is undefined or empty.
   */
  private _aboutTooltip(about: Record<string, unknown> | undefined): string {
    if (!about || Object.keys(about).length === 0) return '';
    // Keys to skip — too verbose or already visible in the UI
    const SKIP = new Set(['generated_by', '@context']);
    const items = Object.entries(about)
      .filter(([k]) => !SKIP.has(k))
      .map(([k, v]) => {
        const val = Array.isArray(v)
          ? v.join(', ')
          : typeof v === 'object' ? JSON.stringify(v) : String(v);
        const safeKey = k.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeVal = String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<li><span class="tt-key">${safeKey}:</span> ${safeVal}</li>`;
      });
    if (items.length === 0) return '';
    return `<div class="ds-tooltip"><ul>${items.join('')}</ul></div>`;
  }

  private renderUI(): void {
    const entries = Object.entries(this.datasets);
    const mappingEntries = Object.entries(this.mappingDatasets ?? this.datasets);

    this.root.innerHTML = `
      <style>
        :host { display: contents; }
        .ds-wrap { display:flex; flex-direction:column; gap:6px; }
        .ds-row  { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }

        /* ── Shared dropdown styles ── */
        .ds-dd-wrap { position:relative; display:inline-block; }
        .ds-toggle {
          padding:5px 10px; font-size:12px; border:1px solid #d2d2d7; border-radius:4px;
          background:#fff; cursor:pointer; min-width:180px; text-align:left;
          display:flex; align-items:center; justify-content:space-between;
        }
        .ds-toggle .caret { font-size:10px; margin-left:6px; }
        .ds-dropdown {
          display:none; position:absolute; top:100%; left:0; z-index:1200;
          background:#fff; border:1px solid #d2d2d7; border-radius:4px;
          box-shadow:0 4px 12px rgba(0,0,0,.12); margin-top:2px;
          min-width:220px; max-width:360px; max-height:300px; flex-direction:column;
        }
        .ds-dropdown.open { display:flex; }
        .ds-search {
          padding:6px 8px; border:none; border-bottom:1px solid #eee;
          font-size:12px; outline:none; width:100%; box-sizing:border-box;
        }
        .ds-list { overflow-y:auto; flex:1; padding:4px 0; }
        .ds-item {
          display:flex; align-items:center; gap:6px; padding:5px 10px;
          font-size:12px; cursor:pointer; position:relative;
        }
        .ds-item:hover { background:#f0f4ff; }
        .ds-item input { margin:0; }
        .ds-item .ds-swatch {
          width:10px; height:10px; border-radius:50%; flex-shrink:0;
        }
        .ds-actions {
          display:flex; gap:6px; padding:6px 8px; border-top:1px solid #eee; justify-content:flex-end;
        }
        .ds-actions button { font-size:11px; padding:3px 10px; border:1px solid #ccc;
          border-radius:3px; background:#fff; cursor:pointer; }
        .ds-actions button:hover { background:#f0f0f2; }

        /* ── Render row controls ── */
        button.render-btn { font-size:12px; padding:5px 14px; border:1px solid #d2d2d7; border-radius:4px;
                 background:#0066cc; color:#fff; cursor:pointer; }
        button.render-btn:hover { background:#0055aa; }
        button.render-btn:disabled { opacity:.5; cursor:default; }
        .status { font-size:11px; color:#6e6e73; }

        /* ── Section labels ── */
        .ds-section-label {
          font-size:11px; font-weight:600; color:#444; min-width:110px; white-space:nowrap;
        }
        .ds-section-label.mapping { color:#6060aa; }

        /* ── @about tooltip ── */
        .ds-tooltip {
          display:none; position:absolute; left:calc(100% + 6px); top:0; z-index:1300;
          background:#1e1e2e; color:#e0e0f0; border-radius:6px;
          padding:8px 12px; font-size:11px; line-height:1.6;
          white-space:nowrap; pointer-events:none;
          box-shadow:0 4px 16px rgba(0,0,0,.3);
          max-width:320px; white-space:normal;
        }
        .ds-item:hover .ds-tooltip { display:block; }
        .ds-tooltip ul { margin:0; padding:0 0 0 14px; }
        .ds-tooltip li { margin:2px 0; }
        .ds-tooltip .tt-key { color:#9090c0; font-weight:600; }
      </style>
      <div class="ds-wrap">
        <!-- ── Row 1: Diagram dataset selector + Render ── -->
        <div class="ds-row">
          <span class="ds-section-label">Diagram datasets:</span>
          <div class="ds-dd-wrap" data-role="viz">
            <button class="ds-toggle viz-toggle">Select datasets <span class="caret">▾</span></button>
            <div class="ds-dropdown viz-dropdown">
              <input class="ds-search viz-search" type="text" placeholder="Search…" autocomplete="off" />
              <div class="ds-list viz-list">
                ${entries.map(([id, ds]) => `
                  <label class="ds-item" data-id="${id}">
                    <input type="checkbox" value="${id}" data-role="viz" />
                    <span class="ds-swatch" style="background:${ds.color}"></span>
                    <span>${ds.name}</span>
                    ${this._aboutTooltip(ds.about)}
                  </label>
                `).join('')}
              </div>
              <div class="ds-actions">
                <button class="ds-all-btn" data-target="viz">All</button>
                <button class="ds-none-btn" data-target="viz">None</button>
              </div>
            </div>
          </div>
          <button class="render-btn">Render</button>
          <span class="status"></span>
        </div>

        <!-- ── Row 2: Mapping dataset selector ── -->
        <div class="ds-row">
          <span class="ds-section-label mapping">Mapping datasets:</span>
          <div class="ds-dd-wrap" data-role="mapping">
            <button class="ds-toggle mapping-toggle">Select datasets <span class="caret">▾</span></button>
            <div class="ds-dropdown mapping-dropdown">
              <input class="ds-search mapping-search" type="text" placeholder="Search…" autocomplete="off" />
              <div class="ds-list mapping-list">
                ${mappingEntries.map(([id, ds]) => `
                  <label class="ds-item" data-id="${id}">
                    <input type="checkbox" value="${id}" data-role="mapping" />
                    <span class="ds-swatch" style="background:${ds.color}"></span>
                    <span>${ds.name}</span>
                    ${this._aboutTooltip(ds.about)}
                  </label>
                `).join('')}
              </div>
              <div class="ds-actions">
                <button class="ds-all-btn" data-target="mapping">All</button>
                <button class="ds-none-btn" data-target="mapping">None</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // ── Wire viz dropdown ──
    this.wireDropdown('viz', this.selected, (set) => { this.selected = set; });

    // ── Wire mapping dropdown ──
    this.wireDropdown('mapping', this.mappingSelected, (set) => { this.mappingSelected = set; });

    // ── Render button ──
    this.root.querySelector('.render-btn')?.addEventListener('click', () => this.loadAndRender());

    this.syncSelect();
  }

  /**
   * Wire a dropdown identified by `role` ('viz' | 'mapping').
   * The `selectedSet` is the current selection Set; `onUpdate` is called
   * with the new Set whenever checkboxes change.
   */
  private wireDropdown(
    role: 'viz' | 'mapping',
    selectedSet: Set<string>,
    onUpdate: (set: Set<string>) => void,
  ): void {
    const toggle    = this.root.querySelector<HTMLButtonElement>(`.${role}-toggle`)!;
    const dropdown  = this.root.querySelector<HTMLElement>(`.${role}-dropdown`)!;
    const search    = this.root.querySelector<HTMLInputElement>(`.${role}-search`)!;
    const list      = this.root.querySelector<HTMLElement>(`.${role}-list`)!;

    // Toggle open/close
    toggle.addEventListener('click', () => {
      dropdown.classList.toggle('open');
      if (dropdown.classList.contains('open')) search.focus();
    });

    // Close on outside click
    this.root.addEventListener('click', (e) => {
      const wrap = this.root.querySelector(`.ds-dd-wrap[data-role="${role}"]`);
      if (wrap && !wrap.contains(e.target as Node)) dropdown.classList.remove('open');
    });

    // Search filter
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll<HTMLElement>('.ds-item').forEach(item => {
        const text = item.textContent?.toLowerCase() ?? '';
        item.style.display = text.includes(q) ? '' : 'none';
      });
    });

    // All / None
    this.root.querySelectorAll<HTMLButtonElement>(`.ds-actions button[data-target="${role}"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const checked = btn.classList.contains('ds-all-btn') || btn.textContent?.trim() === 'All';
        list.querySelectorAll<HTMLInputElement>(`input[data-role="${role}"]`).forEach(cb => { cb.checked = checked; });
        const newSet = new Set<string>();
        if (checked) list.querySelectorAll<HTMLInputElement>(`input[data-role="${role}"]`).forEach(cb => newSet.add(cb.value));
        onUpdate(newSet);
        const poolSize = role === 'mapping'
          ? Object.keys(this.mappingDatasets ?? this.datasets).length
          : Object.keys(this.datasets).length;
        this.syncToggleLabel(toggle, newSet, poolSize, 'datasets');
        if (role === 'mapping') this.emitMappingChange();
      });
    });

    // Checkbox changes
    list.querySelectorAll<HTMLInputElement>(`input[data-role="${role}"]`).forEach(cb => {
      cb.addEventListener('change', () => {
        const newSet = new Set<string>();
        list.querySelectorAll<HTMLInputElement>(`input[data-role="${role}"]:checked`).forEach(c => newSet.add(c.value));
        onUpdate(newSet);
        const poolSize = role === 'mapping'
          ? Object.keys(this.mappingDatasets ?? this.datasets).length
          : Object.keys(this.datasets).length;
        this.syncToggleLabel(toggle, newSet, poolSize, 'datasets');
        if (role === 'mapping') this.emitMappingChange();
      });
    });
  }

  private syncToggleLabel(toggle: HTMLButtonElement, selected: Set<string>, total: number, noun: string): void {
    const count = selected.size;
    toggle.innerHTML = count === 0
      ? `Select ${noun} <span class="caret">▾</span>`
      : `${count} of ${total} ${noun} <span class="caret">▾</span>`;
  }

  private emitMappingChange(): void {
    this.dispatchEvent(new CustomEvent('mapping-datasets-change', {
      detail: { datasets: [...this.mappingSelected] },
      bubbles: true,
    }));
  }

  /** Read checkboxes and update the selected set + toggle button text. */
  private syncFromCheckboxes(): void {
    const cbs = this.root.querySelectorAll<HTMLInputElement>('.viz-list input[data-role="viz"]');
    this.selected.clear();
    cbs.forEach(cb => { if (cb.checked) this.selected.add(cb.value); });
    const toggle = this.root.querySelector<HTMLButtonElement>('.viz-toggle');
    if (toggle) this.syncToggleLabel(toggle, this.selected, cbs.length, 'datasets');
  }

  private syncSelect(): void {
    const cbs = this.root.querySelectorAll<HTMLInputElement>('.viz-list input[data-role="viz"]');
    cbs.forEach(cb => { cb.checked = this.selected.has(cb.value); });
    this.syncFromCheckboxes();
  }

  private setStatus(msg: string): void {
    const el = this.root.querySelector('.status');
    if (el) el.textContent = msg;
    this.dispatchEvent(new CustomEvent('status', { detail: msg }));
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  private async loadAndRender(): Promise<void> {
    if (this.selected.size === 0) {
      this.setStatus('Select at least one dataset');
      return;
    }

    const diagram = this.getDiagram();
    if (!diagram) { this.setStatus('Diagram element not found'); return; }

    const btn = this.root.querySelector<HTMLButtonElement>('.render-btn');
    if (btn) btn.disabled = true;

    try {
      // --- 1. Fetch raw JSON-LD for each selected dataset ---
      const rawSchemas: Array<{ id: string; jsonld: JSONLDSchema }> = [];
      for (const id of this.selected) {
        let jsonld = this.loadedSchemas.get(id);
        if (!jsonld) {
          const ds = this.datasets[id];
          if (!ds) continue;
          this.setStatus(`Loading ${ds.name}…`);
          const res = await fetch(ds.url);
          if (!res.ok) throw new Error(`HTTP ${res.status} loading ${ds.name}`);
          jsonld = (await res.json()) as JSONLDSchema;
          this.loadedSchemas.set(id, jsonld);
        }
        rawSchemas.push({ id, jsonld });
      }

      // --- 2. Parse each schema individually to collect subject URIs ---
      //        Build nodeColorMap (subjectURI → color) and schemaColorMap
      const nodeColorMap = new Map<string, string>();
      const schemaColorMap = new Map<string, { name: string; color: string }>();

      if (rawSchemas.length > 1) {
        for (const { id, jsonld } of rawSchemas) {
          const ds = this.datasets[id];
          const parsed: CanonicalSchema = parseJSONLD(jsonld);
          for (const uri of parsed.subjects) {
            // First-seen wins — keeps the color stable across re-renders
            if (!nodeColorMap.has(uri)) {
              nodeColorMap.set(uri, ds.color);
            }
          }
          schemaColorMap.set(id, { name: ds.name, color: ds.color });
        }
      }
      // For a single dataset there is nothing to distinguish, leave maps empty

      // --- 3. Merge raw JSON-LD (for the parser inside setData) ---
      const merged = this.mergeSchemas(rawSchemas.map(r => r.jsonld));

      // --- 4. Feed into diagram, passing color maps ---
      diagram.setData(merged, { nodeColorMap, schemaColorMap });

      const nodeCount = diagram.getNodeList().length;
      this.setStatus(`Loaded ${this.selected.size} dataset(s) — ${nodeCount} nodes`);

      this.dispatchEvent(new CustomEvent('schema-loaded', { detail: { schema: diagram.getSchema() } }));
    } catch (err) {
      this.setStatus(`Error: ${err}`);
      console.error('[DatasetSelector]', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private getDiagram(): SchemaDiagram | null {
    const target = this.getAttribute('diagram');
    if (!target) return null;
    return document.getElementById(target) as SchemaDiagram | null;
  }

  private mergeSchemas(schemas: JSONLDSchema[]): JSONLDSchema {
    if (schemas.length === 1) return schemas[0];
    const ctx: Record<string, string> = {};
    for (const s of schemas) {
      if (s['@context'] && typeof s['@context'] === 'object' && !Array.isArray(s['@context'])) {
        Object.assign(ctx, s['@context']);
      }
    }
    const nodeMap = new Map<string, unknown>();
    for (const s of schemas) {
      const nodes = s['@graph'] || (s['@id'] ? [s] : []);
      for (const n of nodes as Array<{ '@id': string; [k: string]: unknown }>) {
        if (!n['@id']) continue;
        const existing = nodeMap.get(n['@id']);
        if (existing && typeof existing === 'object') {
          Object.assign(existing, n);
        } else {
          nodeMap.set(n['@id'], { ...n });
        }
      }
    }
    return { '@context': ctx, '@graph': [...nodeMap.values()] as JSONLDSchema['@graph'] };
  }
}

customElements.define('dataset-selector', DatasetSelector);
