/**
 * SPARQL Editor Component
 *
 * Features:
 * - Syntax highlighting (overlay: invisible textarea + highlighted <pre>)
 * - Context-aware autocomplete (subject → predicates → objects)
 * - Predicate dropdown selectors for hops with multiple alternatives
 * - Debounced parsing of triple patterns into diagram path highlighting
 * - Bidirectional: diagram paths → SPARQL and SPARQL → diagram paths
 *
 * Usage:
 *   <sparql-editor diagram="diagram"></sparql-editor>
 */

import type { SchemaDiagram } from './schema-diagram';
import type { CanonicalSchema, CanonicalTriple } from '../types';
import type { EnhancedPath } from '../state/diagram-state';
import { getLocalName, escapeHtml } from '../iri/uri-utils';

// ---------------------------------------------------------------------------
// Schema index for smart autocomplete
// ---------------------------------------------------------------------------

interface SchemaIndex {
  /** All subject URIs (short labels) mapped to full URI */
  subjects: Map<string, string>;
  /** For each subject URI → set of predicate short labels → full URI */
  subjectPredicates: Map<string, Map<string, string>>;
  /** For each (subject,predicate) → set of object short labels → full URI */
  subjectPredicateObjects: Map<string, Map<string, string>>;
  /** All predicate labels → URI */
  allPredicates: Map<string, string>;
  /** All object labels → URI */
  allObjects: Map<string, string>;
  /** Prefix map for expansion/compaction */
  prefixes: Record<string, string>;
}

function buildSchemaIndex(schema: CanonicalSchema): SchemaIndex {
  const subjects = new Map<string, string>();
  const subjectPredicates = new Map<string, Map<string, string>>();
  const subjectPredicateObjects = new Map<string, Map<string, string>>();
  const allPredicates = new Map<string, string>();
  const allObjects = new Map<string, string>();

  const shorten = (uri: string): string => {
    // Try prefix compaction first
    for (const [prefix, ns] of Object.entries(schema.prefixes)) {
      if (uri.startsWith(ns)) return `${prefix}:${uri.slice(ns.length)}`;
    }
    // Fall back to local name
    if (uri.includes('#')) return uri.split('#').pop()!;
    return uri.split('/').pop()!;
  };

  for (const t of schema.triples) {
    const sLabel = shorten(t.subject);
    subjects.set(sLabel, t.subject);

    const pLabel = shorten(t.predicate);
    allPredicates.set(pLabel, t.predicate);

    // subject → predicates
    if (!subjectPredicates.has(t.subject)) subjectPredicates.set(t.subject, new Map());
    subjectPredicates.get(t.subject)!.set(pLabel, t.predicate);

    // (subject, predicate) → objects
    const spKey = `${t.subject}\t${t.predicate}`;
    if (!subjectPredicateObjects.has(spKey)) subjectPredicateObjects.set(spKey, new Map());

    const oLabel = t.objectType === 'literal' ? `"${t.object}"` : shorten(t.object);
    if (t.objectType !== 'literal') allObjects.set(oLabel, t.object);
    subjectPredicateObjects.get(spKey)!.set(oLabel, t.object);
  }

  return { subjects, subjectPredicates, subjectPredicateObjects, allPredicates, allObjects, prefixes: schema.prefixes };
}

// ---------------------------------------------------------------------------
// Syntax Highlighter
// ---------------------------------------------------------------------------

const SPARQL_KEYWORDS = new Set([
  'SELECT', 'DISTINCT', 'WHERE', 'PREFIX', 'OPTIONAL', 'FILTER',
  'LIMIT', 'OFFSET', 'ORDER', 'BY', 'ASC', 'DESC', 'GROUP',
  'HAVING', 'UNION', 'BIND', 'AS', 'VALUES', 'SERVICE', 'GRAPH',
  'CONSTRUCT', 'ASK', 'DESCRIBE', 'FROM', 'NAMED', 'BASE',
  'INSERT', 'DELETE', 'DATA', 'NOT', 'EXISTS', 'MINUS', 'IN',
]);

function highlightSPARQL(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.split('\n').map(line => {
    if (line.trimStart().startsWith('#')) {
      return `<span class="hl-comment">${line}</span>`;
    }
    return highlightLine(line);
  }).join('\n');
}

