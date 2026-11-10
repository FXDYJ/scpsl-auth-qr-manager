import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { evaluatePolicy, parseEvidence, rawSignature, TrustStore } from '../public/assets/verify.js';

const now = Date.parse('2026-01-01T00:10:00Z');
const payload = {
  UserId: 'synthetic@steam',
  Challenge: 'synthetic-challenge',
  PlayerId: 2,
  TokenVersion: 2,
  Usage: 'Authentication',
  TestSignature: false,
  IssuanceTime: '2026-01-01T00:00:00.0000000+00:00',
  ExpirationTime: '2026-01-01T00:15:00.0000000+00:00',
};

test('authenticity uses the original Base64 text and fails on a modified field', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp521r1' });
  const verificationKey = await crypto.subtle.importKey('spki', publicKey.export({ type: 'spki', format: 'der' }),
    { name: 'ECDSA', namedCurve: 'P-521' }, false, ['verify']);
  const token = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = sign('sha256', Buffer.from(token), privateKey).toString('base64');
  const trust = new TrustStore();
  trust.keys.set('synthetic', { key: verificationKey });
  const original = parseEvidence(JSON.stringify({ token, signature }));
  assert.equal((await trust.inspect(original)).signatureStatus, 'verified');
  assert.equal((await trust.inspect({
    envelope: { token: Buffer.from(JSON.stringify({ ...payload, PlayerId: 3 })).toString('base64'), signature },
  })).signatureStatus, 'mismatch');
  assert.equal((await trust.inspect({ envelope: { token, signature: 'AA==' } })).signatureStatus, 'malformed');
  assert.equal(rawSignature(signature).length, 132);
  assert.throws(() => rawSignature(Buffer.concat([Buffer.from(signature, 'base64'), Buffer.from([0])]).toString('base64')));
});

test('checks the expiry boundary, offset equivalence, future issuance and malformed dates', () => {
  assert.equal(evaluatePolicy(payload, now).status, 'current');
  assert.equal(evaluatePolicy(payload, Date.parse('2026-01-01T00:15:00Z')).status, 'current');
  assert.equal(evaluatePolicy(payload, Date.parse('2026-01-01T08:15:00.001+08:00')).status, 'expired');
  assert.equal(evaluatePolicy(payload, Date.parse('2025-12-31T23:39:59Z')).status, 'future');
  assert.equal(evaluatePolicy({ ...payload, IssuanceTime: '2026-02-30T00:00:00Z' }, now).status, 'invalid');
  assert.equal(evaluatePolicy({ ...payload, TestSignature: true }, now).status, 'test');
  assert.equal(evaluatePolicy({ ...payload, Usage: 'Badge request' }, now).status, 'usage');
  assert.equal(evaluatePolicy({ ...payload, TokenVersion: 3 }, now).status, 'version');
});

test('offline snapshot is verified against the pinned Northwood root', async (context) => {
  let tampered = false;
  context.mock.method(globalThis, 'fetch', async (path) => {
    assert.match(path, /^\/assets\/trust\//);
    const body = await readFile(new URL('../public' + path, import.meta.url));
    if (tampered && path.endsWith('.json')) {
      const snapshot = JSON.parse(body);
      snapshot.key = snapshot.key.replaceAll('\r\n', '\n');
      return Response.json(snapshot);
    }
    return new Response(body);
  });
  const trust = new TrustStore();
  await trust.initialize();
  assert.equal(trust.keys.size, 1);
  tampered = true;
  const invalid = new TrustStore();
  await invalid.initialize();
  assert.equal(invalid.keys.size, 0);
});
