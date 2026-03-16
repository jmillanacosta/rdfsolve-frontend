/**
 * JSON-LD Parser
 * 
 * Converts JSON-LD input into canonical schema format.
 */

import type { 
  JSONLDSchema, 
  JSONLDNode, 
  JSONLDValue,
  CanonicalSchema, 
  CanonicalTriple,
  PrefixMap 
} from '../types';
import { 
  createEmptySchema, 
  addTriple, 
  detectNodeType,
  enrichSchemaWithClassInfo,
} from '../data/schema-model';
import { getLocalName, isRdfTypePredicate, expandCurie } from '../iri/uri-utils';
import { STANDARD_PREFIXES } from '../types';
import { DiagramSettings } from '../state/diagram-settings';

/**
 * Parse JSON-LD into a canonical schema.
 *
 * Respects the global `DiagramSettings` namespace filters: nodes whose
 * `@id` falls under an excluded namespace are skipped entirely.
 */
export function parseJSONLD(input: JSONLDSchema): CanonicalSchema {
  const schema = createEmptySchema();
  const settings = DiagramSettings.instance;
  
  // Extract prefixes from @context
  schema.prefixes = extractPrefixes(input['@context']);

  // Extract the _labels map produced by the Python miner (CURIE -> label)
  const rawLabels = (input as Record<string, unknown>)['_labels'];
  if (rawLabels && typeof rawLabels === 'object' && !Array.isArray(rawLabels)) {
    schema.labels = rawLabels as Record<string, string>;
  }

  // Register discovered namespaces so the settings UI can show them
  settings.registerNamespacesFromPrefixes(schema.prefixes);
  
  // Get graph nodes
  const nodes = input['@graph'] || (input['@id'] ? [input as unknown as JSONLDNode] : []);
  
  // Process each node (skip nodes from excluded namespaces)
  for (const node of nodes) {
    const rawId = node['@id'];
    if (rawId) {
      const expanded = expandCurie(rawId, schema.prefixes);
      if (settings.isUriExcluded(expanded)) continue;
    }
    processNode(schema, node);
  }
  
  // Enrich: detect class URIs and remove redundant rdf:type->owl:Class triples
  enrichSchemaWithClassInfo(schema);
  
  return schema;
}

/**
 * Extract prefix map from JSON-LD @context.
 */
function extractPrefixes(context: JSONLDSchema['@context']): PrefixMap {
  const prefixes: PrefixMap = { ...STANDARD_PREFIXES };
  
  if (!context) return prefixes;
  
  if (typeof context === 'string') {
    // External context URL - we can't resolve it, skip
    return prefixes;
  }
  
  if (Array.isArray(context)) {
    for (const item of context) {
      if (typeof item === 'object') {
        Object.assign(prefixes, extractPrefixesFromObject(item));
      }
    }
  } else if (typeof context === 'object') {
    Object.assign(prefixes, extractPrefixesFromObject(context));
  }
  
  return prefixes;
}

function extractPrefixesFromObject(obj: Record<string, unknown>): PrefixMap {
  const prefixes: PrefixMap = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && (value.startsWith('http://') || value.startsWith('https://'))) {
      prefixes[key] = value;
    } else if (typeof value === 'object' && value !== null && '@id' in value) {
      const idValue = (value as { '@id': string })['@id'];
      if (typeof idValue === 'string') {
        prefixes[key] = idValue;
      }
    }
  }
  
  return prefixes;
}

/**
 * Look up a human-readable label for a URI.
 *
 * The labels map is keyed by CURIE (e.g. "aopo:KeyEvent").  We try a
 * reverse-lookup by compacting the expanded URI back to every known
 * prefix.  Falls back to `getLocalName()`.
 */
function labelFor(
  expandedUri: string,
  prefixes: PrefixMap,
  labels: Record<string, string>,
): string {
  // Try each prefix to form a CURIE, check in the labels map
  for (const [pfx, ns] of Object.entries(prefixes)) {
    if (expandedUri.startsWith(ns)) {
      const curie = `${pfx}:${expandedUri.slice(ns.length)}`;
      if (labels[curie]) return labels[curie];
    }
  }
  return getLocalName(expandedUri);
}

