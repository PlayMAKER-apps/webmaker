import test from 'node:test';
import assert from 'node:assert/strict';
import { CsvDocument } from './csv.ts';

test('CSV preserves untouched rows, unknown columns, and fields with commas/newlines', () => {
  const source = 'id,address,custom\r\na,"Demo Street, 1",x\r\nb,"first\nsecond",y\r\n';
  const doc = new CsvDocument(source);
  assert.equal(doc.get(1).address, 'first\nsecond');
  doc.update(0, { address: 'Demo Street, "4 Courts"' });
  const output = doc.serialize();
  assert.ok(output.includes('a,"Demo Street, ""4 Courts""",x\r\n'));
  assert.ok(output.endsWith('b,"first\nsecond",y\r\n'));
});

test('malformed CSV produces a clear error', () => {
  assert.throws(() => new CsvDocument('id,name\na,"broken\n'), /unclosed quote/);
});

test('historical CSV with missing trailing columns stays unchanged when untouched', () => {
  const source = 'id,date,notes,phase\nmatch-1,,Approved\n';
  const doc = new CsvDocument(source);
  assert.equal(doc.get(0).phase, '');
  assert.equal(doc.serialize(), source);
  doc.update(0, { notes: 'Result approved' });
  assert.equal(doc.serialize(), 'id,date,notes,phase\nmatch-1,,Result approved,\n');
});

