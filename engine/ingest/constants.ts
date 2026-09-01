// Shared scan limits for BOQ table discovery — kept in one place since several
// modules (header detection, row/column profiling, extraction) need to agree on them.
export const MAX_HEADER_SCAN = 100;
export const MAX_HEADER_SPAN = 3;
export const MAX_INFER_COLUMNS = 80;
export const MAX_DATA_ROW = 10_000;
