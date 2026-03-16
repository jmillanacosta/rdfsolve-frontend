/**
 * Style System for Schema Diagram
 * Provides typed interfaces for customizing diagram appearance.
 */

// =============================================================================
// STYLE INTERFACES
// =============================================================================

export interface TypographyStyle {
  fontFamily: string;
  fontFamilyBold: string;
  fontSize: number;
  headerFontSize: number;
  valueFontSize: number;
  edgeFontSize: number;
}

export interface NodeDimensionStyle {
  width: number;
  height: number;
  radius: number;
  margin: number;
  headerHeight: number;
  marginLeft: number;
  marginRight: number;
}

export interface LayoutStyle {
  horizontalGap: number;
  verticalGap: number;
  treeGap: number;
  padding: number;
}

export interface StrokeStyle {
  width: number;
  color: string;
  selectedWidth: number;
  selectedColor: string;
}

export interface EdgeStyle {
  color: string;
  width: number;
  rdfTypeWidth: number;
  arrowWidth: number;
  arrowHeight: number;
  labelColor: string;
}

export interface NodeColorPair {
  bg: string;
  header: string;
}

export interface NodeColorsStyle {
  class: NodeColorPair;
  instance: NodeColorPair;
  literal: NodeColorPair;
  unknown: NodeColorPair;
  blank: NodeColorPair;
}

export interface TextColorsStyle {
  primary: string;
  header: string;
  typeIndicator: string;
  edge: string;
}

export interface ZoomStyle {
  min: number;
  max: number;
  initial: number;
}

export interface InteractionStyle {
  hoverOpacity: number;
  hoverColor: string;
}

export interface BackgroundStyle {
  diagram: string;
  labelBg: string;
}

export interface DiagramStyle {
  typography: TypographyStyle;
  node: NodeDimensionStyle;
  layout: LayoutStyle;
  stroke: StrokeStyle;
  edge: EdgeStyle;
  nodeColors: NodeColorsStyle;
  textColors: TextColorsStyle;
  highlightColors: readonly string[];
  zoom: ZoomStyle;
  interaction: InteractionStyle;
  background: BackgroundStyle;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

export function darkenColor(hex: string, amount = 0.15): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, ((num >> 16) & 0xff) - Math.round(255 * amount));
  const g = Math.max(0, ((num >> 8) & 0xff) - Math.round(255 * amount));
  const b = Math.max(0, (num & 0xff) - Math.round(255 * amount));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export function lightenColor(hex: string, amount = 0.15): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amount));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amount));
  const b = Math.min(255, (num & 0xff) + Math.round(255 * amount));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

export function createNodeColorPair(baseBg: string, headerDarken = 0.1): NodeColorPair {
  return { bg: baseBg, header: darkenColor(baseBg, headerDarken) };
}

// =============================================================================
// DEFAULT STYLE (Ruby chart generator)
// =============================================================================

const RUBY_COLORS = {
  class: '#fff4c3',
  instance: '#ffce9f',
  literal: '#f8cecc',
  unknown: '#e0e0e0',
  blank: '#f2f2e9',
};