/**
 * Process a single JSON-LD node into triples.
 * Skips triples whose predicate or object URI belongs to an excluded namespace.
 */
function processNode(schema: CanonicalSchema, node: JSONLDNode): void {
  const rawSubject = node['@id'];
  if (!rawSubject) return;

  const settings = DiagramSettings.instance;
  
  // CRITICAL: expand the subject URI so ALL URIs in the schema are in
  // canonical expanded form.  The raw JSON-LD may use CURIEs like
  // "wp:Complex" - we must normalise to "http://...#Complex".
  const subjectUri = expandCurie(rawSubject, schema.prefixes);
  const subjectLabel = labelFor(subjectUri, schema.prefixes, schema.labels);
  
  // Process @type specially
  if (node['@type']) {
    const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
    for (const type of types) {
      const typeUri = expandCurie(type, schema.prefixes);
      if (settings.isUriExcluded(typeUri)) continue;
      addTriple(schema, {
        subject: subjectUri,
        predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
        object: typeUri,
        subjectLabel,
        predicateLabel: 'rdf:type',
        objectLabel: labelFor(typeUri, schema.prefixes, schema.labels),
        objectType: 'uri',
        isRdfType: true,
      });
    }
  }
  
  // Process other predicates
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@')) continue; // Skip JSON-LD keywords
    
    const predicateUri = expandCurie(key, schema.prefixes);
    if (settings.isUriExcluded(predicateUri)) continue;
    const predicateLabel = labelFor(predicateUri, schema.prefixes, schema.labels);
    const isRdfType = isRdfTypePredicate(predicateUri);
    
    const values = Array.isArray(value) ? value : [value];
    
    for (const v of values) {
      const triple = createTriple(
        subjectUri, 
        subjectLabel,
        predicateUri, 
        predicateLabel,
        v as JSONLDValue, 
        schema.prefixes,
        schema.labels,
        isRdfType
      );
      
      if (triple) {
        addTriple(schema, triple);
      }
    }
  }
}

/**
 * Create a triple from a JSON-LD value.
 */
function createTriple(
  subjectUri: string,
  subjectLabel: string,
  predicateUri: string,
  predicateLabel: string,
  value: JSONLDValue,
  prefixes: PrefixMap,
  labels: Record<string, string>,
  isRdfType: boolean
): CanonicalTriple | null {
  if (value === null || value === undefined) return null;
  
  if (typeof value === 'string') {
    // Could be a CURIE or literal
    const expanded = expandCurie(value, prefixes);
    const isUri = expanded.startsWith('http://') || expanded.startsWith('https://') || expanded.startsWith('_:');
    
    return {
      subject: subjectUri,
      predicate: predicateUri,
      object: expanded,
      subjectLabel,
      predicateLabel,
      objectLabel: isUri ? labelFor(expanded, prefixes, labels) : value,
      objectType: isUri ? (expanded.startsWith('_:') ? 'blank' : 'uri') : 'literal',
      isRdfType,
    };
  }
  
  if (typeof value === 'object') {
    if ('@id' in value) {
      const objectUri = expandCurie(value['@id'], prefixes);
      return {
        subject: subjectUri,
        predicate: predicateUri,
        object: objectUri,
        subjectLabel,
        predicateLabel,
        objectLabel: labelFor(objectUri, prefixes, labels),
        objectType: objectUri.startsWith('_:') ? 'blank' : 'uri',
        isRdfType,
      };
    }
    
    if ('@value' in value) {
      return {
        subject: subjectUri,
        predicate: predicateUri,
        object: String(value['@value']),
        subjectLabel,
        predicateLabel,
        objectLabel: String(value['@value']),
        objectType: 'literal',
        isRdfType: false,
        datatype: value['@type'],
        language: value['@language'],
      };
    }
  }
  
  return null;
}

