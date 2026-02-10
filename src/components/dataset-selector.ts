/**
 * Dataset Selector Component
 *
 * Self-contained web component that:
 * - Renders a multi-select dropdown of datasets
 * - Loads JSON-LD files on "Render"
 * - Merges multiple schemas
 * - Feeds the result into a <schema-diagram> element
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

import type { JSONLDSchema } from '../types';
import type { SchemaDiagram } from './schema-diagram';

export interface DatasetEntry {
  name: string;
  url: string;
  color: string;
}

export class DatasetSelector extends HTMLElement {
  private datasets: Record<string, DatasetEntry> = {};
  private selected: Set<string> = new Set();
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

  private renderUI(): void {
    const entries = Object.entries(this.datasets);

    this.root.innerHTML = `
      <style>
        :host { display: contents; }
        .ds-wrap { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
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
          font-size:12px; cursor:pointer;
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
        .ds-actions .ds-render-btn { background:#0066cc; color:#fff; border-color:#0066cc; }
        button.render-btn { font-size:12px; padding:5px 14px; border:1px solid #d2d2d7; border-radius:4px;
                 background:#0066cc; color:#fff; cursor:pointer; }
        button.render-btn:hover { background:#0055aa; }
        button.render-btn:disabled { opacity:.5; cursor:default; }
        .status { font-size:11px; color:#6e6e73; }
      </style>
      <div class="ds-wrap">
        <div class="ds-dd-wrap">
          <button class="ds-toggle">Select datasets <span class="caret">▾</span></button>
          <div class="ds-dropdown">
            <input class="ds-search" type="text" placeholder="Search…" autocomplete="off" />
            <div class="ds-list">
              ${entries.map(([id, ds]) => `
                <label class="ds-item" data-id="${id}">
                  <input type="checkbox" value="${id}" />
                  <span class="ds-swatch" style="background:${ds.color}"></span>
                  <span>${ds.name}</span>
                </label>
              `).join('')}
            </div>
            <div class="ds-actions">
              <button class="ds-all-btn">All</button>
              <button class="ds-none-btn">None</button>
            </div>
          </div>
        </div>
        <button class="render-btn">Render</button>
        <span class="status"></span>
      </div>
    `;

    // Toggle dropdown
    const toggle = this.root.querySelector<HTMLButtonElement>('.ds-toggle')!;
    const dropdown = this.root.querySelector<HTMLElement>('.ds-dropdown')!;
    const search = this.root.querySelector<HTMLInputElement>('.ds-search')!;

    toggle.addEventListener('click', () => {
      dropdown.classList.toggle('open');
      if (dropdown.classList.contains('open')) search.focus();
    });

    // Close on outside click
    this.root.addEventListener('click', (e) => {
      const wrap = this.root.querySelector('.ds-dd-wrap');
      if (wrap && !wrap.contains(e.target as Node)) dropdown.classList.remove('open');
    });

    // Search filter
    search.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      this.root.querySelectorAll<HTMLElement>('.ds-item').forEach(item => {
        const text = item.textContent?.toLowerCase() ?? '';
        item.style.display = text.includes(q) ? '' : 'none';
      });
    });

    // Select all / none
    this.root.querySelector('.ds-all-btn')?.addEventListener('click', () => {
      this.root.querySelectorAll<HTMLInputElement>('.ds-list input[type="checkbox"]').forEach(cb => cb.checked = true);
      this.syncFromCheckboxes();
    });
    this.root.querySelector('.ds-none-btn')?.addEventListener('click', () => {
      this.root.querySelectorAll<HTMLInputElement>('.ds-list input[type="checkbox"]').forEach(cb => cb.checked = false);
      this.syncFromCheckboxes();
    });

    // Checkbox change → update selected set + toggle label
    this.root.querySelectorAll<HTMLInputElement>('.ds-list input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        this.syncFromCheckboxes();
      });
    });

    this.root.querySelector('.render-btn')?.addEventListener('click', () => this.loadAndRender());
    this.syncSelect();
  }

  /** Read checkboxes and update the selected set + toggle button text. */
  private syncFromCheckboxes(): void {
    const cbs = this.root.querySelectorAll<HTMLInputElement>('.ds-list input[type="checkbox"]');
    this.selected.clear();
    cbs.forEach(cb => { if (cb.checked) this.selected.add(cb.value); });
    const toggle = this.root.querySelector<HTMLButtonElement>('.ds-toggle');
    if (toggle) {
      const count = this.selected.size;
      const total = cbs.length;
      toggle.innerHTML = count === 0
        ? 'Select datasets <span class="caret">▾</span>'
        : `${count} of ${total} datasets <span class="caret">▾</span>`;
    }
  }

  private syncSelect(): void {
    const cbs = this.root.querySelectorAll<HTMLInputElement>('.ds-list input[type="checkbox"]');
    cbs.forEach(cb => {
      cb.checked = this.selected.has(cb.value);
    });
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
      const schemas: JSONLDSchema[] = [];

      for (const id of this.selected) {
        let schema = this.loadedSchemas.get(id);
        if (!schema) {
          const ds = this.datasets[id];
          if (!ds) continue;
          this.setStatus(`Loading ${ds.name}…`);
          const res = await fetch(ds.url);
          if (!res.ok) throw new Error(`HTTP ${res.status} loading ${ds.name}`);
          schema = (await res.json()) as JSONLDSchema;
          this.loadedSchemas.set(id, schema);
        }
        if (schema) schemas.push(schema);
      }

      const merged = this.mergeSchemas(schemas);
      diagram.setData(merged);

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
