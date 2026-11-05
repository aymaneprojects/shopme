import { describe, expect, it } from 'vitest';
import { toCsv } from './download';

describe('toCsv', () => {
  it('quotes cells with commas, quotes and line breaks and leaves others bare', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', 'x\ny'], [1, null, undefined, 0]])).toBe('a,"b,c","say ""hi""","x\ny"\r\n1,,,0\r\n');
  });
});
