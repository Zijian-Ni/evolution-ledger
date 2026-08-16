/**
 * EL-A1: Merkle checkpoints + Ed25519 signatures (node:crypto only, zero deps)
 *
 * Security model:
 *   The agent has WRITE access to the ledger file.
 *   The agent does NOT have access to the Ed25519 private key.
 *   Private key lives at ~/.eledger/key.pem (mode 0600).
 *
 *   "Agent rewrites the whole chain" → forge a valid checkpoint signature
 *   → requires the private key → fails because agent can't read it.
 *
 * This upgrades verify to a fifth state: VERIFIED_SIGNED (gold lamp).
 */

import { createHash, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const KEY_DIR = path.join(homedir(), '.eledger');
const KEY_PATH = path.join(KEY_DIR, 'key.pem');
const PUB_PATH = path.join(KEY_DIR, 'key.pub.pem');

// ─── Merkle tree ──────────────────────────────────────────────────────────

/**
 * Compute Merkle root of an ordered list of hex hashes.
 * Uses SHA-256 to combine pairs: hash(left || right).
 * With an odd number of leaves, the last leaf is duplicated.
 *
 * @param {string[]} hexHashes  – array of 64-char hex strings
 * @returns {string} 64-char hex Merkle root
 */
export function merkleRoot(hexHashes) {
  if (hexHashes.length === 0) {
    return '0'.repeat(64);
  }
  if (hexHashes.length === 1) {
    return hexHashes[0];
  }

  let level = hexHashes.slice();

  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i]; // duplicate last if odd
      const combined = createHash('sha256')
        .update(Buffer.from(left + right, 'utf8'))
        .digest('hex');
      next.push(combined);
    }
    level = next;
  }

  return level[0];
}

// ─── Key management ───────────────────────────────────────────────────────

/**
 * Generate an Ed25519 keypair. Private key is saved to ~/.eledger/key.pem
 * with mode 0600. Public key saved to ~/.eledger/key.pub.pem.
 *
 * @returns {{ privateKeyPem: string, publicKeyPem: string, keyPath: string, pubPath: string }}
 */
export function keygen() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(KEY_PATH, privateKey, { mode: 0o600 });
  chmodSync(KEY_PATH, 0o600);
  writeFileSync(PUB_PATH, publicKey, { mode: 0o644 });

  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    keyPath: KEY_PATH,
    pubPath: PUB_PATH,
  };
}

/**
 * Load private key from ~/.eledger/key.pem.
 * @throws if file does not exist
 */
export function loadPrivateKey() {
  if (!existsSync(KEY_PATH)) {
    throw new Error(
      `Private key not found at ${KEY_PATH}. Run: eledger keygen`
    );
  }
  return readFileSync(KEY_PATH, 'utf8');
}

/**
 * Load public key from ~/.eledger/key.pub.pem.
 * @throws if file does not exist
 */
export function loadPublicKey() {
  if (!existsSync(PUB_PATH)) {
    throw new Error(
      `Public key not found at ${PUB_PATH}. Run: eledger keygen`
    );
  }
  return readFileSync(PUB_PATH, 'utf8');
}

// ─── Checkpoint creation ─────────────────────────────────────────────────

/**
 * Create a signed checkpoint over `entries`.
 *
 * Payload:
 *   { n: number_of_entries, merkle: hex, ts: iso }
 * Signature: Ed25519 over the canonical JSON of payload.
 *
 * @param {object[]} entries      – array of ledger entry objects
 * @param {string}   privPem      – Ed25519 private key PEM
 * @returns {{ type:'checkpoint', payload: object, sig: string }}
 */
export function makeCheckpoint(entries, privPem) {
  const hashes = entries.map(e => e.hash);
  const root = merkleRoot(hashes);
  const payload = {
    n: entries.length,
    merkle: root,
    ts: new Date().toISOString(),
    tipHash: entries.length > 0 ? entries[entries.length - 1].hash : null,
  };

  const canonical = JSON.stringify(payload, Object.keys(payload).sort());

  // Ed25519: use the low-level sign() — no digest arg, handles its own hash internally
  const sigBuf = cryptoSign(null, Buffer.from(canonical, 'utf8'), privPem);
  const sig = sigBuf.toString('hex');

  return {
    type: 'checkpoint',
    payload,
    sig,
  };
}

/**
 * Verify a checkpoint signature.
 *
 * @param {{ payload: object, sig: string }} cp  – checkpoint object
 * @param {string} pubPem                        – Ed25519 public key PEM
 * @returns {{ ok: boolean, error?: string }}
 */
export function verifyCheckpoint(cp, pubPem) {
  try {
    const canonical = JSON.stringify(cp.payload, Object.keys(cp.payload).sort());
    const ok = cryptoVerify(
      null,
      Buffer.from(canonical, 'utf8'),
      pubPem,
      Buffer.from(cp.sig, 'hex')
    );
    return { ok };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Verify the Merkle root in a checkpoint against a list of entries.
 * This is independent of the signature — it checks data integrity.
 *
 * @param {{ payload: object }} cp
 * @param {object[]} entries
 * @returns {{ ok: boolean, error?: string }}
 */
export function verifyCheckpointMerkle(cp, entries) {
  if (cp.payload.n !== entries.length) {
    return {
      ok: false,
      error: `Entry count mismatch: checkpoint has ${cp.payload.n}, got ${entries.length}`,
    };
  }
  const hashes = entries.map(e => e.hash);
  const root = merkleRoot(hashes);
  if (root !== cp.payload.merkle) {
    return {
      ok: false,
      error: `Merkle root mismatch: expected ${cp.payload.merkle}, got ${root}`,
    };
  }
  return { ok: true };
}

// ─── VERIFIED_SIGNED verdict ─────────────────────────────────────────────

export const VERDICT_SIGNED = 'VERIFIED_SIGNED';

/**
 * Verify all checkpoint entries in a ledger against a public key.
 * Returns { ok: boolean, verdict: 'VERIFIED_SIGNED'|'CHAIN_BROKEN', details }
 *
 * @param {import('./core.js').Ledger} ledger
 * @param {string} pubPem
 */
export function verifyAllCheckpoints(ledger, pubPem) {
  const checkpoints = ledger.entries.filter(e => e.type === 'checkpoint' && e.checkpoint);
  if (checkpoints.length === 0) {
    return { ok: false, verdict: 'NO_CHECKPOINTS', details: [] };
  }

  const details = [];
  for (const cpEntry of checkpoints) {
    const cp = cpEntry.checkpoint;
    // Get the entries covered by this checkpoint (first n entries)
    const coveredEntries = ledger.entries
      .filter(e => e.type !== 'checkpoint')
      .slice(0, cp.payload.n);

    const merkleCheck = verifyCheckpointMerkle(cp, coveredEntries);
    const sigCheck = verifyCheckpoint(cp, pubPem);

    details.push({
      id: cpEntry.id,
      hash: cpEntry.hash,
      n: cp.payload.n,
      merkle: merkleCheck,
      sig: sigCheck,
    });

    if (!merkleCheck.ok || !sigCheck.ok) {
      return {
        ok: false,
        verdict: 'CHAIN_BROKEN',
        details,
      };
    }
  }

  return {
    ok: true,
    verdict: VERDICT_SIGNED,
    details,
  };
}

// ─── Checkpoint interval ─────────────────────────────────────────────────

export const DEFAULT_CHECKPOINT_INTERVAL = 10;
