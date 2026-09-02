// Dynamic BOQ table ingestion: discovers a BOQ table from document structure, not a
// fixed template. Split by concern — header matching, row/column profiling, item
// extraction — with per-format detectors (currently just XLSX) behind this barrel.
export { WorkbookParseError, inspectWorkbook, analyzeLoadedWorkbook } from './xlsx';
