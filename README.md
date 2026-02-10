# Schema Diagram Component (TypeScript)

This folder contains a scaffold for a reusable web component that will render RDF schema diagrams and help compose SPARQL JSON-LD payloads.

Overview
- Component: `schema-diagram` (custom element)
- Inputs: CSV coverage text or JSON-LD objects
- Outputs: canonical graph model, SPARQL JSON-LD (`sh:SPARQLExecutable`) payloads

Quick start (dev)

1. cd into project folder

```bash
cd proof-of-concept-js/schema-diagram-ts
npm install
npm run build
# open demo/index.html in your browser (or use a static server)
```

Files created
- `src/components/schema-diagram.ts` — starter web component exposing the public API described in the design.
- `src/parsers/jsonldParser.ts` — initial JSON-LD -> canonical graph parser.
- `src/parsers/csvParser.ts` — initial CSV parser + coverage->graph converter.
- `src/types.ts` — canonical TypeScript interfaces.
- `demo/index.html` — quick demo page.

Next steps
- Implement full D3 orthogonal renderer (left-to-right) in `src/renderer/*` and wire into the component.
- Implement DiagramState (from old code) as a TS class for path highlighting.
- Implement IRI manager UI and SPARQL composer.
- Add tests and CI linting.

