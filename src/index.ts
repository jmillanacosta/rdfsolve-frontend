/**
 * Schema Diagram Component — Public API
 */

// Core component
export { SchemaDiagram } from './components/schema-diagram';

// UI components
export { DatasetSelector } from './components/dataset-selector';
export type { DatasetEntry } from './components/dataset-selector';
export { FindNode } from './components/find-node';
export { SparqlEditor } from './components/sparql-editor';
export { PathList } from './components/path-list';
export { NodeTooltip } from './components/node-tooltip';
export { IriResolver } from './components/iri-resolver';
export type { EndpointEntry } from './components/iri-resolver';
export { DiagramSettingsComponent } from './components/diagram-settings';
export { ResultsPanel } from './components/results-panel';

// Types
export type {
  JSONLDSchema,
  JSONLDNode,
  JSONLDValue,
  PrefixMap,
  CanonicalSchema,
  CanonicalTriple,
  PathTree,
  PathNode,
  PathEdge,
  VisualModel,
  NodeType,
  PathHighlight,
  DiagramStateSnapshot,
  DiagramEvent,
  DiagramEventHandler,
  IRIEntry,
  SPARQLExecutableJSONLD,
  KnownSource,
  KnownSourcesJSONLD,
} from './types';

export { STANDARD_PREFIXES } from './types';

// URI utilities
export {
  getLocalName,
  compactUri,
  compactUriOrBracket,
  expandCurie,
  isRdfTypePredicate,
  escapeHtml,
  shortenForDisplay,
} from './iri/uri-utils';

// Parsers
export { parseJSONLD } from './parsers/jsonld-parser';
export { parseCSV, coverageToSchema } from './parsers/csv-parser';

// Data model
export { createEmptySchema, addTriple, detectNodeType, enrichSchemaWithClassInfo, CLASS_TYPE_URIS } from './data/schema-model';
export {
  buildTree,
  buildTrees,
  expandTree,
  getNodeStats,
  getAvailableRoots,
  getNodeIdToUriMap,
  type BuildOptions,
  type ExpandOptions,
  type ExpandResult,
} from './data/view-builder';

// Layout
export { layoutTrees } from './layout/tree-layout';
export type { LayoutConfig } from './layout/tree-layout';

// Styles
export {
  type DiagramStyle,
  type TypographyStyle,
  type NodeDimensionStyle,
  type LayoutStyle,
  type StrokeStyle,
  type EdgeStyle,
  type NodeColorPair,
  type NodeColorsStyle,
  type ZoomStyle,
  type InteractionStyle,
  type BackgroundStyle,
  getStyle,
  setStyle,
  updateStyle,
  resetStyle,
  createStyle,
  getNodeColors,
  getTypeIndicator,
  darkenColor,
  lightenColor,
  createNodeColorPair,
  DEFAULT_STYLE,
  DARK_STYLE,
  HIGH_CONTRAST_STYLE,
  MINIMAL_STYLE,
  STYLE,
} from './layout/styles';

// Renderer
export { TreeRenderer } from './renderer/tree-renderer';
export type { TreeRendererOptions } from './renderer/tree-renderer';

// State
export {
  DiagramState,
  type DiagramMode,
  type PathInProgress,
  type ExpandedNode,
  type EnhancedPath,
} from './state/diagram-state';

// Settings
export {
  DiagramSettings,
  DEFAULT_EXCLUDED_NAMESPACES,
  type NamespaceEntry,
  type SettingsSnapshot,
} from './state/diagram-settings';

// IRI Manager
export { IRIManager, COMMON_PREFIXES } from './iri/iri-manager';

// SPARQL Composer
export {
  SPARQLComposer,
  type SPARQLComposerOptions,
  type QueryGenerationOptions,
  type EndpointInfo,
  type DatasetEndpoints,
} from './sparql/composer';

// SPARQL Query Executor
export {
  executeQuery,
  buildVariableMapFromQuery,
  buildVariableMapFromPaths,
  collectInstancesBySchemaNode,
  type QueryResult,
  type ResultCell,
  type ResultRow,
  type VariableMapping,
  type ExecuteOptions,
} from './sparql/query-executor';

// Algorithms
export {
  PathFinder,
  type NodePath,
  type EdgePath,
  type PathEdgeInfo,
  type PathFinderOptions,
} from './algorithms';
