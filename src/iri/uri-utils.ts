/**
 * URI Utilities - shared helpers for URI/IRI/CURIE manipulation.
 *
 * Single source of truth for local-name extraction, prefix expansion,
 * compaction, and HTML escaping used throughout the project.
 */

import type { PrefixMap } from '../types';

// =============================================================================
// Local Name Extraction
// =============================================================================

/** Extract the local name from a URI (fragment or last path segment). */
export function getLocalName(uri: string): string {
  if (uri.includes('#')) return uri.split('#').pop() || uri;
  if (uri.includes('/')) return uri.split('/').pop() || uri;
  if (uri.includes(':')) {
    const parts = uri.split(':');
    return parts[parts.length - 1] || uri;
  }
  return uri;
}

// =============================================================================
// CURIE <-> URI Conversion
// =============================================================================

/** Compact a full URI to a CURIE using a prefix map. */
export function compactUri(uri: string, prefixes: PrefixMap): string {
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    if (uri.startsWith(namespace)) {
      return `${prefix}:${uri.slice(namespace.length)}`;
    }
  }
  return uri;
}

/** Compact a full URI to a CURIE, or wrap in angle brackets if no prefix matches. */
export function compactUriOrBracket(uri: string, prefixes: PrefixMap): string {
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    if (uri.startsWith(namespace)) {
      return `${prefix}:${uri.slice(namespace.length)}`;
    }
  }
  return `<${uri}>`;
}

/** Expand a CURIE to a full URI using a prefix map. Returns the input unchanged if already a URI. */
export function expandCurie(value: string, prefixes: PrefixMap): string {
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('_:')) {
    return value;
  }
  const colonIndex = value.indexOf(':');
  if (colonIndex > 0) {
    const prefix = value.slice(0, colonIndex);
    const localName = value.slice(colonIndex + 1);
    const namespace = prefixes[prefix];
    if (namespace) return namespace + localName;
  }
  return value;
}

// =============================================================================
// Display Helpers
// =============================================================================

/** Shorten a URI for display, using prefix compaction with a fallback to local name. */
export function shortenForDisplay(
  uri: string,
  prefixes?: PrefixMap,
): string {
  if (prefixes) {
    const compacted = compactUri(uri, prefixes);
    if (compacted !== uri) return compacted;
  }
  return getLocalName(uri);
}

// =============================================================================
// HTML Escaping
// =============================================================================

/** Escape a string for safe HTML insertion. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================================================
// Predicate Helpers
// =============================================================================

const RDF_TYPE_URI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/** Check if a URI is the rdf:type predicate. */
export function isRdfTypePredicate(uri: string): boolean {
  return uri === RDF_TYPE_URI || uri === 'rdf:type' || uri.endsWith('#type');
}