function highlightLine(line: string): string {
  const tokenRe = /(&lt;[^&]*?&gt;|"[^"]*"|'[^']*'|\?\w+|\w[\w.-]*:\w[\w.-]*|\ba\b|\b\w+\b|[{}().,;*]|\s+)/g;

  return line.replace(tokenRe, (token) => {
    if (/^\s+$/.test(token)) return token;
    if (token.startsWith('&lt;') && token.endsWith('&gt;'))
      return `<span class="hl-uri">${token}</span>`;
    if ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'")))
      return `<span class="hl-string">${token}</span>`;
    if (token.startsWith('?'))
      return `<span class="hl-var">${token}</span>`;
    if (/^\w[\w.-]*:\w[\w.-]*$/.test(token))
      return `<span class="hl-curie">${token}</span>`;
    if (SPARQL_KEYWORDS.has(token.toUpperCase()))
      return `<span class="hl-keyword">${token}</span>`;
    if (/^[{}().,;*]$/.test(token))
      return `<span class="hl-punct">${token}</span>`;
    return token;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class SparqlEditor extends HTMLElement {
  private root: ShadowRoot;
  private index: SchemaIndex | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private updatingFromDiagram = false;
  /** Per-variable IRI bindings for VALUES clause */
  private valueBindings = new Map<string, string[]>();
  /** SPARQL generation options */
  private includeTypes = false;
  private includeLabels = true;
  private sparqlLimit = 100;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display:block; }
        .se-wrap { display:flex; flex-direction:column; gap:6px; }
        .se-header { display:flex; justify-content:space-between; align-items:center; }
        .se-header label { font-size:12px; font-weight:500; }
        .se-status { font-size:10px; color:#6e6e73; }

        /* ---- Overlay editor ---- */
        .se-editor-wrap { position:relative; min-height:180px; }
        .se-editor-wrap textarea,
        .se-editor-wrap .se-highlight {
          font-family:'SF Mono',Monaco,Menlo,monospace;
          font-size:11px; line-height:1.5;
          padding:10px; margin:0;
          border:1px solid #d2d2d7; border-radius:6px;
          box-sizing:border-box; width:100%;
          min-height:180px;
          white-space:pre-wrap; word-wrap:break-word; overflow-wrap:break-word;
          tab-size:2;
        }
        .se-editor-wrap textarea {
          position:absolute; top:0; left:0; height:100%;
          resize:vertical;
          background:transparent; color:transparent; caret-color:#333;
          z-index:2; overflow:auto;
        }
        .se-editor-wrap .se-highlight {
          position:relative; pointer-events:none; z-index:1;
          background:#fafbfc; color:#333; overflow:hidden;
        }

        /* Syntax colours */
        .hl-keyword { color:#0550ae; font-weight:600; }
        .hl-var     { color:#1a7f37; }
        .hl-uri     { color:#953800; }
        .hl-curie   { color:#8250df; }
        .hl-string  { color:#0a3069; }
        .hl-comment { color:#6e7781; font-style:italic; }
        .hl-punct   { color:#57606a; }

        /* ---- Autocomplete ---- */
        .ac-drop { position:absolute; left:0; right:0; z-index:1100; max-height:200px;
                   overflow-y:auto; background:#fff; border:1px solid #d2d2d7;
                   border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,.12);
                   display:none; font-size:12px; }
        .ac-drop.show { display:block; }
        .ac-header { padding:4px 10px; font-size:10px; color:#999; border-bottom:1px solid #eee; }
        .ac-item { padding:4px 10px; cursor:pointer; }
        .ac-item:hover, .ac-item.active { background:#f0f4ff; }

        /* ---- Predicate dropdowns ---- */
        .se-pred-section { display:none; flex-direction:column; gap:4px;
                           padding:8px; background:#f5f6f8; border-radius:6px; font-size:11px; }
        .se-pred-section.show { display:flex; }
        .se-pred-section .pred-title { font-weight:600; font-size:11px; color:#333; margin-bottom:2px; }
        .pred-row { display:flex; align-items:center; gap:6px; }
        .pred-row .pred-hop { color:#6e6e73; font-size:10px; min-width:40px; }
        .pred-row select { flex:1; font-size:11px; padding:2px 4px; border:1px solid #d2d2d7;
                           border-radius:3px; background:#fff; font-family:'SF Mono',Monaco,monospace; }
        .pred-row .pred-nodes { font-size:10px; color:#999; }

        /* ---- Query options (checkboxes) ---- */
        .se-options { display:flex; flex-wrap:wrap; gap:10px; font-size:11px; padding:4px 0; }
        .se-options label { display:flex; align-items:center; gap:4px; cursor:pointer; color:#444; }
        .se-options input[type="checkbox"] { margin:0; }

        /* ---- IRI search / VALUES bindings ---- */
        .se-values-section { display:flex; flex-direction:column; gap:6px;
                             padding:8px; background:#f0f5ff; border-radius:6px; font-size:11px; }
        .se-values-section .values-title { font-weight:600; font-size:11px; color:#333; margin-bottom:2px; }
        .se-values-section .values-desc { font-size:10px; color:#6e6e73; margin-bottom:4px; }
        .se-values-section .values-empty { font-size:10px; color:#999; font-style:italic; padding:4px 0; }
        .val-row { display:flex; flex-direction:column; gap:3px;
                   padding:4px 0; border-bottom:1px solid #e0e4ea; }
        .val-row:last-child { border-bottom:none; }
        .val-row-header { display:flex; align-items:center; gap:6px; }
        .val-row-header .val-var { font-family:'SF Mono',Monaco,monospace;
                                    color:#1a7f37; font-weight:500; font-size:11px; min-width:60px; }
        .val-row-header .val-type { font-size:10px; color:#8250df; }
        .val-row-header .val-count { font-size:9px; color:#999; margin-left:auto; }
        .val-input-wrap { display:flex; gap:4px; align-items:center; }
        .val-input-wrap input { flex:1; font-size:11px; padding:3px 6px; border:1px solid #d2d2d7;
                                border-radius:3px; font-family:'SF Mono',Monaco,monospace; }
        .val-input-wrap input::placeholder { color:#aaa; }
        .val-input-wrap button { font-size:10px; padding:2px 8px; min-width:30px; }
        .val-chips { display:flex; flex-wrap:wrap; gap:3px; margin-top:2px; }
        .val-chip { display:inline-flex; align-items:center; gap:3px;
                    background:#dfe8f6; padding:1px 6px; border-radius:10px;
                    font-size:10px; color:#333; max-width:100%; }
        .val-chip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .val-chip .chip-x { cursor:pointer; color:#666; font-weight:600; }
        .val-chip .chip-x:hover { color:#c00; }
        .val-bulk-wrap { margin-top:4px; }
        .val-bulk-wrap summary { font-size:10px; color:#0066cc; cursor:pointer; }
        .val-bulk-ta { width:100%; height:60px; font-size:10px; padding:4px; margin-top:3px;
                       font-family:'SF Mono',Monaco,monospace; border:1px solid #d2d2d7; border-radius:3px;
                       resize:vertical; }
        .val-bulk-btns { display:flex; gap:4px; margin-top:3px; }
        .val-bulk-btns button { font-size:10px; padding:2px 8px; }

        /* ---- Buttons ---- */
        .se-btns { display:flex; gap:6px; }
        button { font-size:12px; padding:4px 12px; border:1px solid #d2d2d7; border-radius:4px;
                 background:#fff; cursor:pointer; }
        button.primary { background:#0066cc; color:#fff; border-color:#0066cc; }
        button:hover { opacity:.85; }
      </style>
      <div class="se-wrap">
        <div class="se-header">
          <label>SPARQL Query</label>
          <span class="se-status"></span>
        </div>
        <div class="se-editor-wrap">
          <pre class="se-highlight" aria-hidden="true"></pre>
          <textarea spellcheck="false"
            placeholder="Type SPARQL triple patterns here…&#10;Example:&#10;?protein wp:bdbReactome ?reactome .&#10;?protein a wp:Protein ."></textarea>
          <div class="ac-drop"></div>
        </div>
        <div class="se-pred-section">
          <div class="pred-title">Predicate alternatives</div>
          <div class="pred-rows"></div>
        </div>
        <div class="se-options">
          <label><input type="checkbox" class="opt-types" /> Include rdf:type assertions</label>
          <label><input type="checkbox" class="opt-labels" checked /> OPTIONAL rdfs:label / dc:title</label>
        </div>
        <div class="se-values-section">
          <div class="values-title">Bind specific IRIs (VALUES)</div>
          <div class="values-desc">For each variable in your query, paste IRIs to restrict results.
            You can also paste multiple IRIs at once (one per line) using the bulk input.</div>
          <div class="values-rows"></div>
        </div>
        <div class="se-btns">
          <button class="primary update-btn">Update Diagram</button>
          <button class="copy-btn">Copy</button>
        </div>
      </div>
    `;

    const ta = this.ta();
    const dd = this.dd();

    // Typing → highlight + autocomplete + debounced parse
    ta.addEventListener('input', () => {
      this.syncHighlight();
      if (this.updatingFromDiagram) return;
      this.showAutocomplete();
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.parseAndHighlight(), 800);
    });

    // Scroll sync between textarea and highlight overlay
    ta.addEventListener('scroll', () => this.syncScroll());

    // Keyboard nav inside dropdown
    ta.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Hide on blur (delayed for click)
    ta.addEventListener('blur', () => setTimeout(() => dd.classList.remove('show'), 200));

    // Buttons
    this.root.querySelector('.update-btn')?.addEventListener('click', () => this.parseAndHighlight());
    this.root.querySelector('.copy-btn')?.addEventListener('click', () => this.copyToClipboard());

    // Options checkboxes
    this.root.querySelector('.opt-types')?.addEventListener('change', (e) => {
      this.includeTypes = (e.target as HTMLInputElement).checked;
      this.regenerateWithBindings();
    });
    this.root.querySelector('.opt-labels')?.addEventListener('change', (e) => {
      this.includeLabels = (e.target as HTMLInputElement).checked;
      this.regenerateWithBindings();
    });

    // Listen for paths-changed from diagram to auto-update SPARQL
    const diagram = this.getDiagram();
    if (diagram) {
      diagram.addEventListener('paths-changed', () => {
        if (this.updatingFromDiagram) return;
        const paths = (diagram as any).getPaths?.() as EnhancedPath[] | undefined;
        if (paths && paths.length > 0) {
          // Prune valueBindings: remove vars that no longer exist in the query
          this.pruneValueBindings();
          // Compose via backend API (async)
          ((diagram as any).generateSPARQL?.(this.buildGenOptions()) as Promise<{ query: string; rdfsolve_code?: string }> | undefined)
            ?.then((result) => {
              if (result?.query) {
                this.setSPARQL(result.query);
                this.buildPredicateDropdowns(paths);
                this.buildValueBindingsUI();
                if (result.rdfsolve_code) {
                  document.dispatchEvent(new CustomEvent('code-log-entry', {
                    detail: { label: 'Compose Query', code: result.rdfsolve_code },
                  }));
                }
              }
            });
        } else {
          this.valueBindings.clear();
          this.buildValueBindingsUI();
        }
      });
    }

    // Initial highlight + VALUES UI placeholder
    this.syncHighlight();
    this.buildValueBindingsUI();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  refresh(): void {
    const schema = this.getDiagram()?.getSchema();
    this.index = schema ? buildSchemaIndex(schema) : null;
  }

  setSPARQL(text: string): void {
    this.updatingFromDiagram = true;
    this.ta().value = text;
    this.syncHighlight();
    setTimeout(() => { this.updatingFromDiagram = false; }, 0);
  }

  getSPARQL(): string {
    return this.ta().value;
  }

  /** Add an IRI to a variable's VALUES bindings (called by iri-resolver). */
  addIriBinding(varName: string, iri: string): void {
    const clean = iri.replace(/^<|>$/g, '');
    if (!clean) return;
    if (!this.valueBindings.has(varName)) this.valueBindings.set(varName, []);
    const arr = this.valueBindings.get(varName)!;
    if (!arr.includes(clean)) {
      arr.push(clean);
      this.regenerateWithBindings();
    }
  }

  // ---------------------------------------------------------------------------
  // Syntax highlight overlay
  // ---------------------------------------------------------------------------

  private syncHighlight(): void {
    const ta = this.ta();
    const hl = this.root.querySelector<HTMLElement>('.se-highlight')!;
    hl.innerHTML = highlightSPARQL(ta.value) + '\n';
    // Match height so textarea scrollbar and pre stay in sync
    hl.style.minHeight = ta.scrollHeight + 'px';
  }

  private syncScroll(): void {
    const ta = this.ta();
    const hl = this.root.querySelector<HTMLElement>('.se-highlight')!;
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
  }

  // ---------------------------------------------------------------------------
  // Predicate dropdown selectors
  // ---------------------------------------------------------------------------

  private buildPredicateDropdowns(paths: EnhancedPath[]): void {
    const section = this.root.querySelector<HTMLElement>('.se-pred-section')!;
    const rowsDiv = this.root.querySelector<HTMLElement>('.pred-rows')!;

    interface HopInfo {
      pathIndex: number;
      hopIndex: number;
      sourceLabel: string;
      targetLabel: string;
      alternatives: Array<{ predicate: string; predicateLabel?: string; isForward: boolean }>;
      selectedPredicate: string;
    }

    const hops: HopInfo[] = [];

    for (let pi = 0; pi < paths.length; pi++) {
      const p = paths[pi];
      if (!p.edgeAlternatives || !p.edgeData) continue;

      for (let hi = 0; hi < p.edgeAlternatives.length; hi++) {
        const alts = p.edgeAlternatives[hi];
        if (alts.length <= 1) continue; // no dropdown needed for single-predicate hops

        const edge = p.edgeData[hi];
        hops.push({
          pathIndex: pi,
          hopIndex: hi,
          sourceLabel: getLocalName(edge.isForward ? edge.source : edge.target),
          targetLabel: getLocalName(edge.isForward ? edge.target : edge.source),
          alternatives: alts.map(a => ({
            predicate: a.predicate,
            predicateLabel: a.predicateLabel || getLocalName(a.predicate),
            isForward: a.isForward,
          })),
          selectedPredicate: edge.predicate,
        });
      }
    }

    if (hops.length === 0) {
      section.classList.remove('show');
      return;
    }

    section.classList.add('show');
    rowsDiv.innerHTML = hops.map((h) => {
      const options = h.alternatives.map(a => {
        const sel = a.predicate === h.selectedPredicate ? ' selected' : '';
        const dir = a.isForward ? '→' : '←';
        return `<option value="${a.predicate}"${sel}>${a.predicateLabel} ${dir}</option>`;
      }).join('');

      return `
        <div class="pred-row">
          <span class="pred-hop">hop ${h.hopIndex + 1}</span>
          <select data-path="${h.pathIndex}" data-hop="${h.hopIndex}">${options}</select>
          <span class="pred-nodes">${h.sourceLabel} → ${h.targetLabel}</span>
        </div>
      `;
    }).join('');

    // Bind change events
    rowsDiv.querySelectorAll<HTMLSelectElement>('select').forEach(sel => {
      sel.addEventListener('change', () => {
        const pathIdx = parseInt(sel.dataset.path!, 10);
        const hopIdx = parseInt(sel.dataset.hop!, 10);
        const newPred = sel.value;

        const p = paths[pathIdx];
        if (!p?.edgeAlternatives?.[hopIdx]) return;
        const altIdx = p.edgeAlternatives[hopIdx].findIndex(a => a.predicate === newPred);
        if (altIdx < 0) return;

        const diagram = this.getDiagram();
        if (!diagram) return;
        (diagram as any).getState().selectEdgeAlternative(pathIdx, hopIdx, altIdx);

        // Regenerate SPARQL with the new predicate selection (async via backend)
        ((diagram as any).generateSPARQL(this.buildGenOptions()) as Promise<{ query: string }>)
          .then((result) => {
            if (result?.query) {
              this.setSPARQL(result.query);
              this.buildValueBindingsUI();
            }
          });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // IRI search / VALUES bindings
  // ---------------------------------------------------------------------------

  /** Extract variable names from the current SPARQL text (SELECT clause). */
  private extractSelectVars(): string[] {
    const text = this.ta().value;
    const selectMatch = text.match(/SELECT\s+DISTINCT\s+(.+)/i);
    if (!selectMatch) return [];
    const clause = selectMatch[1].split(/\bWHERE\b/i)[0];
    const vars: string[] = [];
    const re = /\?(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clause)) !== null) {
      // Skip label vars (ending in 'Label')
      if (!m[1].endsWith('Label')) vars.push(m[1]);
    }
    return vars;
  }

  /** Remove bindings for variables that no longer exist in the query. */
  private pruneValueBindings(): void {
    const vars = new Set(this.extractSelectVars());
    for (const key of [...this.valueBindings.keys()]) {
      if (!vars.has(key)) this.valueBindings.delete(key);
    }
  }

  /** Build the per-variable IRI search UI. */
  private buildValueBindingsUI(): void {
    const section = this.root.querySelector<HTMLElement>('.se-values-section')!;
    const rowsDiv = this.root.querySelector<HTMLElement>('.values-rows')!;

    const vars = this.extractSelectVars();
    if (vars.length === 0) {
      rowsDiv.innerHTML = '<div class="values-empty">Draw a path in the diagram to see variables here. Each variable will get its own IRI input for VALUES binding.</div>';
      return;
    }

    // Resolve variable type hint from the query text (look for rdf:type assertions)
    const text = this.ta().value;

    rowsDiv.innerHTML = vars.map(v => {
      const bindings = this.valueBindings.get(v) || [];
      const bindCount = bindings.length;
      const chips = bindings.map((iri, i) => {
        const short = getLocalName(iri);
        return `<span class="val-chip" title="${escapeHtml(iri)}"><span>${escapeHtml(short)}</span><span class="chip-x" data-var="${v}" data-idx="${i}">✕</span></span>`;
      }).join('');

      // Try to find a type hint for this var: e.g. "?protein a wp:Protein ."
      const typeRe = new RegExp(`\\?${v}\\s+a\\s+(\\S+)`, 'i');
      const typeMatch = text.match(typeRe);
      const typeHint = typeMatch ? typeMatch[1] : '';

      return `
        <div class="val-row">
          <div class="val-row-header">
            <span class="val-var">?${v}</span>
            ${typeHint ? `<span class="val-type">${escapeHtml(typeHint)}</span>` : ''}
            ${bindCount > 0 ? `<span class="val-count">${bindCount} bound</span>` : ''}
          </div>
          <div class="val-input-wrap">
            <input type="text" data-var="${v}" placeholder="Paste IRI, e.g. http://identifiers.org/…" />
            <button class="val-add-btn" data-var="${v}">+ Add</button>
          </div>
          <div class="val-chips">${chips}</div>
          <details class="val-bulk-wrap">
            <summary>Bulk paste (one IRI per line)</summary>
            <textarea class="val-bulk-ta" data-var="${v}" placeholder="http://identifiers.org/ncbigene/1234&#10;http://identifiers.org/ncbigene/5678&#10;…"></textarea>
            <div class="val-bulk-btns">
              <button class="val-bulk-add" data-var="${v}">Add all</button>
              <button class="val-bulk-clear" data-var="${v}">Clear all for ?${v}</button>
            </div>
          </details>
        </div>
      `;
    }).join('');

    // Bind add buttons (single IRI)
    rowsDiv.querySelectorAll<HTMLButtonElement>('.val-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const varName = btn.dataset.var!;
        const input = rowsDiv.querySelector<HTMLInputElement>(`input[data-var="${varName}"]`);
        if (!input) return;
        this.addIriToVar(varName, input.value);
        input.value = '';
      });
    });

    // Bind Enter key on single-IRI inputs
    rowsDiv.querySelectorAll<HTMLInputElement>('input[data-var]').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const btn = rowsDiv.querySelector<HTMLButtonElement>(`.val-add-btn[data-var="${inp.dataset.var}"]`);
          btn?.click();
        }
      });
    });

    // Bind bulk add buttons
    rowsDiv.querySelectorAll<HTMLButtonElement>('.val-bulk-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const varName = btn.dataset.var!;
        const ta = rowsDiv.querySelector<HTMLTextAreaElement>(`.val-bulk-ta[data-var="${varName}"]`);
        if (!ta) return;
        const iris = ta.value
          .split('\n')
          .map(l => l.trim().replace(/^<|>$/g, ''))
          .filter(l => l && (l.startsWith('http://') || l.startsWith('https://')));
        if (iris.length === 0) return;
        let added = false;
        if (!this.valueBindings.has(varName)) this.valueBindings.set(varName, []);
        const existing = this.valueBindings.get(varName)!;
        for (const iri of iris) {
          if (!existing.includes(iri)) {
            existing.push(iri);
            added = true;
          }
        }
        ta.value = '';
        if (added) this.regenerateWithBindings();
      });
    });

    // Bind bulk clear buttons
    rowsDiv.querySelectorAll<HTMLButtonElement>('.val-bulk-clear').forEach(btn => {
      btn.addEventListener('click', () => {
        const varName = btn.dataset.var!;
        this.valueBindings.delete(varName);
        this.regenerateWithBindings();
      });
    });

    // Bind chip remove
    rowsDiv.querySelectorAll<HTMLSpanElement>('.chip-x').forEach(x => {
      x.addEventListener('click', () => {
        const varName = x.dataset.var!;
        const idx = parseInt(x.dataset.idx!, 10);
        const arr = this.valueBindings.get(varName);
        if (arr) {
          arr.splice(idx, 1);
          if (arr.length === 0) this.valueBindings.delete(varName);
          this.regenerateWithBindings();
        }
      });
    });
  }

  /** Add a single IRI to a variable's bindings. */
  private addIriToVar(varName: string, rawIri: string): void {
    const iri = rawIri.trim().replace(/^<|>$/g, '');
    if (!iri) return;
    if (!this.valueBindings.has(varName)) this.valueBindings.set(varName, []);
    const existing = this.valueBindings.get(varName)!;
    if (!existing.includes(iri)) {
      existing.push(iri);
      this.regenerateWithBindings();
    }
  }

  /** Build the options object for generateSPARQL. */
  private buildGenOptions(): Record<string, unknown> {
    return {
      includeTypes: this.includeTypes,
      includeLabels: this.includeLabels,
      limit: this.sparqlLimit,
      valueBindings: this.valueBindings.size > 0 ? this.valueBindings : undefined,
    };
  }

  /** Regenerate SPARQL with current valueBindings and refresh UI. */
  private regenerateWithBindings(): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    // Compose via backend API (async)
    const resultPromise = (diagram as any).generateSPARQL?.(this.buildGenOptions()) as Promise<{ query: string; rdfsolve_code?: string }> | undefined;
    resultPromise?.then((result) => {
      if (result?.query) {
        this.setSPARQL(result.query);
        this.buildValueBindingsUI();
        if (result.rdfsolve_code) {
          document.dispatchEvent(new CustomEvent('code-log-entry', {
            detail: { label: 'Compose Query', code: result.rdfsolve_code },
          }));
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Autocomplete
  // ---------------------------------------------------------------------------

  private showAutocomplete(): void {
    if (!this.index) this.refresh();
    if (!this.index) return;

    const ta = this.ta();
    const dd = this.dd();
    const pos = ta.selectionStart;
    const text = ta.value;
    const before = text.substring(0, pos);

    const currentLine = before.split('\n').pop() || '';
    const words = currentLine.trim().split(/\s+/).filter(Boolean);
    const partial = before.match(/[\w:._-]+$/);
    const partialText = partial ? partial[0].toLowerCase() : '';

    let suggestions: Array<{ label: string; detail?: string }> = [];
    let contextLabel = '';

    if (words.length === 0 || (words.length === 1 && partial)) {
      contextLabel = 'Subjects';
      suggestions = this.filterMap(this.index.subjects, partialText);
    } else if (words.length === 1 || (words.length === 2 && partial)) {
      const subjectLabel = words[0];
      const subjectUri = this.resolveLabel(subjectLabel, 'subject');
      if (subjectUri && this.index.subjectPredicates.has(subjectUri)) {
        contextLabel = `Predicates for ${subjectLabel}`;
        suggestions = this.filterMap(this.index.subjectPredicates.get(subjectUri)!, partialText);
      } else {
        contextLabel = 'Predicates';
        suggestions = this.filterMap(this.index.allPredicates, partialText);
      }
      if ('a'.startsWith(partialText)) {
        suggestions.unshift({ label: 'a', detail: 'rdf:type' });
      }
    } else {
      const subjectLabel = words[0];
      const predicateLabel = words[1];
      const subjectUri = this.resolveLabel(subjectLabel, 'subject');
      const predicateUri = this.resolveLabel(predicateLabel, 'predicate');

      if (subjectUri && predicateUri) {
        const spKey = `${subjectUri}\t${predicateUri}`;
        if (this.index.subjectPredicateObjects.has(spKey)) {
          contextLabel = `Objects for ${subjectLabel} ${predicateLabel}`;
          suggestions = this.filterMap(this.index.subjectPredicateObjects.get(spKey)!, partialText);
        }
      }
      if (suggestions.length === 0) {
        contextLabel = 'Objects';
        suggestions = this.filterMap(this.index.allObjects, partialText);
      }
    }

    if (words.length === 1 && !partial) {
      const subjectUri = this.resolveLabel(words[0], 'subject');
      if (subjectUri && this.index.subjectPredicates.has(subjectUri)) {
        contextLabel = `Predicates for ${words[0]}`;
        suggestions = this.filterMap(this.index.subjectPredicates.get(subjectUri)!, '');
      }
    }

    if (suggestions.length === 0) { dd.classList.remove('show'); return; }
    suggestions = suggestions.slice(0, 15);

    dd.innerHTML = `<div class="ac-header">${contextLabel}</div>` +
      suggestions.map(s =>
        `<div class="ac-item" data-value="${s.label}">${s.label}${s.detail ? ` <span style="color:#999;font-size:10px">${s.detail}</span>` : ''}</div>`
      ).join('');

    dd.classList.add('show');

    dd.querySelectorAll<HTMLElement>('.ac-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.insertCompletion(el.dataset.value!);
        dd.classList.remove('show');
      });
    });
  }

  private filterMap(map: Map<string, string>, q: string): Array<{ label: string; detail?: string }> {
    const out: Array<{ label: string; detail?: string }> = [];
    for (const [label] of map) {
      if (!q || label.toLowerCase().includes(q)) {
        out.push({ label });
      }
    }
    return out;
  }

  private resolveLabel(label: string, kind: 'subject' | 'predicate' | 'object'): string | null {
    if (!this.index) return null;
    if (label === 'a') return 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
    if (label.startsWith('?')) return null;

    const colonIdx = label.indexOf(':');
    if (colonIdx > 0) {
      const prefix = label.slice(0, colonIdx);
      const local = label.slice(colonIdx + 1);
      const ns = this.index.prefixes[prefix];
      if (ns) return ns + local;
    }

    if (kind === 'subject') return this.index.subjects.get(label) ?? null;
    if (kind === 'predicate') return this.index.allPredicates.get(label) ?? null;
    return this.index.allObjects.get(label) ?? null;
  }

  private insertCompletion(value: string): void {
    const ta = this.ta();
    const pos = ta.selectionStart;
    const text = ta.value;
    const before = text.substring(0, pos);
    const wordMatch = before.match(/[\w:._-]+$/);
    const start = wordMatch ? pos - wordMatch[0].length : pos;
    const after = text.substring(pos);
    ta.value = text.substring(0, start) + value + after;
    const newPos = start + value.length;
    ta.setSelectionRange(newPos, newPos);
    ta.focus();
    this.syncHighlight();
  }

  private handleKeydown(e: KeyboardEvent): void {
    const dd = this.dd();
    if (!dd.classList.contains('show')) return;

    const items = dd.querySelectorAll<HTMLElement>('.ac-item');
    const active = dd.querySelector<HTMLElement>('.ac-item.active');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (active) { active.classList.remove('active'); ((active.nextElementSibling as HTMLElement) || items[0])?.classList.add('active'); }
      else items[0]?.classList.add('active');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (active) { active.classList.remove('active'); ((active.previousElementSibling as HTMLElement) || items[items.length - 1])?.classList.add('active'); }
      else items[items.length - 1]?.classList.add('active');
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const sel = active || items[0];
      if (sel) { e.preventDefault(); this.insertCompletion(sel.dataset.value!); dd.classList.remove('show'); }
    } else if (e.key === 'Escape') {
      dd.classList.remove('show');
    }
  }

  // ---------------------------------------------------------------------------
  // Parse SPARQL → diagram highlighting
  // ---------------------------------------------------------------------------

  private parseAndHighlight(): void {
    const diagram = this.getDiagram();
    const schema = diagram?.getSchema();
    if (!diagram || !schema) { this.setStatus('No schema loaded'); return; }

    const text = this.ta().value.trim();
    if (!text) { this.setStatus(''); return; }

    const patterns = this.parseTriples(text);
    if (patterns.length === 0) { this.setStatus('No valid patterns'); return; }

    diagram.clearPaths();

    let matchCount = 0;
    for (const pat of patterns) {
      const matched = this.matchPattern(pat, schema, diagram);
      if (matched) matchCount++;
    }

    this.setStatus(matchCount > 0
      ? `Matched ${matchCount}/${patterns.length} patterns`
      : `0/${patterns.length} patterns matched`);
  }

  private parseTriples(text: string): Array<{ subject: string; predicate: string; object: string }> {
    const lines = text.split('\n');
    const patterns: Array<{ subject: string; predicate: string; object: string }> = [];

    const localPrefixes: Record<string, string> = {};
    for (const line of lines) {
      const pm = line.trim().match(/^PREFIX\s+(\w+):\s*<(.+)>$/i);
      if (pm) { localPrefixes[pm[1]] = pm[2]; continue; }
    }

    for (const line of lines) {
      let trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.match(/^PREFIX\s/i) ||
          trimmed.match(/^SELECT|^WHERE|^\{|^\}|^OPTIONAL|^LIMIT/i)) continue;
      trimmed = trimmed.replace(/\.\s*$/, '').trim();
      if (!trimmed) continue;

      const termPattern = '(?:\\?[\\w]+|[\\w._-]+:[\\w._-]+|<[^>]+>|"[^"]*"|\'[^\']*\'|a)';
      const re = new RegExp(`^(${termPattern})\\s+(${termPattern})\\s+(${termPattern})\\s*$`, 'i');
      const m = trimmed.match(re);
      if (m) {
        patterns.push({
          subject: m[1],
          predicate: m[2].toLowerCase() === 'a' ? 'rdf:type' : m[2],
          object: m[3],
        });
      } else {
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 3) {
          patterns.push({
            subject: parts[0],
            predicate: parts[1].toLowerCase() === 'a' ? 'rdf:type' : parts[1],
            object: parts.slice(2).join(' '),
          });
        }
      }
    }
    return patterns;
  }

  private matchPattern(
    pat: { subject: string; predicate: string; object: string },
    schema: CanonicalSchema,
    diagram: SchemaDiagram,
  ): boolean {
    const ln = (uri: string): string => {
      if (uri.includes('#')) return uri.split('#').pop()!;
      return uri.split('/').pop()!;
    };

    const resolveToLocal = (term: string): string => {
      if (term.startsWith('<') && term.endsWith('>')) return ln(term.slice(1, -1));
      if (term.includes(':')) return term.split(':').pop()!;
      return term;
    };

    const predLocal = resolveToLocal(pat.predicate);

    for (const triple of schema.triples) {
      const tPredLocal = ln(triple.predicate);
      if (tPredLocal.toLowerCase() !== predLocal.toLowerCase() &&
          triple.predicate !== pat.predicate &&
          !triple.predicate.endsWith('#' + predLocal) &&
          !triple.predicate.endsWith('/' + predLocal)) continue;

      if (!pat.subject.startsWith('?')) {
        const sLocal = resolveToLocal(pat.subject);
        const tSLocal = ln(triple.subject);
        if (sLocal.toLowerCase() !== tSLocal.toLowerCase()) continue;
      }
      if (!pat.object.startsWith('?') && !pat.object.startsWith('"')) {
        const oLocal = resolveToLocal(pat.object);
        const tOLocal = ln(triple.object);
        if (oLocal.toLowerCase() !== tOLocal.toLowerCase()) continue;
      }

      const path = diagram.findShortestPath(triple.subject, triple.object);
      if (path) {
        diagram.addPathFromEdgePath(path, `${ln(triple.subject)} → ${ln(triple.object)}`);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getDiagram(): SchemaDiagram | null {
    const id = this.getAttribute('diagram');
    return id ? document.getElementById(id) as SchemaDiagram | null : null;
  }

  private ta(): HTMLTextAreaElement {
    return this.root.querySelector('textarea')!;
  }

  private dd(): HTMLElement {
    return this.root.querySelector('.ac-drop')!;
  }

  private setStatus(msg: string): void {
    const el = this.root.querySelector('.se-status');
    if (el) el.textContent = msg;
  }

  private copyToClipboard(): void {
    navigator.clipboard.writeText(this.ta().value);
    const btn = this.root.querySelector<HTMLButtonElement>('.copy-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy'; }, 1500); }
  }
}

customElements.define('sparql-editor', SparqlEditor);
