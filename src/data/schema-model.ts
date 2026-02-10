/**
 * Canonical Schema Model
 * 
 * The single source of truth for the schema data. Converts raw JSON-LD
 * into a normalized structure with indices for efficient traversal.
 */

import type { 
  CanonicalTriple, 
  CanonicalSchema, 
  PrefixMap,
  NodeType 
} from '../types';
import { getLocalName, compactUri, expandCurie, isRdfTypePredicate } from '../iri/uri-utils';

// Re-export URI helpers so existing importers don't break during transition
export { getLocalName, compactUri, expandCurie, isRdfTypePredicate } from '../iri/uri-utils';

// =============================================================================
// Class-type detection
// =============================================================================

/** URIs that represent CLASSES. */
export const CLASS_TYPE_URIS = new Set([
  'http://www.w3.org/2002/07/owl#Class',
  'http://www.w3.org/2000/01/rdf-schema#Class',
  'http://www.w3.org/2000/01/rdf-schema#Datatype',
  'http://www.w3.org/2004/02/skos/core#Concept',
]);

/**
 * Create an empty canonical schema.
 */
export function createEmptySchema(): CanonicalSchema {
  return {
    triples: [],
    prefixes: {},
    subjects: new Set(),
    predicates: new Set(),
    objects: new Set(),
    classUris: new Set(),
    outgoing: new Map(),
    incoming: new Map(),
  };
}

/**
 * Add a triple to the schema, updating all indices.
 */
export function addTriple(schema: CanonicalSchema, triple: CanonicalTriple): void {
  schema.triples.push(triple);
  schema.subjects.add(triple.subject);
  schema.predicates.add(triple.predicate);
  schema.objects.add(triple.object);
  
  // Update outgoing index
  if (!schema.outgoing.has(triple.subject)) {
    schema.outgoing.set(triple.subject, []);
  }
  schema.outgoing.get(triple.subject)!.push(triple);
  
  // Update incoming index
  if (!schema.incoming.has(triple.object)) {
    schema.incoming.set(triple.object, []);
  }
  schema.incoming.get(triple.object)!.push(triple);
}

/**
 * Detect node type from URI patterns.
 */
export function detectNodeType(uri: string, objectType: 'uri' | 'literal' | 'blank', isTypeTarget = false): NodeType {
  if (objectType === 'literal') return 'literal';
  if (objectType === 'blank' || uri.startsWith('_:')) return 'blank';
  
  // If this is a target of rdf:type, it's a class
  if (isTypeTarget) return 'class';
  
  const lower = uri.toLowerCase();
  if (lower.includes('owl:class') || lower.includes('rdfs:class') || lower.endsWith(':class')) {
    return 'class';
  }
  
  // Default URIs to instance
  if (uri.includes(':') || uri.includes('/') || uri.includes('#')) {
    return 'instance';
  }
  
  return 'unknown';
}

// =============================================================================
// Post-parse enrichment
// =============================================================================

/**
 * Scan all triples and populate `schema.classUris`.
 * A URI is a class if:
 *   1. It is the *subject* of  `rdf:type  owl:Class / rdfs:Class / …`
 *   2. It is the *object* of any `rdf:type` triple
 *      (i.e., something says `X rdf:type <thisURI>` — so it acts as a type)
 *
 * Also removes the redundant `rdf:type → classType` triples from the
 * triples list and adjacency maps so downstream code never sees them.
 */
export function enrichSchemaWithClassInfo(schema: CanonicalSchema): void {
  const classUris = schema.classUris;

  // --- Pass 1: detect which URIs are classes ----------------------------------
  for (const t of schema.triples) {
    if (!t.isRdfType) continue;

    // Rule 1:  ?subject rdf:type owl:Class → subject is a class
    if (CLASS_TYPE_URIS.has(t.object)) {
      classUris.add(t.subject);
    }

    // Rule 2:  ?x rdf:type ?object → object acts as a type, so it's a class
    if (t.objectType === 'uri') {
      classUris.add(t.object);
    }
  }

  // --- Pass 2: remove "rdf:type → CLASS_TYPE_URIS" triples --------------------
  // These are meta-type declarations ("X is a class") — redundant in the diagram.
  const keep = (t: CanonicalTriple) =>
    !(t.isRdfType && CLASS_TYPE_URIS.has(t.object));

  schema.triples = schema.triples.filter(keep);

  // Rebuild adjacency for affected subjects / objects
  for (const uri of classUris) {
    const out = schema.outgoing.get(uri);
    if (out) {
      const filtered = out.filter(keep);
      if (filtered.length > 0) {
        schema.outgoing.set(uri, filtered);
      } else {
        schema.outgoing.delete(uri);
      }
    }
  }

  // Remove CLASS_TYPE_URIS entries from incoming
  for (const classTypeUri of CLASS_TYPE_URIS) {
    const inc = schema.incoming.get(classTypeUri);
    if (inc) {
      const filtered = inc.filter(keep);
      if (filtered.length > 0) {
        schema.incoming.set(classTypeUri, filtered);
      } else {
        schema.incoming.delete(classTypeUri);
      }
    }
  }
}
