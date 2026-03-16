/**
 * Diagram Settings - Centralized configuration store
 *
 * Manages user-facing settings such as excluded namespaces.
 * Persists to localStorage and fires change events so components
 * can react (e.g. re-parse schemas when filters change).
 *
 * Usage:
 *   const settings = DiagramSettings.instance;
 *   settings.onChange(() => reloadSchema());
 *   settings.isNamespaceExcluded('http://www.openlinksw.com/schemas/virtrdf#');
 */

// ── Default excluded namespace URIs ──────────────────────────────────────────

/** Namespace URIs excluded by default (infrastructure / non-domain) */
export const DEFAULT_EXCLUDED_NAMESPACES: ReadonlyArray<{ prefix: string; uri: string; label: string }> = [
  { prefix: 'virtrdf', uri: 'http://www.openlinksw.com/schemas/virtrdf#', label: 'Virtuoso RDF Views' },
  { prefix: 'owl',     uri: 'http://www.w3.org/2002/07/owl#',             label: 'OWL Ontology' },
  { prefix: 'sh',      uri: 'http://www.w3.org/ns/shacl#',                label: 'SHACL Shapes' },
  { prefix: 'sd',      uri: 'http://www.w3.org/ns/sparql-service-description#', label: 'SPARQL Service Description' },
];

const STORAGE_KEY = 'schema-diagram-settings';

// ── Types ────────────────────────────────────────────────────────────────────

export interface NamespaceEntry {
  prefix: string;
  uri: string;
  label: string;
  excluded: boolean;
}

export interface SettingsSnapshot {
  namespaces: NamespaceEntry[];
}

type ChangeListener = () => void;

// ── Singleton ────────────────────────────────────────────────────────────────

/**
 * Central settings store.  Uses a singleton so every component sees
 * the same state without prop-drilling.
 */
export class DiagramSettings {
  private static _instance: DiagramSettings | null = null;

  /** Namespace URI -> excluded flag */
  private excludedNamespaces = new Map<string, boolean>();

  /** All known namespace entries (for the UI) */
  private namespaceEntries: NamespaceEntry[] = [];

  private listeners: ChangeListener[] = [];

  private constructor() {
    this.loadDefaults();
    this.loadFromStorage();
  }

  static get instance(): DiagramSettings {
    if (!DiagramSettings._instance) {
      DiagramSettings._instance = new DiagramSettings();
    }
    return DiagramSettings._instance;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Subscribe to changes. Returns an unsubscribe function. */
  onChange(fn: ChangeListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  /** Check whether a full namespace URI is excluded. */
  isNamespaceExcluded(namespaceUri: string): boolean {
    return this.excludedNamespaces.get(namespaceUri) ?? false;
  }

  /**
   * Check whether a full IRI belongs to an excluded namespace.
   * This is the primary filter used during parsing.
   */
  isUriExcluded(uri: string): boolean {
    for (const [ns, excluded] of this.excludedNamespaces) {
      if (excluded && uri.startsWith(ns)) return true;
    }
    return false;
  }

  /** Get all known namespace entries (for the settings UI). */
  getNamespaces(): ReadonlyArray<NamespaceEntry> {
    return this.namespaceEntries;
  }

  /** Toggle a namespace's excluded state. */
  setNamespaceExcluded(namespaceUri: string, excluded: boolean): void {
    this.excludedNamespaces.set(namespaceUri, excluded);
    const entry = this.namespaceEntries.find(e => e.uri === namespaceUri);
    if (entry) entry.excluded = excluded;
    this.persist();
    this.notify();
  }

  /**
   * Register namespaces discovered from a schema's `@context`.
   * New namespaces are added as non-excluded unless they match a default.
   */
  registerNamespacesFromPrefixes(prefixes: Record<string, string>): void {
    let changed = false;
    for (const [prefix, uri] of Object.entries(prefixes)) {
      if (this.excludedNamespaces.has(uri)) continue; // already known
      const isDefaultExcluded = DEFAULT_EXCLUDED_NAMESPACES.some(d => d.uri === uri);
      this.excludedNamespaces.set(uri, isDefaultExcluded);
      this.namespaceEntries.push({
        prefix,
        uri,
        label: prefix,
        excluded: isDefaultExcluded,
      });
      changed = true;
    }
    if (changed) {
      // Sort: excluded first, then alphabetically by prefix
      this.namespaceEntries.sort((a, b) => {
        if (a.excluded !== b.excluded) return a.excluded ? -1 : 1;
        return a.prefix.localeCompare(b.prefix);
      });
      this.persist();
      // Don't notify here - registering is passive, not a user action
    }
  }

  /** Reset all namespace filters to defaults. */
  resetToDefaults(): void {
    // Keep all entries but reset excluded state
    for (const entry of this.namespaceEntries) {
      const isDefault = DEFAULT_EXCLUDED_NAMESPACES.some(d => d.uri === entry.uri);
      entry.excluded = isDefault;
      this.excludedNamespaces.set(entry.uri, isDefault);
    }
    this.persist();
    this.notify();
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private loadDefaults(): void {
    for (const ns of DEFAULT_EXCLUDED_NAMESPACES) {
      this.excludedNamespaces.set(ns.uri, true);
      this.namespaceEntries.push({ ...ns, excluded: true });
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { excludedUris?: string[] };
      if (!Array.isArray(data.excludedUris)) return;

      // Build a set of explicitly excluded URIs from storage
      const storedExcluded = new Set(data.excludedUris);

      // Update existing entries
      for (const entry of this.namespaceEntries) {
        entry.excluded = storedExcluded.has(entry.uri);
        this.excludedNamespaces.set(entry.uri, entry.excluded);
      }

      // Add any stored URIs that aren't in defaults (user-added)
      for (const uri of storedExcluded) {
        if (!this.excludedNamespaces.has(uri)) {
          this.excludedNamespaces.set(uri, true);
          // Try to derive a prefix from the URI
          const prefix = uri.replace(/[#/]$/, '').split(/[#/]/).pop() ?? uri;
          this.namespaceEntries.push({ prefix, uri, label: prefix, excluded: true });
        }
      }
    } catch {
      // Corrupted storage - ignore
    }
  }

  private persist(): void {
    try {
      const excludedUris = [...this.excludedNamespaces.entries()]
        .filter(([, excluded]) => excluded)
        .map(([uri]) => uri);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ excludedUris }));
    } catch {
      // Storage unavailable - ignore
    }
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch { /* listener errors don't propagate */ }
    }
  }
}
