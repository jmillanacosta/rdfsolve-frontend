/**
 * IRI Manager
 * 
 * Manages IRI entries for the diagram.
 * Handles prefix/namespace management and CURIE conversion.
 */

import type { 
  IRIEntry, 
  PrefixMap,
  CanonicalSchema,
} from '../types';
import { STANDARD_PREFIXES } from '../types';
import { getLocalName, compactUri, expandCurie } from './uri-utils';

export const COMMON_PREFIXES: PrefixMap = {
  ...STANDARD_PREFIXES,
  'skos': 'http://www.w3.org/2004/02/skos/core#',
  'foaf': 'http://xmlns.com/foaf/0.1/',
};

/**
 * IRI Manager class.
 */
export class IRIManager {
  private prefixes: PrefixMap = {};
  private reverseMap = new Map<string, string>(); // namespace -> prefix
  private entries = new Map<string, IRIEntry>();
  
  constructor(initialPrefixes?: PrefixMap) {
    // Load common prefixes
    for (const [prefix, namespace] of Object.entries(COMMON_PREFIXES)) {
      this.addPrefix(prefix, namespace);
    }
    
    // Load custom prefixes
    if (initialPrefixes) {
      for (const [prefix, namespace] of Object.entries(initialPrefixes)) {
        this.addPrefix(prefix, namespace);
      }
    }
  }
  
  // ==========================================================================
  // Prefix Management
  // ==========================================================================
  
  addPrefix(prefix: string, namespace: string): void {
    this.prefixes[prefix] = namespace;
    this.reverseMap.set(namespace, prefix);
  }
  
  removePrefix(prefix: string): void {
    const ns = this.prefixes[prefix];
    if (ns) {
      delete this.prefixes[prefix];
      this.reverseMap.delete(ns);
    }
  }
  
  getPrefix(namespace: string): string | undefined {
    return this.reverseMap.get(namespace);
  }
  
  getNamespace(prefix: string): string | undefined {
    return this.prefixes[prefix];
  }
  
  getPrefixMap(): PrefixMap {
    return { ...this.prefixes };
  }
  
  // ==========================================================================
  // CURIE Conversion
  // ==========================================================================
  
  toCURIE(iri: string): string {
    return compactUri(iri, this.prefixes);
  }
  
  toIRI(curie: string): string {
    return expandCurie(curie, this.prefixes);
  }
  
  isCURIE(str: string): boolean {
    const colonIndex = str.indexOf(':');
    if (colonIndex < 0) return false;
    const prefix = str.slice(0, colonIndex);
    return prefix in this.prefixes;
  }
  
  getLocalName(iriOrCurie: string): string {
    return getLocalName(iriOrCurie);
  }
  
  getLabel(iri: string): string {
    return getLocalName(this.toCURIE(iri));
  }
  
  // ==========================================================================
  // IRI Entry Management
  // ==========================================================================
  
  createEntry(userIri: string, label?: string): IRIEntry {
    const entry: IRIEntry = {
      user_input_iri: userIri,
      user_input_mapped_iris: [],
      backend_mapped_iris: [],
      user_input_label: label || this.getLabel(userIri),
    };
    this.entries.set(userIri, entry);
    return entry;
  }
  
  getEntry(iri: string): IRIEntry | undefined {
    return this.entries.get(iri);
  }
  
  getOrCreateEntry(iri: string, label?: string): IRIEntry {
    const existing = this.entries.get(iri);
    if (existing) return existing;
    return this.createEntry(iri, label);
  }
  
  getEntries(): IRIEntry[] {
    return [...this.entries.values()];
  }
  
  updateEntry(iri: string, updates: Partial<IRIEntry>): boolean {
    const entry = this.entries.get(iri);
    if (!entry) return false;
    Object.assign(entry, updates);
    return true;
  }
  
  removeEntry(iri: string): boolean {
    return this.entries.delete(iri);
  }
  
  clearEntries(): void {
    this.entries.clear();
  }
  
  addUserMapping(iri: string, mappedIri: string): void {
    const entry = this.getOrCreateEntry(iri);
    if (!entry.user_input_mapped_iris.includes(mappedIri)) {
      entry.user_input_mapped_iris.push(mappedIri);
    }
  }
  
  addBackendMapping(iri: string, mappedIri: string): void {
    const entry = this.getOrCreateEntry(iri);
    if (!entry.backend_mapped_iris.includes(mappedIri)) {
      entry.backend_mapped_iris.push(mappedIri);
    }
  }
  
  // ==========================================================================
  // Schema Integration
  // ==========================================================================
  
  registerFromSchema(schema: CanonicalSchema): void {
    for (const [prefix, namespace] of Object.entries(schema.prefixes)) {
      this.addPrefix(prefix, namespace);
    }
    
    for (const subjectUri of schema.subjects) {
      this.getOrCreateEntry(subjectUri);
    }
    
    for (const triple of schema.triples) {
      if (triple.objectType === 'uri') {
        this.getOrCreateEntry(triple.object);
      }
    }
  }
  
  // ==========================================================================
  // Serialization
  // ==========================================================================
  
  toPrefixDeclarations(): string {
    const lines: string[] = [];
    for (const [prefix, namespace] of Object.entries(this.prefixes)) {
      lines.push('PREFIX ' + prefix + ': <' + namespace + '>');
    }
    return lines.join('\n');
  }
  
  toJSONLDContext(): PrefixMap {
    return { ...this.prefixes };
  }
}
