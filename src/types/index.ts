/**
 * Schema Diagram Types - Complete Type Definitions
 * 
 * All data flows through these types. Each module consumes and produces
 * well-defined structures that can be serialized as JSON-LD.
 */

// =============================================================================
// PREFIX / CONTEXT
// =============================================================================

/** Map of prefix → namespace URI */
export type PrefixMap = Record<string, string>;

/** Standard prefixes we always include */
export const STANDARD_PREFIXES: PrefixMap = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  sh: 'http://www.w3.org/ns/shacl#',
  schema: 'https://schema.org/',
  dc: 'http://purl.org/dc/elements/1.1/',
  dcterms: 'http://purl.org/dc/terms/',
  void: 'http://rdfs.org/ns/void#',
  sd: 'http://www.w3.org/ns/sparql-service-description#',
};

// =============================================================================
// INPUT: JSON-LD SCHEMA
// =============================================================================

/** Raw JSON-LD input format */
export interface JSONLDSchema {
  '@context': PrefixMap | string | (PrefixMap | string)[];
  '@graph'?: JSONLDNode[];
  '@id'?: string;
  [predicate: string]: unknown;
}

/** A node in JSON-LD @graph */
export interface JSONLDNode {
  '@id': string;
  '@type'?: string | string[];
  [predicate: string]: JSONLDValue | JSONLDValue[] | string | string[] | undefined;
}

/** Possible values in JSON-LD */
export type JSONLDValue = 
  | string 
  | { '@id': string } 
  | { '@value': string; '@type'?: string; '@language'?: string };

// =============================================================================
// CANONICAL MODEL
// =============================================================================

/** A single RDF triple in canonical form */
export interface CanonicalTriple {
  subject: string;          // Subject URI
  predicate: string;        // Predicate URI
  object: string;           // Object URI or literal value
  
  subjectLabel?: string;    // Short label for display
  predicateLabel?: string;
  objectLabel?: string;
  
  objectType: 'uri' | 'literal' | 'blank';
  isRdfType: boolean;       // predicate === rdf:type
  
  // Optional metadata
  datatype?: string;        // For literals
  language?: string;        // For literals
}

/** The canonical schema - single source of truth for triples */
export interface CanonicalSchema {
  triples: CanonicalTriple[];
  prefixes: PrefixMap;
  
  // Computed indices
  subjects: Set<string>;        // All unique subjects
  predicates: Set<string>;      // All unique predicates
  objects: Set<string>;         // All unique objects
  
  /** URIs that are known to be classes (have rdf:type owl:Class, rdfs:Class, etc.) */
  classUris: Set<string>;
  
  // Adjacency for traversal
  outgoing: Map<string, CanonicalTriple[]>;  // subject → triples
  incoming: Map<string, CanonicalTriple[]>;  // object → triples
}

// =============================================================================
// VISUAL MODEL: PATH TREES
// =============================================================================

/** Node type for visual styling */
export type NodeType = 'class' | 'instance' | 'literal' | 'blank' | 'unknown';

/** A node in the visual path tree */
export interface PathNode {
  /** Unique visual ID (may differ from URI if node appears multiple times) */
  id: string;
  
  /** Original URI */
  uri: string;
  
  /** Display label */
  label: string;
  
  /** Node type for styling */
  nodeType: NodeType;
  
  /** Position (computed by layout) */
  x: number;
  y: number;
  width: number;
  height: number;
  
  /** Tree position */
  column: number;   // 0 = root, 1 = first level objects, etc.
  row: number;      // Position within column
  
  /** Connection ports (for edge routing) */
  inPort: { x: number; y: number };
  outPort: { x: number; y: number };
  
  /** For nodes that are rdf:type targets (owl:Class etc) */
  isTypeNode?: boolean;
}

/** An edge in the visual path tree */
export interface PathEdge {
  id: string;
  sourceId: string;
  targetId: string;
  
  predicate: string;
  label: string;
  
  isRdfType: boolean;
  
  /** True if this edge represents an incoming triple (object→subject direction) */
  isIncoming?: boolean;
  
  /** SVG path data (computed by layout) */
  path: string;
}

/** A complete path tree from one root subject */
export interface PathTree {
  /** Unique ID for this tree */
  id: string;
  
  /** Root subject URI */
  rootUri: string;
  rootLabel: string;
  
  /** Nodes and edges */
  nodes: PathNode[];
  edges: PathEdge[];
  
  /** Bounding box (computed by layout) */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/** Complete visual model - multiple path trees */
export interface VisualModel {
  trees: PathTree[];
  totalBounds: {
    width: number;
    height: number;
  };
}

// =============================================================================
// DIAGRAM STATE
// =============================================================================

/** A highlighted path through the diagram */
export interface PathHighlight {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
  colorIndex: number;
  label?: string;
}

/** Current diagram state */
export interface DiagramStateSnapshot {
  selectedRoots: string[];          // Which root subjects are displayed
  selectedNodeId: string | null;    // Currently selected node
  hoveredNodeId: string | null;     // Currently hovered node
  highlightedPaths: PathHighlight[];
}

// =============================================================================
// IRI ENTRY (for IRI Manager)
// =============================================================================

/** An IRI entry with user and backend mappings */
export interface IRIEntry {
  /** The IRI the user entered or selected */
  user_input_iri: string;
  
  /** IRIs the user has mapped this to */
  user_input_mapped_iris: string[];
  
  /** IRIs the backend has mapped this to (via SPARQL lookup) */
  backend_mapped_iris: string[];
  
  /** User-provided label */
  user_input_label?: string;
  
  /** Resolved rdf:types */
  resolved_types?: string[];
  
  /** Source datasets where this IRI was found */
  found_in_datasets?: string[];
}

// =============================================================================
// SPARQL OUTPUT (JSON-LD with SHACL)
// =============================================================================

/** SPARQL query as JSON-LD using sh:SPARQLExecutable */
export interface SPARQLExecutableJSONLD {
  '@context': PrefixMap & {
    sh: string;
    schema?: string;
    sd?: string;
  };
  '@id': string;
  '@type': string | string[];
  
  'sh:select'?: string;
  'sh:construct'?: string;
  'sh:ask'?: string;
  
  'sh:prefixes'?: PrefixMap;
  
  'schema:dateCreated'?: string;
  'schema:description'?: string;
  
  'schema:target'?: {
    '@type': string;
    'sd:endpoint': string;
  };
}

// =============================================================================
// KNOWN SOURCES
// =============================================================================

/** A known SPARQL endpoint */
export interface KnownSource {
  '@id': string;
  '@type': string[];
  'dcterms:title': string;
  'sd:endpoint': { '@id': string };
  'void:sparqlEndpoint'?: { '@id': string };
  'dcterms:description'?: string;
}

/** Known sources JSON-LD document */
export interface KnownSourcesJSONLD {
  '@context': PrefixMap;
  '@graph': KnownSource[];
}

// =============================================================================
// EVENTS
// =============================================================================

/** Events emitted by the diagram */
export type DiagramEvent = 
  | { type: 'schema-loaded'; schema: CanonicalSchema }
  | { type: 'roots-changed'; roots: string[] }
  | { type: 'node-click'; node: PathNode }
  | { type: 'edge-click'; edge: PathEdge }
  | { type: 'node-hover'; node: PathNode | null }
  | { type: 'selection-changed'; selectedNodeId: string | null }
  | { type: 'paths-changed'; paths: PathHighlight[] }
  | { type: 'error'; message: string };

export type DiagramEventHandler = (event: DiagramEvent) => void;
