/**
 * CSV Parser
 * 
 * Converts coverage CSV format into canonical schema.
 */

import type { CanonicalSchema, CanonicalTriple, PrefixMap } from '../types';
import { createEmptySchema, addTriple, getLocalName, isRdfTypePredicate } from '../data/schema-model';

/** A row from coverage CSV */
export interface CoverageRow {
  subject_uri?: string;
  subject_class?: string;
  property_uri?: string;
  property?: string;
  object_uri?: string;
  object_class?: string;
  count?: string | number;
  source_dataset?: string;
}

/**
 * Parse CSV text into array of row objects.
 */
export function parseCSV(csvText: string): CoverageRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  
  const headers = parseCSVLine(lines[0]);
  const rows: CoverageRow[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row: CoverageRow = {};
    
    headers.forEach((header, idx) => {
      const key = header.trim().toLowerCase().replace(/\s+/g, '_') as keyof CoverageRow;
      row[key] = values[idx]?.trim() || undefined;
    });
    
    rows.push(row);
  }
  
  return rows;
}

/**
 * Parse a single CSV line, handling quoted values.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current);
  return result;
}

/**
 * Convert coverage rows to canonical schema.
 */
export function coverageToSchema(rows: CoverageRow[], prefixes: PrefixMap = {}): CanonicalSchema {
  const schema = createEmptySchema();
  schema.prefixes = prefixes;
  
  for (const row of rows) {
    const subjectUri = row.subject_uri || row.subject_class;
    const objectUri = row.object_uri || row.object_class;
    const predicateUri = row.property_uri || row.property;
    
    if (!subjectUri || !objectUri || !predicateUri) continue;
    
    const isRdfType = isRdfTypePredicate(predicateUri);
    
    const triple: CanonicalTriple = {
      subject: subjectUri,
      predicate: predicateUri,
      object: objectUri,
      subjectLabel: row.subject_class || getLocalName(subjectUri),
      predicateLabel: row.property || getLocalName(predicateUri),
      objectLabel: row.object_class || getLocalName(objectUri),
      objectType: objectUri.startsWith('_:') ? 'blank' : 'uri',
      isRdfType,
    };
    
    addTriple(schema, triple);
  }
  
  return schema;
}
