/**
 * IRI Resolver Component
 *
 * A standalone web component that resolves IRIs against SPARQL endpoints
 * to discover their rdf:type, shows results, and lets the user apply
 * the resolved IRIs as VALUES bindings to the SPARQL query.
 *
 * Usage:
 *   <iri-resolver diagram="diagram"></iri-resolver>
 */

import type { SchemaDiagram } from './schema-diagram';
import type { SparqlEditor } from './sparql-editor';
import type { DatasetSelector } from './dataset-selector';
import { shortenForDisplay, escapeHtml } from '../iri/uri-utils';

// ── types ────────────────────────────────────────────────────────────────────

interface DatasetResult {
  types: Set<string>;
  endpoint: string;
  graph: string | null;
}

interface ResolvedIri {
  datasets: Map<string, DatasetResult>;
}

export interface EndpointEntry {
  name: string;
  endpoint: string;
  graph: string | null;
}

// ── component ────────────────────────────────────────────────────────────────

export class IriResolver extends HTMLElement {
  private root: ShadowRoot;

  /** Resolved map:  IRI → { datasets: Map<datasetName, {types, endpoint, graph}> } */
  private resolvedIris = new Map<string, ResolvedIri>();
  private selectedIris = new Set<string>();

  /** Manually registered endpoints (e.g. from sources.csv or dataset-selector) */
  private endpoints: EndpointEntry[] = [];
  /** Auto-discovered endpoints from JSON-LD @about */
  private autoEndpoints: EndpointEntry[] = [];
  private queryTimeout = 15000;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  // ======================================================================
  // Public API
  // ======================================================================

  /** Register endpoints to query. Called from the host page / demo-entry. */
  setEndpoints(eps: EndpointEntry[]): void {
    this.endpoints = eps;
  }

  /** Return all effective endpoints (auto-discovered + manually registered). */
  getEndpoints(): EndpointEntry[] {
    return this.getEffectiveEndpoints();
  }

  /**
   * Refresh: re-scan loaded JSON-LD schemas for endpoint metadata and
   * update the endpoint list shown in the UI.
   */
  refresh(): void {
    this.autoEndpoints = this.extractEndpointsFromSchemas();
    this.renderEndpointList();
  }

  /**
   * Pre-fetch JSON-LD files from the given dataset URLs and extract any
   * SPARQL endpoint information from their `@about` section.
   *
   * This is designed to be called **immediately** at startup so the
   * endpoint list is populated before the user renders any diagram.
   */
  async loadEndpointsFromUrls(
    datasets: Record<string, { name: string; url: string }>,
  ): Promise<void> {
    const eps: EndpointEntry[] = [];

    const fetches = Object.entries(datasets).map(async ([_id, ds]) => {
      try {
        const res = await fetch(ds.url);
        if (!res.ok) return;
        const json = await res.json();
        const about = json?.['@about'] ?? json?.['@metadata'];
        if (about && typeof about === 'object') {
          const name = about.dataset_name ?? ds.name;
          if (typeof about.endpoint === 'string' && about.endpoint) {
            eps.push({ name, endpoint: about.endpoint, graph: null });
          }
          if (Array.isArray(about.endpoints)) {
            for (const ep of about.endpoints) {
              if (typeof ep === 'string' && ep) {
                eps.push({ name, endpoint: ep, graph: null });
              }
            }
          }
        }
      } catch {
        // Silently skip files that fail to load
      }
    });

    await Promise.all(fetches);
    this.autoEndpoints = eps;
    this.renderEndpointList();
  }

