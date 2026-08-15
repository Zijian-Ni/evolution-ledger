/**
 * Node entry: re-export isomorphic core + add file persistence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Ledger as CoreLedger } from './core.js';

export * from './core.js';

export class Ledger extends CoreLedger {
  constructor(filePath) {
    super(filePath);
    if (filePath && fs.existsSync(filePath)) this._load();
  }

  _load() {
    const text = fs.readFileSync(this.filePath, 'utf8');
    this.entries = text.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  }

  save() {
    if (!this.filePath) throw new Error('No filePath');
    fs.mkdirSync(path.dirname(path.resolve(this.filePath)), { recursive: true });
    fs.writeFileSync(this.filePath, this.toJSONL());
  }

  static fromFile(fp) {
    return new Ledger(fp);
  }

  static fromJSONL(text) {
    const L = new Ledger(null);
    L.entries = text.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
    return L;
  }
}
