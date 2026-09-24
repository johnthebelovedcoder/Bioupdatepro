import { describe, expect, it } from 'vitest';
import { parseDate, parseMoney, parseStatementCsv, StatementParseError } from '../../src/banking/statement-csv';

describe('parseMoney', () => {
  it('reads naira as exact kobo', () => {
    expect(parseMoney('1,250.50')).toBe(125_050n);
    expect(parseMoney('₦1,250')).toBe(125_000n);
    expect(parseMoney('0.07')).toBe(7n);
  });

  it('reads the ways banks write money going out', () => {
    expect(parseMoney('-1250.5')).toBe(-125_050n);
    expect(parseMoney('(1,250.50)')).toBe(-125_050n);
    expect(parseMoney('1,250.50 DR')).toBe(-125_050n);
    expect(parseMoney('1,250.50 CR')).toBe(125_050n);
  });

  it('refuses what it cannot read exactly', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-')).toBeNull();
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('twelve')).toBeNull();
  });
});

describe('parseDate', () => {
  it('reads ISO and day-first dates, as Nigerian banks print them', () => {
    expect(parseDate('2026-03-14')?.toISOString().slice(0, 10)).toBe('2026-03-14');
    expect(parseDate('14/03/2026')?.toISOString().slice(0, 10)).toBe('2026-03-14');
    expect(parseDate('14-03-26')?.toISOString().slice(0, 10)).toBe('2026-03-14');
    expect(parseDate('14-Mar-2026')?.toISOString().slice(0, 10)).toBe('2026-03-14');
    expect(parseDate('14 March 2026')?.toISOString().slice(0, 10)).toBe('2026-03-14');
    expect(parseDate('5 Sept 2026')?.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('refuses impossible dates rather than rolling them over', () => {
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
  });
});

describe('parseStatementCsv', () => {
  it('reads a debit/credit layout, finding columns by header', () => {
    const csv = [
      'Trans Date,Value Date,Narration,Reference,Debit,Credit,Balance',
      '02/03/2026,02/03/2026,"Feed from Olam, Ibadan",CHQ001,"150,000.00",,850000.00',
      '05/03/2026,05/03/2026,Egg sales,,,"42,500.00",892500.00',
    ].join('\n');

    const lines = parseStatementCsv(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      description: 'Feed from Olam, Ibadan',
      reference: 'CHQ001',
      amountKobo: -15_000_000n,
    });
    expect(lines[1]).toMatchObject({ description: 'Egg sales', reference: null, amountKobo: 4_250_000n });
  });

  it('reads a single signed amount column', () => {
    const lines = parseStatementCsv('Date,Description,Amount\r\n2026-03-02,Bank charge,-52.50\r\n');
    expect(lines[0]?.amountKobo).toBe(-5_250n);
  });

  it('names the line it cannot read', () => {
    expect(() => parseStatementCsv('Date,Description,Amount\n2026-03-02,Fine,10\nnot a date,Bad,10')).toThrow(
      /Line 3 of the file: cannot read the date/,
    );
    expect(() => parseStatementCsv('Date,Description,Amount\n2026-03-02,Nothing,0')).toThrow(/no amount/);
  });

  it('refuses a file with no recognisable columns', () => {
    expect(() => parseStatementCsv('When,What\n2026-03-02,x')).toThrow(StatementParseError);
    expect(() => parseStatementCsv('Date,Description,Debit\n2026-03-02,x,10')).toThrow(/No amounts found/);
  });
});
