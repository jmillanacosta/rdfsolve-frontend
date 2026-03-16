/**
 * Find Node Component
 *
 * Searchable text dropdown listing all nodes in the diagram.
 * Selecting a node zooms to it.  Replaces the old "Focus" control.
 *
 * Usage:
 *   <find-node diagram="diagram"></find-node>
 */

import type { SchemaDiagram } from './schema-diagram';

interface NodeInfo {
  uri: string;
  label: string;
  nodeType: string;
  /** Visual ID - only set if the node is currently rendered */
  id?: string;
}

export class FindNode extends HTMLElement {
  private root: ShadowRoot;
  private allNodes: NodeInfo[] = [];

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display:inline-flex; position:relative; }
        .fn-wrap { position:relative; display:flex; align-items:center; gap:4px; }
        label { font-size:12px; font-weight:500; color:#6e6e73; white-space:nowrap; }
        input { font-size:12px; padding:4px 8px; border:1px solid #d2d2d7; border-radius:4px;
                width:180px; background:#fff; }
        .dropdown { position:absolute; top:100%; left:0; right:0; z-index:1100;
                    max-height:240px; overflow-y:auto; background:#fff;
                    border:1px solid #d2d2d7; border-radius:4px; box-shadow:0 4px 12px rgba(0,0,0,.12);
                    display:none; margin-top:2px; }
        .dropdown.show { display:block; }
        .item { padding:5px 10px; cursor:pointer; font-size:12px; display:flex;
                justify-content:space-between; align-items:center; }
        .item:hover, .item.active { background:#f0f4ff; }
        .item .type { font-size:10px; color:#999; text-transform:uppercase; }
        .empty { padding:8px 10px; font-size:11px; color:#999; text-align:center; }
      </style>
      <div class="fn-wrap">
        <label>Find:</label>
        <input type="text" placeholder="Search nodes…" autocomplete="off" />
        <div class="dropdown"></div>
      </div>
    `;

    const input = this.root.querySelector<HTMLInputElement>('input')!;
    const dropdown = this.root.querySelector<HTMLElement>('.dropdown')!;

    input.addEventListener('input', () => this.showSuggestions(input.value, dropdown));
    input.addEventListener('focus', () => { if (input.value.length > 0) this.showSuggestions(input.value, dropdown); });
    input.addEventListener('blur', () => setTimeout(() => dropdown.classList.remove('show'), 200));

    input.addEventListener('keydown', (e) => {
      if (!dropdown.classList.contains('show')) return;
      const items = dropdown.querySelectorAll<HTMLElement>('.item');
      const active = dropdown.querySelector<HTMLElement>('.item.active');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (active) { active.classList.remove('active'); (active.nextElementSibling as HTMLElement)?.classList.add('active'); }
        else items[0]?.classList.add('active');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (active) { active.classList.remove('active'); (active.previousElementSibling as HTMLElement)?.classList.add('active'); }
        else items[items.length - 1]?.classList.add('active');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = dropdown.querySelector<HTMLElement>('.item.active') || items[0];
        if (sel) this.selectNode(sel.dataset.nodeId!, input, dropdown);
      } else if (e.key === 'Escape') {
        dropdown.classList.remove('show');
      }
    });

    // Listen for schema changes on diagram to rebuild list
    const diagram = this.getDiagram();
    if (diagram) {
      const rebuild = () => { this.allNodes = diagram.getAllSchemaNodes(); };
      // Use MutationObserver as fallback; ideally listen for custom event
      diagram.addEventListener('schema-loaded', rebuild);
      // Also hook into our own dataset-selector events
      document.addEventListener('schema-loaded-global', rebuild);
      rebuild();
    }
  }

  /** Rebuild the node list (call after schema changes). */
  refresh(): void {
    const diagram = this.getDiagram();
    if (diagram) {
      // Use all schema nodes (not just rendered ones) so search covers
      // every node across all loaded datasets.
      this.allNodes = diagram.getAllSchemaNodes();
    }
  }

  private getDiagram(): SchemaDiagram | null {
    const id = this.getAttribute('diagram');
    return id ? document.getElementById(id) as SchemaDiagram | null : null;
  }

  private showSuggestions(query: string, dropdown: HTMLElement): void {
    if (this.allNodes.length === 0) this.refresh();

    // Merge visual IDs from currently rendered nodes
    const diagram = this.getDiagram();
    if (diagram) {
      const rendered = diagram.getNodeList();
      const uriToId = new Map(rendered.map(n => [n.uri, n.id]));
      for (const node of this.allNodes) {
        node.id = uriToId.get(node.uri);
      }
    }

    const q = query.toLowerCase();
    const matches = q.length === 0
      ? this.allNodes.slice(0, 30)
      : this.allNodes.filter(n => n.label.toLowerCase().includes(q) || n.uri.toLowerCase().includes(q)).slice(0, 30);

    if (matches.length === 0) {
      dropdown.innerHTML = '<div class="empty">No nodes found</div>';
    } else {
      dropdown.innerHTML = matches.map(n =>
        `<div class="item" data-node-id="${n.id ?? n.uri}" title="${n.uri}">
          <span>${this.highlight(n.label, q)}</span>
          <span class="type">${n.nodeType}</span>
        </div>`
      ).join('');

      dropdown.querySelectorAll<HTMLElement>('.item').forEach(el => {
        el.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.selectNode(el.dataset.nodeId!, this.root.querySelector('input')!, dropdown);
        });
      });
    }
    dropdown.classList.add('show');
  }

  private highlight(text: string, q: string): string {
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text;
    return text.slice(0, i) + '<b>' + text.slice(i, i + q.length) + '</b>' + text.slice(i + q.length);
  }

  private selectNode(nodeId: string, input: HTMLInputElement, dropdown: HTMLElement): void {
    const node = this.allNodes.find(n => (n.id === nodeId) || (n.uri === nodeId));
    if (node) input.value = node.label;
    dropdown.classList.remove('show');

    const diagram = this.getDiagram();
    if (!diagram) return;

    // If the node has a visual ID and is currently rendered, zoom to it.
    // Otherwise add it as a root and re-render so it becomes visible.
    if (node?.id) {
      diagram.zoomToNode(node.id);
    } else if (node?.uri) {
      // Node is in the schema but not rendered - add as root
      const currentRoots = diagram.getState().getSelectedRoots();
      diagram.setRoots([...currentRoots, node.uri]);
      // After render, find the new visual ID and zoom
      requestAnimationFrame(() => {
        const rendered = diagram.getNodeList().find(n => n.uri === node.uri);
        if (rendered) diagram.zoomToNode(rendered.id);
      });
    }
    this.dispatchEvent(new CustomEvent('node-found', { detail: { nodeId: node?.id, uri: node?.uri } }));
  }
}

customElements.define('find-node', FindNode);
