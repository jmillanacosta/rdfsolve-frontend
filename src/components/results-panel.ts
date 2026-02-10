/**
 * Results Panel Component
 *
 * Executes SPARQL queries against live endpoints, displays results
 * as a table, and **connects results back to the schema diagram**:
 *
 *  - Each column header shows which schema class/node the ?variable maps to
 *  - Clicking a URI cell highlights the corresponding schema node
 *  - Instance count badges appear on schema nodes after execution
 *  - The diagram highlights all schema nodes that returned data
 *
 * Usage:
 *   <results-panel diagram="diagram"></results-panel>
 */

import type { SchemaDiagram } from './schema-diagram';
import type { SparqlEditor } from './sparql-editor';
import type { IriResolver } from './iri-resolver';
import { escapeHtml, shortenForDisplay, getLocalName } from '../iri/uri-utils';
import {
  executeQuery,
  buildVariableMapFromQuery,
  collectInstancesBySchemaNode,
  type QueryResult,
  type VariableMapping,
} from '../sparql/query-executor';

// ── component ────────────────────────────────────────────────────────────────

export class ResultsPanel extends HTMLElement {
  private root: ShadowRoot;
  private lastResult: QueryResult | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
  }

  // ── lookups ────────────────────────────────────────────────────────────

  private getDiagram(): SchemaDiagram | null {
    const id = this.getAttribute('diagram');
    return id ? document.getElementById(id) as SchemaDiagram | null : null;
  }

  private getEditor(): SparqlEditor | null {
    return document.querySelector<SparqlEditor>('sparql-editor');
  }

  private getResolver(): IriResolver | null {
    return document.querySelector<IriResolver>('iri-resolver');
  }

  // ── render shell ───────────────────────────────────────────────────────

  private render(): void {
    this.root.innerHTML = /* html */`
<style>
  :host { display: block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

  /* ── Controls ── */
  .rp-controls {
    display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap;
  }
  .rp-endpoint-wrap { flex: 1; min-width: 120px; }
  .rp-endpoint-wrap select {
    width: 100%; font-size: 11px; padding: 6px 8px;
    border: 1px solid #d2d2d7; border-radius: 6px; background: #fff;
  }
  .rp-run {
    padding: 6px 18px; font-size: 12px; font-weight: 600;
    border: none; border-radius: 6px; cursor: pointer;
    background: #34a853; color: #fff; transition: background .15s;
    white-space: nowrap;
  }
  .rp-run:hover { background: #2d9249; }
  .rp-run:disabled { opacity: .5; cursor: default; }

  .rp-method { display: flex; gap: 8px; align-items: center; font-size: 11px; color: #6e6e73; }
  .rp-method label { cursor: pointer; display: flex; align-items: center; gap: 3px; }

  /* ── Status ── */
  .rp-status {
    font-size: 11px; color: #6e6e73; padding: 6px 0; min-height: 20px;
    display: flex; align-items: center; gap: 8px;
  }
  .rp-status.error { color: #d30000; }
  .rp-status .rp-timing {
    margin-left: auto; font-size: 10px; color: #999;
  }

  /* ── Summary badges ── */
  .rp-summary {
    display: flex; gap: 6px; flex-wrap: wrap; padding: 6px 0;
  }
  .rp-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 12px; font-size: 10px; font-weight: 600;
    cursor: pointer; transition: all .15s; border: 1px solid transparent;
  }
  .rp-badge:hover { border-color: currentColor; }
  .rp-badge .badge-dot {
    width: 7px; height: 7px; border-radius: 50%; background: currentColor;
  }
  .rp-badge.has-data  { background: #e8f5e9; color: #2e7d32; }
  .rp-badge.no-data   { background: #f5f5f5; color: #999; }

  /* ── Table ── */
  .rp-table-wrap {
    max-height: 340px; overflow: auto;
    border: 1px solid #d2d2d7; border-radius: 6px;
  }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  thead { position: sticky; top: 0; z-index: 1; }
  th {
    background: #f5f6f8; padding: 6px 10px; text-align: left; font-weight: 600;
    border-bottom: 2px solid #d2d2d7; white-space: nowrap;
  }
  th .th-var { color: #1a7f37; font-family: 'SF Mono', Monaco, monospace; }
  th .th-schema {
    display: block; font-size: 9px; font-weight: 400; color: #0066cc;
    margin-top: 1px; cursor: pointer;
  }
  th .th-schema:hover { text-decoration: underline; }
  td {
    padding: 5px 10px; border-bottom: 1px solid #eee;
    word-break: break-all; max-width: 260px;
  }
  tr:hover td { background: #f0f4ff; }
  .cell-uri {
    color: #0066cc; cursor: pointer; text-decoration: none;
  }
  .cell-uri:hover { text-decoration: underline; }
  .cell-lit { color: #333; }
  .cell-empty { color: #ccc; font-style: italic; }

  /* ── Empty state ── */
  .rp-empty {
    text-align: center; padding: 24px 16px; color: #999; font-size: 12px;
    line-height: 1.6;
  }
  .rp-empty .rp-empty-icon { font-size: 28px; margin-bottom: 6px; }
</style>

<div class="rp-controls">
  <div class="rp-endpoint-wrap">
    <select id="ep-select"><option value="">— select endpoint —</option></select>
  </div>
  <div class="rp-method">
    <label><input type="radio" name="rp-method" value="GET" checked /> GET</label>
    <label><input type="radio" name="rp-method" value="POST" /> POST</label>
  </div>
  <button class="rp-run" id="run-btn">▶ Run Query</button>
</div>

<div class="rp-status" id="status"></div>
<div id="summary"></div>
<div id="results">
  <div class="rp-empty">
    Draw a path → review the query → run it here.<br/>
    Results will map back to the schema diagram.
  </div>
</div>
`;

    this.root.getElementById('run-btn')!.addEventListener('click', () => this.runQuery());
    this.refreshEndpoints();
  }

  // ── public API ─────────────────────────────────────────────────────────

  /** Refresh the endpoint dropdown (call after schemas load). */
  refreshEndpoints(): void {
    const sel = this.root.getElementById('ep-select') as HTMLSelectElement | null;
    if (!sel) return;

    const resolver = this.getResolver();
    const endpoints = resolver?.getEndpoints() ?? [];

    sel.innerHTML = '';
    if (endpoints.length === 0) {
      sel.append(this.opt('', '— no endpoints discovered —'));
      return;
    }
    for (const ep of endpoints) {
      const label = ep.graph
        ? `${ep.name} · ${shortenForDisplay(ep.endpoint)}`
        : `${ep.name} · ${shortenForDisplay(ep.endpoint)}`;
      sel.append(this.opt(ep.endpoint, label));
    }
  }

  /** Get the last query result (for programmatic access). */
  getLastResult(): QueryResult | null { return this.lastResult; }

  // ── run query ──────────────────────────────────────────────────────────

  private async runQuery(): Promise<void> {
    const editor = this.getEditor();
    const query = editor?.getSPARQL()?.trim();
    if (!query) { this.setStatus('No SPARQL query — draw a path first', true); return; }

    const sel = this.root.getElementById('ep-select') as HTMLSelectElement;
    const endpoint = sel.value;
    if (!endpoint) { this.setStatus('Select an endpoint', true); return; }

    const method = (this.root.querySelector<HTMLInputElement>(
      'input[name="rp-method"]:checked',
    )?.value ?? 'GET') as 'GET' | 'POST';

    const btn = this.root.getElementById('run-btn') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = '⏳ Running…';
    this.setStatus('Querying endpoint…');

    // Build variable → schema URI map from query text
    const diagram = this.getDiagram();
    const prefixes = diagram?.getSchema()?.prefixes ?? {};
    const variableMap = buildVariableMapFromQuery(query, prefixes);

    try {
      const result = await executeQuery(query, endpoint, variableMap, { method });
      this.lastResult = result;

      if (result.error) {
        this.setStatus(`Error: ${result.error}`, true);
        this.renderEmpty(result.error);
      } else {
        this.setStatus(
          `${result.rowCount} row${result.rowCount !== 1 ? 's' : ''}`,
          false,
          `${result.durationMs}ms`,
        );
        this.renderSummary(result);
        this.renderTable(result);
        this.highlightDiagram(result);
        this.dispatchEvent(new CustomEvent('query-result', { detail: result, bubbles: true }));

        // Log the rdfsolve Python code snippet
        if (result.rdfsolveCode) {
          document.dispatchEvent(new CustomEvent('code-log-entry', {
            detail: { label: 'Execute SPARQL', code: result.rdfsolveCode },
          }));
        }
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Run Query';
    }
  }

  // ── diagram integration ────────────────────────────────────────────────

  /**
   * After query execution, highlight schema nodes that returned data
   * and set instance count badges on the diagram.
   */
  private highlightDiagram(result: QueryResult): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    const instanceMap = collectInstancesBySchemaNode(result);
    if (instanceMap.size === 0) return;

    const state = diagram.getState();

    // Convert Set<string> → string[] for the state API
    const classToIris = new Map<string, string[]>();
    const highlightUris: string[] = [];
    for (const [schemaUri, instances] of instanceMap) {
      classToIris.set(schemaUri, [...instances]);
      highlightUris.push(schemaUri);
    }

    state.setResolvedIris(classToIris);
    state.setIriHighlights(highlightUris, '#34a853');
    diagram.getRenderer()?.updateHighlighting();
  }

  /**
   * Zoom the diagram to a schema node that corresponds to a query variable.
   */
  private zoomToSchemaNode(schemaUri: string): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    // Find the visual node ID that corresponds to this schema URI
    const nodes = diagram.getNodeList();
    const match = nodes.find(n => n.uri === schemaUri);
    if (match) {
      diagram.zoomToNode(match.id);
    }
  }

  // ── render helpers ─────────────────────────────────────────────────────

  private setStatus(msg: string, isError = false, timing?: string): void {
    const el = this.root.getElementById('status');
    if (!el) return;
    el.className = isError ? 'rp-status error' : 'rp-status';
    el.innerHTML = escapeHtml(msg) +
      (timing ? `<span class="rp-timing">${escapeHtml(timing)}</span>` : '');
  }

  private renderEmpty(msg: string): void {
    const container = this.root.getElementById('results')!;
    container.innerHTML = `<div class="rp-empty">
      <div class="rp-empty-icon">⚠️</div>${escapeHtml(msg)}</div>`;
    this.root.getElementById('summary')!.innerHTML = '';
  }

  /**
   * Render per-variable summary badges showing instance counts.
   * Clicking a badge zooms to the corresponding schema node.
   */
  private renderSummary(result: QueryResult): void {
    const container = this.root.getElementById('summary')!;
    const instanceMap = collectInstancesBySchemaNode(result);

    if (instanceMap.size === 0 && result.rows.length === 0) {
      container.innerHTML = '';
      return;
    }

    const div = document.createElement('div');
    div.className = 'rp-summary';

    // Show one badge per variable that maps to a schema node
    for (const v of result.variables) {
      const schemaUri = result.variableMap.get(v);
      if (!schemaUri) continue;

      const instances = instanceMap.get(schemaUri);
      const count = instances?.size ?? 0;
      const badge = document.createElement('span');
      badge.className = count > 0 ? 'rp-badge has-data' : 'rp-badge no-data';
      badge.innerHTML = `<span class="badge-dot"></span>?${escapeHtml(v)}: ${count}`;
      badge.title = `${shortenForDisplay(schemaUri)} — ${count} distinct instance${count !== 1 ? 's' : ''}`;

      if (count > 0) {
        badge.addEventListener('click', () => this.zoomToSchemaNode(schemaUri));
      }
      div.append(badge);
    }
    container.innerHTML = '';
    container.append(div);
  }

  private renderTable(result: QueryResult): void {
    const container = this.root.getElementById('results')!;
    container.innerHTML = '';

    if (result.rows.length === 0) {
      container.innerHTML = `<div class="rp-empty">
        <div class="rp-empty-icon">∅</div>No results returned.<br/>
        Try removing filters or expanding the path.</div>`;
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'rp-table-wrap';
    const table = document.createElement('table');

    // ── Header ──
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    for (const v of result.variables) {
      const th = document.createElement('th');
      const varSpan = document.createElement('span');
      varSpan.className = 'th-var';
      varSpan.textContent = `?${v}`;
      th.append(varSpan);

      const schemaUri = result.variableMap.get(v);
      if (schemaUri) {
        const schemaSpan = document.createElement('span');
        schemaSpan.className = 'th-schema';
        schemaSpan.textContent = `→ ${getLocalName(schemaUri)}`;
        schemaSpan.title = `Schema: ${schemaUri}\nClick to zoom`;
        schemaSpan.addEventListener('click', () => this.zoomToSchemaNode(schemaUri));
        th.append(schemaSpan);
      }
      headRow.append(th);
    }
    thead.append(headRow);
    table.append(thead);

    // ── Body ──
    const tbody = document.createElement('tbody');
    for (const row of result.rows) {
      const tr = document.createElement('tr');
      for (const v of result.variables) {
        const cell = row[v];
        const td = document.createElement('td');

        if (!cell) {
          td.className = 'cell-empty';
          td.textContent = '—';
        } else if (cell.type === 'uri') {
          const a = document.createElement('span');
          a.className = 'cell-uri';
          a.textContent = shortenForDisplay(cell.value);
          a.title = cell.value;
          // Clicking a URI cell zooms to the corresponding schema class
          const schemaUri = result.variableMap.get(v);
          if (schemaUri) {
            a.addEventListener('click', () => this.zoomToSchemaNode(schemaUri));
          }
          td.append(a);
        } else {
          td.className = 'cell-lit';
          td.textContent = cell.value;
          if (cell.lang) td.title = `@${cell.lang}`;
          else if (cell.datatype) td.title = shortenForDisplay(cell.datatype);
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    container.append(wrap);
  }

  // ── util ───────────────────────────────────────────────────────────────

  private opt(value: string, label: string): HTMLOptionElement {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }
}

// ── register ─────────────────────────────────────────────────────────────────

customElements.define('results-panel', ResultsPanel);
