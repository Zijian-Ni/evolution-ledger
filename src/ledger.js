/**
 * Node entry: re-export isomorphic core + add file persistence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Ledger as CoreLedger, parseJSONL } from './core.js';

export * from './core.js';

export class Ledger extends CoreLedger {
  constructor(filePath) {
    super(filePath);
    if (filePath && fs.existsSync(filePath)) this._load();
  }

  _load() {
    const text = fs.readFileSync(this.filePath, 'utf8');
    try {
      this.entries = parseJSONL(text);
    } catch (err) {
      // Name the file — a bare "line 3 is invalid" is useless when a CLI
      // touches several ledgers.
      throw new Error(`${this.filePath}: ${err.message}`);
    }
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
    L.entries = parseJSONL(text);
    return L;
  }
}
