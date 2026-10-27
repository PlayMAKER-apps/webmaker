export type CsvRow = { values: string[]; raw: string; ending: string; dirty: boolean };

function parseFields(record: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  for (let i = 0; i < record.length; i++) {
    const char = record[i];
    if (quoted) {
      if (char === '"' && record[i + 1] === '"') { value += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else value += char;
    } else if (char === ',' || char === '\n' || char === '\r') {
      if (char === ',' ) { values.push(value); value = ''; closed = false; }
    } else if (char === '"') {
      if (value || closed) throw new Error('CSV non valido: virgolette fuori posizione.');
      quoted = true;
    } else {
      if (closed) throw new Error('CSV non valido: testo dopo le virgolette.');
      value += char;
    }
  }
  if (quoted) throw new Error('CSV non valido: virgolette non chiuse.');
  values.push(value);
  return values;
}

function records(source: string): CsvRow[] {
  const result: CsvRow[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (inQuotes && source[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      const ending = char === '\r' && source[i + 1] === '\n' ? '\r\n' : char;
      if (ending === '\r\n') i++;
      const raw = source.slice(start, i + 1);
      if (raw !== ending) result.push({ values: parseFields(raw.slice(0, -ending.length)), raw, ending, dirty: false });
      start = i + 1;
    }
  }
  if (inQuotes) throw new Error('CSV non valido: virgolette non chiuse.');
  if (start < source.length) {
    const raw = source.slice(start);
    result.push({ values: parseFields(raw), raw, ending: '', dirty: false });
  }
  return result;
}

function encode(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export class CsvDocument {
  readonly header: CsvRow;
  readonly rows: CsvRow[];
  readonly newline: string;

  constructor(source: string) {
    const parsed = records(source);
    if (!parsed.length) throw new Error('CSV vuoto: intestazioni mancanti.');
    this.header = parsed[0];
    this.rows = parsed.slice(1);
    this.newline = this.header.ending || '\n';
    if (new Set(this.header.values).size !== this.header.values.length) throw new Error('CSV con colonne duplicate.');
    for (const row of this.rows) {
      if (row.values.length > this.header.values.length) throw new Error('CSV con più campi delle colonne dichiarate.');
      while (row.values.length < this.header.values.length) row.values.push('');
    }
  }

  get columns(): string[] { return this.header.values; }
  get(index: number): Record<string, string> {
    const row = this.rows[index];
    if (!row) throw new Error('Riga inesistente.');
    return Object.fromEntries(this.columns.map((column, position) => [column, row.values[position]]));
  }
  update(index: number, patch: Record<string, string>) {
    const row = this.rows[index];
    if (!row) throw new Error('Riga inesistente.');
    for (const [column, value] of Object.entries(patch)) {
      const position = this.columns.indexOf(column);
      if (position < 0) throw new Error(`Colonna sconosciuta: ${column}`);
      row.values[position] = value;
    }
    row.dirty = true;
  }
  append(values: Record<string, string>) {
    const unknown = Object.keys(values).filter((column) => !this.columns.includes(column));
    if (unknown.length) throw new Error(`Colonne sconosciute: ${unknown.join(', ')}`);
    this.rows.push({ values: this.columns.map((column) => values[column] ?? ''), raw: '', ending: this.newline, dirty: true });
  }
  serialize(): string {
    let output = this.header.raw;
    for (const row of this.rows) {
      if (output && !/\r?\n$/.test(output)) output += this.newline;
      output += row.dirty ? row.values.map(encode).join(',') + row.ending : row.raw;
    }
    return output;
  }
}
