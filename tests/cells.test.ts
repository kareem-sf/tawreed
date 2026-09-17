import { describe, expect, it } from 'vitest';
import { cellNumber, isNumericLike } from '../engine/ingest/cells';

describe('cellNumber', () => {
  it('parses plain and formatted numbers', () => {
    expect(cellNumber(12)).toBe(12);
    expect(cellNumber('4,200')).toBe(4200);
    expect(cellNumber('(500)')).toBe(-500);
  });

  it('parses quantities with inline units', () => {
    expect(cellNumber('12 m3')).toBe(12);
    expect(cellNumber('250 TR')).toBe(250);
    expect(cellNumber('(500) m3')).toBe(-500);
  });

  it('never turns text-first specs into numbers', () => {
    expect(cellNumber('Concrete C30')).toBeNull();
    expect(cellNumber('Cable 4x25')).toBeNull();
    expect(cellNumber('4x25')).toBeNull();
    expect(cellNumber('250TR')).toBeNull();
    expect(cellNumber('m3')).toBeNull();
    expect(cellNumber('#REF!')).toBeNull();
    expect(cellNumber('')).toBeNull();
  });
});

describe('isNumericLike', () => {
  it('classifies bare numbers as numeric', () => {
    expect(isNumericLike(12)).toBe(true);
    expect(isNumericLike('4,200')).toBe(true);
  });

  it('keeps its text-first gate for shape detection', () => {
    // Profiling counts unit-suffixed quantities via cellNumber; the shape gate stays strict.
    expect(isNumericLike('Concrete C30')).toBe(false);
    expect(isNumericLike('abc')).toBe(false);
  });
});
