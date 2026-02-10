/**
 * Node Tooltip Component
 *
 * On node click, shows an expansion panel anchored to the clicked SVG node.
 * The panel shows:
 * - Node label and type
 * - Incoming / outgoing degree
 * - Depth input (how many levels to expand)
 * - "Expand Incoming" / "Expand Outgoing" buttons
 *
 * Uses fixed positioning based on getBoundingClientRect so it works
 * correctly regardless of zoom/pan state.
 *
 * Usage:
 *   <node-tooltip diagram="diagram"></node-tooltip>
 */

import type { SchemaDiagram } from './schema-diagram';
import type { PathNode } from '../types';

export class NodeTooltip extends HTMLElement {
  private root: ShadowRoot;
  private currentNode: PathNode | null = null;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display:block; position:absolute; top:0; left:0; width:0; height:0;
                z-index:1200; pointer-events:none; }
        .nt-popup {
          position:fixed; background:#fff; border:1px solid #d2d2d7;
          border-radius:8px; box-shadow:0 4px 16px rgba(0,0,0,.18);
          padding:12px 16px; min-width:220px; pointer-events:auto;
          display:none; font-size:12px; font-family:system-ui,-apple-system,sans-serif;
        }
        .nt-popup.show { display:block; }
        .nt-header { font-weight:600; margin-bottom:4px; word-break:break-all; font-size:13px; }
        .nt-type { font-size:10px; color:#999; text-transform:uppercase; margin-bottom:10px; }
        .nt-stats { display:flex; gap:16px; margin-bottom:12px; }
        .nt-stat { text-align:center; }
        .nt-stat .num { font-size:18px; font-weight:600; color:#333; }
        .nt-stat .lbl { font-size:10px; color:#999; }
        .nt-degree-row { display:flex; align-items:center; gap:8px; margin-bottom:10px; }
        .nt-degree-row label { font-size:11px; color:#666; }
        .nt-degree-row input {
          width:50px; padding:3px 6px; font-size:12px; border:1px solid #d2d2d7;
          border-radius:4px; text-align:center;
        }
        .nt-actions { display:flex; gap:6px; }
        .nt-btn { flex:1; padding:6px 10px; font-size:11px; border:1px solid #d2d2d7;
                  border-radius:4px; background:#fff; cursor:pointer; text-align:center; }
        .nt-btn:hover { background:#f0f4ff; }
        .nt-btn:disabled { opacity:.4; cursor:default; }
        .nt-btn.primary { background:#0066cc; color:#fff; border-color:#0066cc; }
        .nt-btn.primary:hover { background:#0055aa; }
        .nt-close { position:absolute; top:6px; right:10px; cursor:pointer; font-size:14px;
                    color:#999; background:none; border:none; padding:2px 4px; }
        .nt-close:hover { color:#333; }
      </style>
      <div class="nt-popup">
        <button class="nt-close">\u2715</button>
        <div class="nt-header"></div>
        <div class="nt-type"></div>
        <div class="nt-stats"></div>
        <div class="nt-degree-row">
          <label>Depth:</label>
          <input type="number" class="nt-degree" min="1" max="10" value="1" />
        </div>
        <div class="nt-actions"></div>
      </div>
    `;

    this.root.querySelector('.nt-close')?.addEventListener('click', () => this.hide());

    // Listen for node clicks from diagram
    const diagram = this.getDiagram();
    if (diagram) {
      diagram.addEventListener('node-click', ((e: CustomEvent) => {
        this.showForNode(e.detail as PathNode);
      }) as EventListener);
    }

    // Close on outside mousedown
    document.addEventListener('mousedown', (e) => {
      if (!this.root.querySelector('.nt-popup.show')) return;
      const path = e.composedPath();
      if (!path.includes(this)) this.hide();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hide();
    });
  }

  // ---------------------------------------------------------------------------
  // Show / Hide
  // ---------------------------------------------------------------------------

  private showForNode(node: PathNode): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    // Don't show panel in path-drawing mode
    const mode = (diagram as any).getMode?.();
    if (mode === 'draw-path') return;

    this.currentNode = node;
    const stats = diagram.getExpansionStats(node.uri);
    const popup = this.root.querySelector<HTMLElement>('.nt-popup')!;

    // Header
    this.root.querySelector<HTMLElement>('.nt-header')!.textContent = node.label;
    this.root.querySelector<HTMLElement>('.nt-type')!.textContent = node.nodeType;

    // Stats
    const statsEl = this.root.querySelector<HTMLElement>('.nt-stats')!;
    if (stats) {
      statsEl.innerHTML = `
        <div class="nt-stat"><div class="num">${stats.incoming}</div><div class="lbl">Incoming (${stats.unseenIncoming} unseen)</div></div>
        <div class="nt-stat"><div class="num">${stats.outgoing}</div><div class="lbl">Outgoing (${stats.unseenOutgoing} unseen)</div></div>
      `;
    } else {
      statsEl.innerHTML = '';
    }

    // Reset degree
    const degreeInput = this.root.querySelector<HTMLInputElement>('.nt-degree')!;
    degreeInput.value = '1';

    // Actions
    const actionsEl = this.root.querySelector<HTMLElement>('.nt-actions')!;
    actionsEl.innerHTML = '';

    const inBtn = document.createElement('button');
    inBtn.className = 'nt-btn';
    inBtn.textContent = '\u2190 Incoming';
    inBtn.disabled = !stats || stats.unseenIncoming === 0;
    inBtn.addEventListener('click', () => this.doExpand('incoming'));
    actionsEl.appendChild(inBtn);

    const outBtn = document.createElement('button');
    outBtn.className = 'nt-btn primary';
    outBtn.textContent = 'Outgoing \u2192';
    outBtn.disabled = !stats || stats.unseenOutgoing === 0;
    outBtn.addEventListener('click', () => this.doExpand('outgoing'));
    actionsEl.appendChild(outBtn);

    // Position using getBoundingClientRect of the SVG node element (fixed positioning)
    this.positionPopup(node, popup);
    popup.classList.add('show');
  }

  private positionPopup(node: PathNode, popup: HTMLElement): void {
    const diagram = this.getDiagram();
    if (!diagram) return;

    // Access the shadow DOM of the diagram to find the SVG
    const shadow = (diagram as any).shadow as ShadowRoot | undefined;
    const svgContainer = shadow
      ? shadow.querySelector('.sd-diagram')
      : null;
    if (!svgContainer) return;

    const svg = svgContainer.querySelector('svg');
    if (!svg) return;

    const nodeGroup = svg.querySelector(`[data-node-id="${node.id}"]`) as SVGGElement | null;
    if (!nodeGroup) return;

    const nodeRect = nodeGroup.getBoundingClientRect();

    // Place to the right of the node, or left if near viewport edge
    const popupWidth = 240;
    let left = nodeRect.right + 8;
    let top = nodeRect.top;

    if (left + popupWidth > window.innerWidth - 16) {
      left = nodeRect.left - popupWidth - 8;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - 280));

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    this.root.querySelector('.nt-popup')?.classList.remove('show');
    this.currentNode = null;
  }

  private doExpand(direction: 'incoming' | 'outgoing'): void {
    if (!this.currentNode) return;
    const diagram = this.getDiagram();
    if (!diagram) return;

    const degreeInput = this.root.querySelector<HTMLInputElement>('.nt-degree')!;
    const maxNodes = parseInt(degreeInput.value, 10) || 1;

    const result = diagram.expandNode(this.currentNode.uri, { direction, maxNodes, nodeId: this.currentNode.id });
    if (result) {
      this.dispatchEvent(new CustomEvent('node-expanded', {
        detail: { nodeUri: this.currentNode.uri, direction, maxNodes, result },
      }));
    }
    this.hide();
  }

  private getDiagram(): SchemaDiagram | null {
    const id = this.getAttribute('diagram');
    return id ? document.getElementById(id) as SchemaDiagram | null : null;
  }
}

customElements.define('node-tooltip', NodeTooltip);