export const DEFAULT_STYLE: DiagramStyle = {
  typography: {
    fontFamily: 'Helvetica, Arial, sans-serif',
    fontFamilyBold: 'Helvetica-bold, Arial, sans-serif',
    fontSize: 12,
    headerFontSize: 11,
    valueFontSize: 12,
    edgeFontSize: 10,
  },
  node: {
    width: 180,
    height: 50,
    radius: 7.5,
    margin: 20,
    headerHeight: 20,
    marginLeft: 8,
    marginRight: 8,
  },
  layout: {
    horizontalGap: 240,
    verticalGap: 70,
    treeGap: 60,
    padding: 50,
  },
  stroke: {
    width: 2,
    color: '#000000',
    selectedWidth: 3,
    selectedColor: '#2196f3',
  },
  edge: {
    color: '#333333',
    width: 1.5,
    rdfTypeWidth: 2,
    arrowWidth: 6,
    arrowHeight: 5,
    labelColor: '#555555',
  },
  nodeColors: {
    class: createNodeColorPair(RUBY_COLORS.class),
    instance: createNodeColorPair(RUBY_COLORS.instance),
    literal: createNodeColorPair(RUBY_COLORS.literal),
    unknown: createNodeColorPair(RUBY_COLORS.unknown),
    blank: createNodeColorPair(RUBY_COLORS.blank),
  },
  textColors: {
    primary: '#000000',
    header: '#333333',
    typeIndicator: '#666666',
    edge: '#555555',
  },
  highlightColors: [
    '#4285f4', '#ea4335', '#34a853', '#fbbc04', '#9c27b0',
    '#00acc1', '#ff7043', '#7cb342', '#5c6bc0', '#f06292',
  ],
  zoom: { min: 0.05, max: 10, initial: 1 },
  interaction: { hoverOpacity: 0.85, hoverColor: '#2196f3' },
  background: { diagram: '#ffffff', labelBg: '#ffffff' },
};

// =============================================================================
// STYLE MANAGER
// =============================================================================

let currentStyle: DiagramStyle = structuredClone(DEFAULT_STYLE);

export function getStyle(): DiagramStyle { return currentStyle; }

export function setStyle(style: DiagramStyle): void { currentStyle = style; }

export function updateStyle(updates: DeepPartial<DiagramStyle>): DiagramStyle {
  currentStyle = deepMerge(currentStyle, updates);
  return currentStyle;
}

export function resetStyle(): DiagramStyle {
  currentStyle = structuredClone(DEFAULT_STYLE);
  return currentStyle;
}

type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };

