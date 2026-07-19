import { describe, it, expect } from 'vitest';
import { normalizeDigits, parseNumber, canonicalUnit, normalizeText } from '../engine/normalize';

describe('normalizeDigits', () => {
  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizeDigits('١٢٣٤٥')).toBe('12345');
  });
  it('converts Extended Arabic-Indic (Persian) digits', () => {
    expect(normalizeDigits('۱۲۳')).toBe('123');
  });
  it('leaves ASCII untouched', () => {
    expect(normalizeDigits('m2 500')).toBe('m2 500');
  });
});

describe('parseNumber', () => {
  it('parses plain numbers', () => expect(parseNumber('1250.5')).toBe(1250.5));
  it('handles thousands separators', () => expect(parseNumber('1,250,000')).toBe(1250000));
  it('handles Arabic digits + Arabic decimal separator', () => expect(parseNumber('١٢٥٠٫٥')).toBe(1250.5));
  it('handles accounting parentheses as negative', () => expect(parseNumber('(500)')).toBe(-500));
  it('strips currency symbols', () => expect(parseNumber('EGP 4,200')).toBe(4200));
  it('returns null for garbage', () => expect(parseNumber('abc')).toBeNull());
  it('returns null for null/undefined', () => {
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
  });
});

describe('canonicalUnit', () => {
  it('maps western variants', () => {
    expect(canonicalUnit('M2')).toBe('m2');
    expect(canonicalUnit('sqm')).toBe('m2');
    expect(canonicalUnit('CUM')).toBe('m3');
    expect(canonicalUnit('Nos')).toBe('nr');
    expect(canonicalUnit('L.S')).toBe('ls');
  });
  it('maps Arabic variants', () => {
    expect(canonicalUnit('متر مربع')).toBe('m2');
    expect(canonicalUnit('م3')).toBe('m3');
    expect(canonicalUnit('طن')).toBe('ton');
    expect(canonicalUnit('مقطوعية')).toBe('ls');
    expect(canonicalUnit('عدد')).toBe('nr');
    expect(canonicalUnit('كجم')).toBe('kg');
  });
  it('strips diacritics before matching', () => {
    expect(canonicalUnit('مَتْر')).toBe('m');
  });
  it('falls back to other', () => expect(canonicalUnit('furlong')).toBe('other'));
});

describe('normalizeText', () => {
  it('normalizes Arabic letter variants for matching', () => {
    expect(normalizeText('خرسانة')).toBe('خرسانه');
    expect(normalizeText('إضاءة')).toBe('اضاءه');
  });
  it('collapses whitespace and lowercases', () => {
    expect(normalizeText('  Reinforced   Concrete  ')).toBe('reinforced concrete');
  });
});
