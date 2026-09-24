import Decimal from 'decimal.js';
import { fromMajorUnits } from '../common/money';

/**
 * Reading a bank's CSV export.
 *
 * Every bank lays its export out differently, so columns are found by their
 * header, not their position: a date, a description, optionally a reference,
 * and either one signed amount column or a pair of debit/credit (or
 * withdrawal/deposit) columns. Anything the parser cannot read with certainty
 * is refused with the line number — a statement imported half-right is worse
 * than one not imported, because the reconciliation built on it would lie.
 */

export interface ParsedLine {
  lineNumber: number;
  valueDate: Date;
  description: string;
  reference: string | null;
  /** Signed kobo: money in positive, money out negative. */
  amountKobo: bigint;
}

export class StatementParseError extends Error {}

const DATE_HEADERS = ['value date', 'transaction date', 'trans date', 'date', 'posting date', 'txn date'];
const DESCRIPTION_HEADERS = ['description', 'narration', 'details', 'remarks', 'transaction details', 'particulars'];
const REFERENCE_HEADERS = ['reference', 'ref', 'ref no', 'reference number', 'cheque no', 'cheque number', 'transaction id'];
const AMOUNT_HEADERS = ['amount', 'signed amount', 'net amount'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawals', 'money out', 'dr', 'debit amount'];
const CREDIT_HEADERS = ['credit', 'deposit', 'deposits', 'lodgement', 'lodgment', 'money in', 'cr', 'credit amount'];

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

export function parseStatementCsv(text: string): ParsedLine[] {
  const rows = splitCsv(text).filter((row) => row.some((cell) => cell.trim() !== ''));
  if (rows.length < 2) {
    throw new StatementParseError('The file has no transactions — it needs a header row and at least one line.');
  }

  const header = rows[0]!.map((cell) => cell.trim().toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' '));
  const find = (names: string[]) => {
    for (const name of names) {
      const index = header.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };

  const dateCol = find(DATE_HEADERS);
  const descCol = find(DESCRIPTION_HEADERS);
  const refCol = find(REFERENCE_HEADERS);
  const amountCol = find(AMOUNT_HEADERS);
  const debitCol = find(DEBIT_HEADERS);
  const creditCol = find(CREDIT_HEADERS);

  if (dateCol < 0) throw new StatementParseError('No date column found (expected a header like "Date" or "Value Date").');
  if (descCol < 0) throw new StatementParseError('No description column found (expected "Description", "Narration" or "Details").');
  if (amountCol < 0 && (debitCol < 0 || creditCol < 0)) {
    throw new StatementParseError('No amounts found — expected an "Amount" column, or both "Debit" and "Credit" columns.');
  }

  return rows.slice(1).map((row, index) => {
    const lineNumber = index + 1;
    const at = `Line ${lineNumber + 1} of the file`;
    const valueDate = parseDate(row[dateCol] ?? '');
    if (!valueDate) throw new StatementParseError(`${at}: cannot read the date "${row[dateCol] ?? ''}".`);

    let amountKobo: bigint;
    if (amountCol >= 0) {
      const amount = parseMoney(row[amountCol] ?? '');
      if (amount === null) throw new StatementParseError(`${at}: cannot read the amount "${row[amountCol] ?? ''}".`);
      amountKobo = amount;
    } else {
      const debit = parseMoney(row[debitCol] ?? '') ?? 0n;
      const credit = parseMoney(row[creditCol] ?? '') ?? 0n;
      if (debit !== 0n && credit !== 0n) {
        throw new StatementParseError(`${at}: has both a debit and a credit — one line is one movement.`);
      }
      // Banks show both as positive numbers; a debit is money leaving.
      amountKobo = credit !== 0n ? abs(credit) : -abs(debit);
    }
    if (amountKobo === 0n) throw new StatementParseError(`${at}: has no amount.`);

    const description = (row[descCol] ?? '').trim();
    const reference = refCol >= 0 ? (row[refCol] ?? '').trim() || null : null;
    return { lineNumber, valueDate, description: description || '(no description)', reference, amountKobo };
  });
}

/** 2026-03-14, 14/03/2026, 14-03-2026, 14-Mar-2026, 14 Mar 2026. Day before month, as Nigerian banks print. */
export function parseDate(input: string): Date | null {
  const text = input.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) return utc(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (match) return utc(year(match[3]!), Number(match[2]) - 1, Number(match[1]));
  match = /^(\d{1,2})[\s/-]([A-Za-z]{3,4})[a-z]*[\s/-](\d{2,4})$/.exec(text);
  if (match) {
    const month = MONTHS[match[2]!.toLowerCase().slice(0, match[2]!.toLowerCase() === 'sept' ? 4 : 3)];
    if (month === undefined) return null;
    return utc(year(match[3]!), month, Number(match[1]));
  }
  return null;
}

/** "1,250.50", "(1,250.50)", "-1250.5", "₦1,250", "1,250.50 DR". Null when blank or unreadable. */
export function parseMoney(input: string): bigint | null {
  let text = input.trim();
  if (text === '' || text === '-') return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/\bDR$/i.test(text)) {
    negative = true;
    text = text.replace(/\bDR$/i, '');
  } else if (/\bCR$/i.test(text)) {
    text = text.replace(/\bCR$/i, '');
  }
  text = text.replace(/[₦N,\s]/g, '');
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = fromMajorUnits(new Decimal(text)) as bigint;
  return negative ? -value : value;
}

function utc(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m && date.getUTCDate() === d ? date : null;
}

function year(text: string): number {
  const n = Number(text);
  return text.length === 2 ? 2000 + n : n;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
