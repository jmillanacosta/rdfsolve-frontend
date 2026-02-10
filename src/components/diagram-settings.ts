/**
 * Diagram Settings Component
 *
 * A gear-icon button that opens a popover with diagram settings.
 * Currently includes:
 *  - Namespace filtering (exclude namespaces from parsed schemas)
 *
 * Usage:
 *   <diagram-settings diagram="diagram"></diagram-settings>
 */

import { DiagramSettings, DEFAULT_EXCLUDED_NAMESPACES } from '../state/diagram-settings';
import type { SchemaDiagram } from './schema-diagram';
import type { DatasetSelector } from './dataset-selector';
import { escapeHtml } from '../iri/uri-utils';

export class DiagramSettingsComponent extends HTMLElement {
  private root: ShadowRoot;
  private settings = DiagramSettings.instance;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display: inline-block; position: relative; }

        .gear-btn {
          display: flex; align-items: center; justify-content: center;
          width: 30px; height: 30px; border: 1px solid #d2d2d7;
          border-radius: 4px; background: #fff; cursor: pointer;
          font-size: 16px; color: #555; transition: background .15s;
        }
        .gear-btn:hover { background: #f0f0f2; color: #333; }
        .gear-btn.active { background: #e8e8ea; }

        /* ── popover ── */
        .settings-pop {
          display: none; position: absolute; top: calc(100% + 4px); right: 0;
          z-index: 1300; background: #fff; border: 1px solid #d2d2d7;
          border-radius: 8px; box-shadow: 0 6px 24px rgba(0,0,0,.16);
          min-width: 320px; max-width: 420px; max-height: 70vh;
          overflow-y: auto; font-size: 12px;
          font-family: system-ui, -apple-system, sans-serif;
        }
        .settings-pop.open { display: block; }

        .pop-header {
          padding: 10px 14px; border-bottom: 1px solid #eee;
          display: flex; align-items: center; justify-content: space-between;
        }
        .pop-header h4 { margin: 0; font-size: 13px; font-weight: 600; }
        .pop-close { background: none; border: none; cursor: pointer;
                     font-size: 16px; color: #999; padding: 2px 4px; }
        .pop-close:hover { color: #333; }

        /* ── section ── */
        .section { padding: 10px 14px; }
        .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase;
                         letter-spacing: .4px; color: #888; margin-bottom: 8px; }
        .section-desc  { font-size: 10px; color: #999; margin-bottom: 8px; line-height: 1.4; }

        /* ── namespace list ── */
        .ns-list { display: flex; flex-direction: column; gap: 2px; }
        .ns-item {
          display: flex; align-items: center; gap: 6px; padding: 4px 6px;
          border-radius: 4px; cursor: pointer;
        }
        .ns-item:hover { background: #f5f6f8; }
        .ns-item input[type="checkbox"] { margin: 0; flex-shrink: 0; cursor: pointer; }
        .ns-item .ns-prefix { font-weight: 600; color: #0066cc; min-width: 70px; }
        .ns-item .ns-uri {
          font-family: 'SF Mono', Monaco, Menlo, monospace; font-size: 10px;
          color: #777; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .ns-item.excluded .ns-prefix { color: #cf222e; text-decoration: line-through; }

        /* ── actions ── */
        .actions {
          padding: 8px 14px; border-top: 1px solid #eee;
          display: flex; gap: 6px; justify-content: flex-end;
        }
        .actions button {
          font-size: 11px; padding: 4px 12px; border: 1px solid #d2d2d7;
          border-radius: 4px; background: #fff; cursor: pointer;
        }
        .actions button:hover { background: #f0f4ff; }
        .actions button.primary { background: #0066cc; color: #fff; border-color: #0066cc; }
        .actions button.primary:hover { background: #0055aa; }
      </style>

      <button class="gear-btn" title="Settings">⚙</button>
      <div class="settings-pop">
        <div class="pop-header">
          <h4>Settings</h4>
          <button class="pop-close">\u2715</button>
        </div>

        <div class="section">
          <div class="section-title">Namespace Filtering</div>
          <div class="section-desc">
            Checked namespaces are <strong>excluded</strong> from the diagram.
            Nodes and edges from these namespaces will be hidden when you render.
          </div>
          <div class="ns-list"></div>
        </div>

        <div class="actions">
          <button class="reset-btn">Reset defaults</button>
          <button class="apply-btn primary">Apply &amp; Re-render</button>
        </div>
      </div>
    `;

    this.bindEvents();
    this.renderNamespaceList();
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  private bindEvents(): void {
    const gearBtn = this.root.querySelector<HTMLButtonElement>('.gear-btn')!;
    const popup = this.root.querySelector<HTMLElement>('.settings-pop')!;

    // Toggle popover
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = popup.classList.toggle('open');
      gearBtn.classList.toggle('active', isOpen);
      if (isOpen) this.renderNamespaceList(); // refresh
    });

    // Close button
    this.root.querySelector('.pop-close')!.addEventListener('click', () => this.close());

    // Close on outside click
    document.addEventListener('mousedown', (e) => {
      if (!popup.classList.contains('open')) return;
      if (!(e.composedPath() as Node[]).includes(this)) this.close();
    });

    // Reset
    this.root.querySelector('.reset-btn')!.addEventListener('click', () => {
      this.settings.resetToDefaults();
      this.renderNamespaceList();
    });

    // Apply
    this.root.querySelector('.apply-btn')!.addEventListener('click', () => {
      this.applyAndRerender();
      this.close();
    });
  }

  // ── Render namespace list ──────────────────────────────────────────────────

  private renderNamespaceList(): void {
    const list = this.root.querySelector<HTMLElement>('.ns-list')!;
    const entries = this.settings.getNamespaces();

    if (entries.length === 0) {
      list.innerHTML = '<div style="color:#999;font-size:11px;padding:4px;">No namespaces discovered yet. Render a dataset first.</div>';
      return;
    }

    list.innerHTML = entries.map(e => `
      <label class="ns-item ${e.excluded ? 'excluded' : ''}" data-uri="${escapeHtml(e.uri)}">
        <input type="checkbox" ${e.excluded ? 'checked' : ''} data-ns-uri="${escapeHtml(e.uri)}" />
        <span class="ns-prefix">${escapeHtml(e.prefix)}</span>
        <span class="ns-uri" title="${escapeHtml(e.uri)}">${escapeHtml(e.uri)}</span>
      </label>
    `).join('');

    // Checkbox change → update settings immediately (visual feedback)
    list.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const uri = cb.dataset.nsUri!;
        this.settings.setNamespaceExcluded(uri, cb.checked);
        // Update visual style
        const item = cb.closest('.ns-item') as HTMLElement;
        item?.classList.toggle('excluded', cb.checked);
      });
    });
  }

  // ── Apply ──────────────────────────────────────────────────────────────────

  /**
   * Re-render the diagram by re-loading the current datasets.
   * This causes the JSON-LD to be re-parsed with the updated filters.
   */
  private applyAndRerender(): void {
    // Try dataset-selector first (it has the loaded schemas and handles merging)
    const selector = document.querySelector<DatasetSelector>('dataset-selector');
    if (selector) {
      // Force re-parse by clearing the cache and re-rendering
      selector.reloadAndRender();
      return;
    }

    // Fallback: if the diagram has a src attribute, reload it
    const diagram = this.getDiagram();
    if (diagram) {
      const src = diagram.getAttribute('src');
      if (src) diagram.loadFromURL(src);
    }
  }

  private close(): void {
    this.root.querySelector('.settings-pop')?.classList.remove('open');
    this.root.querySelector('.gear-btn')?.classList.remove('active');
  }

  private getDiagram(): SchemaDiagram | null {
    const id = this.getAttribute('diagram');
    return id ? document.getElementById(id) as SchemaDiagram | null : null;
  }
}

customElements.define('diagram-settings', DiagramSettingsComponent);