function deepMerge<T>(target: T, source: DeepPartial<T>): T {
  const result = { ...target } as any;
  for (const key of Object.keys(source as any)) {
    const sv = (source as any)[key], tv = (target as any)[key];
    if (sv !== undefined && typeof sv === 'object' && sv !== null && !Array.isArray(sv) &&
        typeof tv === 'object' && tv !== null && !Array.isArray(tv)) {
      result[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      result[key] = sv;
    }
  }
  return result as T;
}

// =============================================================================
// FLAT STYLE SHORTHAND
// =============================================================================

/** Property-name -> path in DiagramStyle for the flat STYLE accessor. */
const FLAT_MAP: Record<string, [keyof DiagramStyle, string]> = {
  fontFamily:         ['typography', 'fontFamily'],
  fontFamilyBold:     ['typography', 'fontFamilyBold'],
  fontSize:           ['typography', 'fontSize'],
  headerFontSize:     ['typography', 'headerFontSize'],
  valueFontSize:      ['typography', 'valueFontSize'],
  edgeFontSize:       ['typography', 'edgeFontSize'],
  nodeWidth:          ['node', 'width'],
  nodeHeight:         ['node', 'height'],
  rectRadius:         ['node', 'radius'],
  nodeRadius:         ['node', 'radius'],
  nodeMargin:         ['node', 'margin'],
  headerHeight:       ['node', 'headerHeight'],
  marginLeft:         ['node', 'marginLeft'],
  marginRight:        ['node', 'marginRight'],
  horizontalGap:      ['layout', 'horizontalGap'],
  verticalGap:        ['layout', 'verticalGap'],
  treeGap:            ['layout', 'treeGap'],
  padding:            ['layout', 'padding'],
  strokeWidth:        ['stroke', 'width'],
  strokeColor:        ['stroke', 'color'],
  selectedStrokeWidth:['stroke', 'selectedWidth'],
  selectedStrokeColor:['stroke', 'selectedColor'],
  edgeColor:          ['edge', 'color'],
  edgeWidth:          ['edge', 'width'],
  rdfTypeEdgeWidth:   ['edge', 'rdfTypeWidth'],
  arrowWidth:         ['edge', 'arrowWidth'],
  arrowHeight:        ['edge', 'arrowHeight'],
  textColor:          ['textColors', 'primary'],
  headerTextColor:    ['textColors', 'header'],
  typeIndicatorColor: ['textColors', 'typeIndicator'],
  edgeLabelColor:     ['textColors', 'edge'],
  hoverOpacity:       ['interaction', 'hoverOpacity'],
  hoverColor:         ['interaction', 'hoverColor'],
  diagramBg:          ['background', 'diagram'],
  labelBg:            ['background', 'labelBg'],
};

/** Flat style accessor - reads from `currentStyle` using the mapping above.
 *  Top-level collection properties (`nodeColors`, `highlightColors`) are passed through directly. */
export const STYLE: Record<string, any> = new Proxy({} as Record<string, any>, {
  get(_target, prop: string) {
    if (prop === 'nodeColors' || prop === 'colors') return currentStyle.nodeColors;
    if (prop === 'highlightColors') return currentStyle.highlightColors;
    const mapping = FLAT_MAP[prop];
    if (mapping) return (currentStyle as any)[mapping[0]][mapping[1]];
    return undefined;
  },
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export function getNodeColors(nodeType: keyof NodeColorsStyle): NodeColorPair {
  return currentStyle.nodeColors[nodeType] || currentStyle.nodeColors.unknown;
}

export function getTypeIndicator(nodeType: string): string {
  switch (nodeType) {
    case 'class': return 'Class';
    case 'instance': return 'URI';
    case 'literal': return 'Literal';
    case 'blank': return 'BNode';
    default: return '';
  }
}

export function createStyle(customizations: DeepPartial<DiagramStyle>): DiagramStyle {
  return deepMerge(structuredClone(DEFAULT_STYLE), customizations);
}

// =============================================================================
// PRESET STYLES
// =============================================================================

export const DARK_STYLE: DiagramStyle = createStyle({
  background: { diagram: '#1e1e1e', labelBg: '#2d2d2d' },
  textColors: { primary: '#e0e0e0', header: '#cccccc', typeIndicator: '#999999', edge: '#aaaaaa' },
  stroke: { width: 2, color: '#666666', selectedWidth: 3, selectedColor: '#64b5f6' },
  edge: { color: '#888888', width: 1.5, rdfTypeWidth: 2, arrowWidth: 6, arrowHeight: 5, labelColor: '#aaaaaa' },
  nodeColors: {
    class: { bg: '#4a4520', header: '#3d3a1a' },
    instance: { bg: '#4a3520', header: '#3d2d1a' },
    literal: { bg: '#4a2525', header: '#3d1f1f' },
    unknown: { bg: '#3a3a3a', header: '#2d2d2d' },
    blank: { bg: '#3d3d38', header: '#32322d' },
  },
  interaction: { hoverOpacity: 0.9, hoverColor: '#64b5f6' },
});

export const HIGH_CONTRAST_STYLE: DiagramStyle = createStyle({
  stroke: { width: 3, color: '#000000', selectedWidth: 4, selectedColor: '#0000ff' },
  edge: { color: '#000000', width: 2, rdfTypeWidth: 3, arrowWidth: 8, arrowHeight: 6, labelColor: '#000000' },
  nodeColors: {
    class: { bg: '#ffff00', header: '#cccc00' },
    instance: { bg: '#ff9900', header: '#cc7a00' },
    literal: { bg: '#ff6666', header: '#cc5252' },
    unknown: { bg: '#cccccc', header: '#999999' },
    blank: { bg: '#ffffff', header: '#dddddd' },
  },
});

export const MINIMAL_STYLE: DiagramStyle = createStyle({
  node: { width: 160, height: 40, radius: 4, margin: 15, headerHeight: 0, marginLeft: 8, marginRight: 8 },
  stroke: { width: 1, color: '#cccccc', selectedWidth: 2, selectedColor: '#666666' },
  nodeColors: {
    class: { bg: '#f5f5f5', header: '#f5f5f5' },
    instance: { bg: '#f5f5f5', header: '#f5f5f5' },
    literal: { bg: '#f5f5f5', header: '#f5f5f5' },
    unknown: { bg: '#f5f5f5', header: '#f5f5f5' },
    blank: { bg: '#f5f5f5', header: '#f5f5f5' },
  },
});