  // ======================================================================
  // Lifecycle
  // ======================================================================

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display:block; }
        .ir-wrap { display:flex; flex-direction:column; gap:8px; }

        .ir-title { font-size:13px; font-weight:600; color:#333; }
        .ir-desc  { font-size:10px; color:#6e6e73; line-height:1.4; }

        /* ── input area ── */
        .ir-input textarea {
          width:100%; min-height:56px; font-size:11px; padding:6px 8px;
          font-family:'SF Mono',Monaco,Menlo,monospace;
          border:1px solid #d2d2d7; border-radius:4px; resize:vertical;
          box-sizing:border-box;
        }
        .ir-input textarea::placeholder { color:#aaa; }
        .ir-btns { display:flex; gap:6px; align-items:center; }
        .ir-btns button { font-size:11px; padding:3px 10px; border:1px solid #d2d2d7;
                          border-radius:4px; background:#fff; cursor:pointer; }
        .ir-btns button.primary { background:#0066cc; color:#fff; border-color:#0066cc; }
        .ir-btns button:hover { opacity:.85; }
        .ir-btns button:disabled { opacity:.5; cursor:not-allowed; }

        .ir-status { font-size:10px; min-height:14px; }
        .ir-status.info    { color:#6e6e73; }
        .ir-status.success { color:#1a7f37; }
        .ir-status.warning { color:#b35900; }
        .ir-status.error   { color:#cf222e; }

        /* ── endpoint field ── */
        .ir-endpoint-row { display:flex; gap:4px; align-items:center; }
        .ir-endpoint-row input { flex:1; font-size:11px; padding:3px 6px; border:1px solid #d2d2d7;
                                  border-radius:3px; font-family:'SF Mono',Monaco,monospace; }
        .ir-endpoint-row input::placeholder { color:#aaa; }
        .ir-endpoint-row button { font-size:10px; padding:2px 8px; }

        /* ── results list ── */
        .ir-results { max-height:250px; overflow-y:auto; border:1px solid #e0e4ea;
                      border-radius:4px; background:#fafbfc; }
        .ir-results:empty { display:none; }
        .ir-result-item { padding:5px 8px; border-bottom:1px solid #eee;
                          font-size:11px; }
        .ir-result-item:last-child { border-bottom:none; }
        .ir-result-item .ir-iri { font-family:'SF Mono',Monaco,monospace; font-size:10px;
                                   color:#333; word-break:break-all; }
        .ir-result-item .ir-meta { font-size:10px; color:#6e6e73; margin-top:1px; }
        .ir-result-item .ir-types { color:#8250df; }

        /* ── endpoint list ── */
        .ir-ep-list { margin-top:6px; display:flex; flex-direction:column; gap:3px; }
        .ir-ep-item { display:flex; align-items:center; gap:5px; font-size:10px;
                      padding:2px 4px; border-radius:3px; background:#f0f4ff; }
        .ir-ep-badge { font-weight:600; color:#0066cc; white-space:nowrap; }
        .ir-ep-url  { font-family:'SF Mono',Monaco,Menlo,monospace; color:#555;
                      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .ir-ep-empty { font-size:10px; color:#999; font-style:italic; }
      </style>

      <div class="ir-wrap">
        <div class="ir-title">IRI Resolver</div>
        <div class="ir-desc">
          Paste IRIs to discover their <strong>rdf:type</strong> and render matching
          schema classes on the diagram.
        </div>

        <div class="ir-input">
          <textarea placeholder="Paste IRIs, one per line…&#10;http://identifiers.org/ncbigene/1234&#10;http://identifiers.org/uniprot/P12345"></textarea>
        </div>

        <details style="font-size:11px">
          <summary style="cursor:pointer;color:#0066cc;">Endpoints</summary>
          <div class="ir-ep-list" style="margin-top:4px">
            <div class="ir-ep-empty">No endpoints configured — add one below</div>
          </div>
          <div class="ir-endpoint-row" style="margin-top:4px">
            <input class="ir-custom-ep" placeholder="https://sparql.example.org/query" />
            <button class="ir-add-ep">+ Add</button>
          </div>
        </details>

        <div class="ir-btns">
          <button class="primary ir-resolve-btn">Resolve IRIs</button>
          <button class="ir-clear-btn">Clear</button>
          <span class="ir-status"></span>
        </div>

        <div class="ir-results"></div>
      </div>
    `;

    this.bindEvents();
  }

  // ======================================================================
  // Events
  // ======================================================================

  private bindEvents(): void {
    this.root.querySelector('.ir-resolve-btn')
      ?.addEventListener('click', () => this.resolveIris());

    this.root.querySelector('.ir-clear-btn')
      ?.addEventListener('click', () => this.clear());

    this.root.querySelector('.ir-add-ep')?.addEventListener('click', () => {
      const input = this.root.querySelector<HTMLInputElement>('.ir-custom-ep')!;
      const ep = input.value.trim();
      if (!ep) return;
      this.endpoints.push({ name: 'custom', endpoint: ep, graph: null });
      input.value = '';
      this.renderEndpointList();
      this.setStatus(`Added endpoint (${this.getEffectiveEndpoints().length} total)`, 'success');
    });
  }

  // ======================================================================
  // Resolve
  // ======================================================================

  private parseInput(): string[] {
    const ta = this.root.querySelector<HTMLTextAreaElement>('textarea')!;
    return ta.value
      .split('\n')
      .map(l => l.trim().replace(/^<|>$/g, ''))
      .filter(l => l.startsWith('http://') || l.startsWith('https://'));
  }

  private async resolveIris(): Promise<void> {
    const iris = this.parseInput();
    if (iris.length === 0) {
      this.setStatus('No valid IRIs provided', 'warning');
      return;
    }

    // Merge diagram-sourced endpoints (from datasets' schemas) if available
    const eps = this.getEffectiveEndpoints();
    if (eps.length === 0) {
      this.setStatus('No endpoints configured — add one above', 'warning');
      return;
    }

    this.setLoading(true);
    this.setStatus(`Resolving ${iris.length} IRI(s) against ${eps.length} endpoint(s)…`, 'info');

    let successCount = 0;
    let corsCount = 0;
    let timeoutCount = 0;

    for (const ep of eps) {
      try {
        const bindings = await this.queryEndpoint(ep.endpoint, ep.graph, iris);
        this.mergeResults(ep.name, ep.endpoint, ep.graph, bindings);
        successCount++;
      } catch (err: any) {
        const reason = err?.message || 'Unknown';
        if (reason === 'CORS blocked') corsCount++;
        if (reason === 'Timeout') timeoutCount++;
        console.warn(`[IriResolver] ${ep.name}: ${reason}`);
      }
    }

    this.setLoading(false);

    const foundCount = iris.filter(i => this.resolvedIris.has(i)).length;
    let msg = foundCount > 0
      ? `Resolved ${foundCount}/${iris.length} IRI(s) across ${successCount} endpoint(s)`
      : `No types found in ${successCount}/${eps.length} endpoint(s)`;
    if (corsCount) msg += ` (${corsCount} CORS)`;
    if (timeoutCount) msg += ` (${timeoutCount} timeout)`;
    this.setStatus(msg, foundCount > 0 ? 'success' : 'warning');

    this.renderResults();

    // Auto-select all resolved IRIs and immediately apply —
    // this loads the matching datasets and renders matched classes
    if (foundCount > 0) {
      this.selectAll();
      await this.applySelection();
    }
  }

  private async queryEndpoint(
    endpoint: string,
    graph: string | null,
    iris: string[],
  ): Promise<Array<{ iri: string; type: string }>> {
    const values = iris.map(i => `<${i}>`).join(' ');
    const body = graph
      ? `SELECT ?iri ?type WHERE { VALUES ?iri { ${values} } GRAPH <${graph}> { ?iri a ?type . } }`
      : `SELECT ?iri ?type WHERE { VALUES ?iri { ${values} } ?iri a ?type . }`;

    const url = `${endpoint}?query=${encodeURIComponent(body)}&format=json`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.queryTimeout);

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/sparql-results+json' },
        signal: ctrl.signal,
        mode: 'cors',
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return (json.results?.bindings ?? []).map((b: any) => ({
        iri: b.iri?.value,
        type: b.type?.value,
      })).filter((r: any) => r.iri && r.type);
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Timeout');
      if (err.name === 'TypeError' && err.message?.includes('Failed to fetch'))
        throw new Error('CORS blocked');
      throw err;
    }
  }

  private mergeResults(
    dataset: string,
    endpoint: string,
    graph: string | null,
    bindings: Array<{ iri: string; type: string }>,
  ): void {
    for (const { iri, type } of bindings) {
      if (!this.resolvedIris.has(iri)) {
        this.resolvedIris.set(iri, { datasets: new Map() });
      }
      const entry = this.resolvedIris.get(iri)!;
      if (!entry.datasets.has(dataset)) {
        entry.datasets.set(dataset, { types: new Set(), endpoint, graph });
      }
      entry.datasets.get(dataset)!.types.add(type);
    }
  }

  private getEffectiveEndpoints(): EndpointEntry[] {
    // Merge auto-discovered + manually registered, de-duplicate by URL
    const seen = new Set<string>();
    const result: EndpointEntry[] = [];
    for (const ep of [...this.autoEndpoints, ...this.endpoints]) {
      if (!seen.has(ep.endpoint)) {
        seen.add(ep.endpoint);
        result.push(ep);
      }
    }
    return result;
  }

  /**
   * Scan loaded JSON-LD schemas for SPARQL endpoint URLs.
   *
   * Supported locations (checked in order):
   *  - `@about.endpoint`    (rdfsolve ≥0.0.1)
   *  - `@about.endpoints`   (array of strings)
   *  - `@metadata.endpoint` (legacy rdf-solve)
   *  - `@metadata.endpoints`
   */
  private extractEndpointsFromSchemas(): EndpointEntry[] {
    const selector = document.querySelector<DatasetSelector>('dataset-selector');
    if (!selector) return [];

    const loaded = selector.getLoadedSchemas();
    const datasets = selector.getDatasets();
    const eps: EndpointEntry[] = [];

    for (const [id, schema] of loaded) {
      const fallbackName = datasets[id]?.name ?? id;
      const about = (schema as any)['@about'] ?? (schema as any)['@metadata'];
      if (!about || typeof about !== 'object') continue;

      const dsName = about.dataset_name ?? fallbackName;

      if (typeof about.endpoint === 'string' && about.endpoint) {
        eps.push({ name: dsName, endpoint: about.endpoint, graph: null });
      }
      if (Array.isArray(about.endpoints)) {
        for (const ep of about.endpoints) {
          if (typeof ep === 'string' && ep) {
            eps.push({ name: dsName, endpoint: ep, graph: null });
          }
        }
      }
    }
    return eps;
  }

  /**
   * Render the list of currently known endpoints below the custom-endpoint
   * input so the user can see what will be queried.
   */
  private renderEndpointList(): void {
    // Find or create the endpoint list container
    let list = this.root.querySelector<HTMLElement>('.ir-ep-list');
    if (!list) {
      const details = this.root.querySelector<HTMLDetailsElement>('details');
      if (!details) return;
      list = document.createElement('div');
      list.className = 'ir-ep-list';
      details.appendChild(list);
    }

    const all = this.getEffectiveEndpoints();
    if (all.length === 0) {
      list.innerHTML = `<div class="ir-ep-empty">No endpoints configured — add one above</div>`;
      return;
    }

    list.innerHTML = all
      .map(ep => {
        const short = ep.endpoint.length > 55
          ? ep.endpoint.slice(0, 52) + '…'
          : ep.endpoint;
        return `<div class="ir-ep-item" title="${escapeHtml(ep.endpoint)}">
          <span class="ir-ep-badge">${escapeHtml(ep.name)}</span>
          <span class="ir-ep-url">${escapeHtml(short)}</span>
        </div>`;
      })
      .join('');
  }

  // ======================================================================
  // Results rendering
  // ======================================================================

  private renderResults(): void {
    const container = this.root.querySelector<HTMLElement>('.ir-results')!;

    if (this.resolvedIris.size === 0) {
      container.innerHTML = '';
      return;
    }

    const schemaPrefixes = this.getDiagram()?.getSchema()?.prefixes;

    let html = '';
    for (const [iri, data] of this.resolvedIris) {
      const short = escapeHtml(shortenForDisplay(iri, schemaPrefixes));
      const allTypes = new Set<string>();
      const dsNames: string[] = [];
      for (const [ds, dsData] of data.datasets) {
        dsNames.push(ds);
        dsData.types.forEach(t => allTypes.add(t));
      }
      const typesStr = [...allTypes].map(t => escapeHtml(shortenForDisplay(t, schemaPrefixes))).join(', ');

      html += `
        <div class="ir-result-item" data-iri="${escapeHtml(iri)}">
          <div class="ir-iri" title="${escapeHtml(iri)}">${short}</div>
          <div class="ir-meta">
            <span class="ir-types" title="${escapeHtml([...allTypes].join(', '))}">${typesStr}</span>
            <span style="color:#999">[${dsNames.join(', ')}]</span>
          </div>
        </div>`;
    }
    container.innerHTML = html;
  }

  // ======================================================================
  // Selection (internal — all resolved IRIs are auto-selected)
  // ======================================================================

  private selectAll(): void {
    for (const iri of this.resolvedIris.keys()) this.selectedIris.add(iri);
  }

  // ======================================================================
  // Apply → render matching classes & push VALUES bindings
  // ======================================================================

  /**
   * For each selected IRI:
   *  1. Collect its discovered rdf:type(s)
   *  2. If no schema is loaded yet, auto-load all datasets whose endpoints
   *     produced results — this is the "entity matching" workflow
   *  3. Match those types to classes present in the loaded schema
   *  4. Re-render the diagram with the matched classes as root nodes
   *  5. Highlight the matched nodes on the diagram and zoom to fit
   *  6. If a SPARQL query exists, also push VALUES bindings into it
   */
  private async applySelection(): Promise<void> {
    if (this.selectedIris.size === 0) {
      this.setStatus('No IRIs selected', 'warning');
      return;
    }

    // ── 1. Collect all discovered types for selected IRIs ──────────────
    const allDiscoveredTypes = new Set<string>();
    const iriToTypes = new Map<string, Set<string>>();
    const matchedDatasetNames = new Set<string>();

    for (const iri of this.selectedIris) {
      const data = this.resolvedIris.get(iri);
      if (!data) continue;
      const types = new Set<string>();
      for (const [dsName, dsData] of data.datasets) {
        dsData.types.forEach(t => types.add(t));
        matchedDatasetNames.add(dsName);
      }
      iriToTypes.set(iri, types);
      types.forEach(t => allDiscoveredTypes.add(t));
    }

    if (allDiscoveredTypes.size === 0) {
      this.setStatus('Selected IRIs have no discovered types', 'warning');
      return;
    }

    // ── 2. Ensure schema is loaded — auto-load matching datasets ──────
    const diagram = this.getDiagram();
    let schema = diagram?.getSchema();

    if (!schema) {
      // No schema yet — try to auto-load datasets whose endpoints
      // matched.  Map endpoint-based dataset names back to dataset IDs.
      const selector = document.querySelector<DatasetSelector>('dataset-selector');
      if (selector) {
        const dsMap = selector.getDatasets();
        const idsToLoad: string[] = [];
        for (const [id, entry] of Object.entries(dsMap)) {
          if (matchedDatasetNames.has(entry.name)) idsToLoad.push(id);
        }
        // If we couldn't match by name, load ALL datasets
        if (idsToLoad.length === 0) {
          idsToLoad.push(...Object.keys(dsMap));
        }

        this.setStatus(`Loading ${idsToLoad.length} dataset(s)…`, 'info');
        await selector.selectAndRender(idsToLoad);
        schema = diagram?.getSchema() ?? null;
      }

      if (!schema) {
        this.setStatus('Could not load schema — select datasets manually', 'error');
        return;
      }
    }

    // ── 3. Match discovered types to schema classes / subjects ────────
    const schemaSubjects = schema.subjects;
    const matchedRoots = new Set<string>();

    for (const typeUri of allDiscoveredTypes) {
      if (schemaSubjects.has(typeUri)) {
        matchedRoots.add(typeUri);
      }
    }

    // Fallback: look for subjects linked TO the discovered types
    if (matchedRoots.size === 0) {
      for (const typeUri of allDiscoveredTypes) {
        const incoming = schema.incoming.get(typeUri);
        if (incoming) {
          for (const triple of incoming) {
            if (schemaSubjects.has(triple.subject)) {
              matchedRoots.add(triple.subject);
            }
          }
        }
      }
    }

    // ── 4. Build class → resolved IRIs map (for badges) ────────────
    //   For each resolved IRI, find which matched root class(es) it
    //   belongs to via its rdf:type(s).
    const classToIris = new Map<string, string[]>();
    for (const [iri, types] of iriToTypes) {
      for (const typeUri of types) {
        if (matchedRoots.has(typeUri)) {
          const list = classToIris.get(typeUri) ?? [];
          list.push(iri);
          classToIris.set(typeUri, list);
        }
      }
    }

    // ── 5. Re-render the diagram with matched classes as roots ────────
    if (matchedRoots.size > 0 && diagram) {
      const state = diagram.getState();

      // Set resolved IRIs + highlights BEFORE re-render so the renderer
      // can draw badges and green borders in the same paint.
      state.setResolvedIris(classToIris);
      state.setIriHighlights([...matchedRoots]);

      // Re-render the diagram with matched classes as root nodes
      diagram.setRoots([...matchedRoots]);

      // Zoom to fit after render settles
      requestAnimationFrame(() => diagram.fitToView());
    }

    // ── 6. Push VALUES bindings into sparql-editor (if available) ─────
    const sparqlEditor = document.querySelector<SparqlEditor>('sparql-editor');
    let bound = 0;
    if (sparqlEditor) {
      const sparqlText = sparqlEditor.getSPARQL();
      const schemaPrefixes = schema.prefixes ?? {};
      const typeToVar = this.buildTypeToVarMap(sparqlText, schemaPrefixes);

      for (const [iri, types] of iriToTypes) {
        for (const typeUri of types) {
          const varName = typeToVar.get(typeUri);
          if (varName) {
            sparqlEditor.addIriBinding(varName, iri);
            bound++;
            break; // one binding per IRI
          }
        }
      }
    }

    // ── 7. Status ─────────────────────────────────────────────────────
    const parts: string[] = [];
    if (matchedRoots.size > 0) {
      parts.push(`Rendered ${matchedRoots.size} class(es) as roots`);
    } else {
      parts.push('No matching classes found in schema');
    }
    if (bound > 0) {
      parts.push(`bound ${bound} IRI(s) to query`);
    }
    this.setStatus(
      parts.join('; '),
      matchedRoots.size > 0 ? 'success' : 'warning',
    );
  }

  /**
   * Parse the SPARQL text for "?varName a prefix:Local ." or "?varName a <uri> ."
   * and return a Map<fullTypeUri, varName>.
   */
  private buildTypeToVarMap(
    sparqlText: string,
    prefixes: Record<string, string>,
  ): Map<string, string> {
    const map = new Map<string, string>();

    // Match "?var a curie ." and "?var a <uri> ."
    const re = /\?(\w+)\s+a\s+(?:(\w[\w.-]*:\w[\w.-]*)|<([^>]+)>)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sparqlText)) !== null) {
      const varName = m[1];
      let typeUri = '';
      if (m[3]) {
        // Full URI form
        typeUri = m[3];
      } else if (m[2]) {
        // CURIE form: expand with prefixes
        const [prefix, local] = m[2].split(':');
        const ns = prefixes[prefix];
        typeUri = ns ? ns + local : m[2];
      }
      if (typeUri) map.set(typeUri, varName);
    }
    return map;
  }

  // ======================================================================
  // Clear
  // ======================================================================

  private clear(): void {
    this.resolvedIris.clear();
    this.selectedIris.clear();
    const ta = this.root.querySelector<HTMLTextAreaElement>('textarea');
    if (ta) ta.value = '';
    this.root.querySelector<HTMLElement>('.ir-results')!.innerHTML = '';
    this.setStatus('', 'info');

    // Clear any IRI highlights and resolved-IRI badges on the diagram
    const diagram = this.getDiagram();
    if (diagram) {
      const state = diagram.getState();
      state.clearIriHighlights();
      state.clearResolvedIris();
    }
  }

  // ======================================================================
  // Helpers
  // ======================================================================

  private getDiagram(): SchemaDiagram | null {
    const id = this.getAttribute('diagram');
    return id ? document.getElementById(id) as SchemaDiagram | null : null;
  }

  private setStatus(msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    const el = this.root.querySelector<HTMLElement>('.ir-status');
    if (!el) return;
    el.textContent = msg;
    el.className = `ir-status ${type}`;
  }

  private setLoading(loading: boolean): void {
    const btn = this.root.querySelector<HTMLButtonElement>('.ir-resolve-btn');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'Resolving…' : 'Resolve IRIs';
  }
}

customElements.define('iri-resolver', IriResolver);
