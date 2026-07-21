import { describe, expect, it, vi } from 'vitest';

// Isolated suite: stub the spreadsheet engine so it reports an encrypted file, and verify the
// tolerant reader turns that into a clear, actionable "password-protected" error.
vi.mock('@e965/xlsx', () => ({
  read: vi.fn(() => {
    throw new Error('Unsupported Encryption Method');
  }),
  utils: { sheet_to_json: vi.fn(() => []) },
}));

import { EncryptedWorkbookError, readSpreadsheetToWorkbook } from '../engine/spreadsheet-reader';

describe('encrypted workbook handling', () => {
  it('translates an encryption failure into a clear password-protected error', () => {
    expect(() => readSpreadsheetToWorkbook(new Uint8Array([1, 2, 3]))).toThrow(EncryptedWorkbookError);
    expect(() => readSpreadsheetToWorkbook(new Uint8Array([1, 2, 3]))).toThrow(/password-protected/i);
  });
});
