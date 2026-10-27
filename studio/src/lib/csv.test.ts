import test from 'node:test';
import assert from 'node:assert/strict';
import { CsvDocument } from './csv.ts';

test('CSV conserva righe non toccate, colonne ignote e campi con virgole/newline', () => {
  const source = 'id,address,custom\r\na,"Via Roma, 1",x\r\nb,"prima\nseconda",y\r\n';
  const doc = new CsvDocument(source);
  assert.equal(doc.get(1).address, 'prima\nseconda');
  doc.update(0, { address: 'Via Demo, "4Kasette"' });
  const output = doc.serialize();
  assert.ok(output.includes('a,"Via Demo, ""4Kasette""",x\r\n'));
  assert.ok(output.endsWith('b,"prima\nseconda",y\r\n'));
});

test('CSV malformato produce errore esplicito', () => {
  assert.throws(() => new CsvDocument('id,name\na,"rotto\n'), /non chiuse/);
});

test('CSV storico con colonne finali omesse resta invariato se non toccato', () => {
  const source = 'id,date,notes,phase\nmatch-1,,Omologato\n';
  const doc = new CsvDocument(source);
  assert.equal(doc.get(0).phase, '');
  assert.equal(doc.serialize(), source);
  doc.update(0, { notes: 'Risultato omologato' });
  assert.equal(doc.serialize(), 'id,date,notes,phase\nmatch-1,,Risultato omologato,\n');
});

