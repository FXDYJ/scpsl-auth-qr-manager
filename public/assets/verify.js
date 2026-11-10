const textDecoder = new TextDecoder('utf-8', { fatal: true });
const utf8 = new TextEncoder();
const keyStoreName = 'scp-sl-auth-qr.trusted-keys.v1';
const curve = { name: 'ECDSA', namedCurve: 'P-521' };
const scheme = { name: 'ECDSA', hash: 'SHA-256' };
const halfSignature = 66;

export function base64Bytes(value, limit) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('无效的 Base64。');
  const raw = atob(value);
  if (!raw.length || raw.length > limit || btoa(raw) !== value) throw new Error('无效的 Base64。');
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function decodeLabel(value) {
  try {
    return textDecoder.decode(base64Bytes(value, 12000));
  } catch {
    return null;
  }
}

export function parseEvidence(raw) {
  if (typeof raw !== 'string' || raw.length > 20000) throw new Error('输入超过 20 KB。');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('请粘贴扫码得到的完整 JSON。');
  }
  if (!data || typeof data.token !== 'string' || typeof data.signature !== 'string') {
    throw new Error('大二维码应包含 token 和 signature。');
  }
  const envelope = { token: data.token, signature: data.signature };
  const decoded = decodeLabel(envelope.token);
  let payload;
  try {
    payload = JSON.parse(decoded);
  } catch {
    throw new Error('token 解码后不是有效的 JSON。');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('token 缺少认证字段。');
  return { envelope, payload, decoded };
}

// Northwood uses ASN.1 DER. Web Crypto expects fixed-width r || s for P-521.
export function rawSignature(encoded) {
  const der = base64Bytes(encoded, 141);
  const result = new Uint8Array(halfSignature * 2);
  let cursor = 0;
  const take = () => {
    if (cursor >= der.length) throw new Error('截断的 ECDSA 签名。');
    return der[cursor++];
  };
  const length = () => {
    const size = take();
    if (size < 128) return size;
    if (size === 0x81) {
      const longSize = take();
      if (longSize >= 128) return longSize;
    }
    throw new Error('无效的 DER 长度。');
  };
  if (take() !== 0x30) throw new Error('无效的 ECDSA 签名。');
  const sequenceSize = length();
  if (cursor + sequenceSize !== der.length) throw new Error('无效的 ECDSA 签名长度。');
  for (let part = 0; part < 2; part++) {
    if (take() !== 2) throw new Error('无效的 DER 整数。');
    const size = length();
    const end = cursor + size;
    if (size === 0 || end > der.length || (der[cursor] & 0x80)
        || (size > 1 && der[cursor] === 0 && !(der[cursor + 1] & 0x80))) {
      throw new Error('无效的 DER 整数。');
    }
    if (size > 1 && der[cursor] === 0) cursor++;
    if (end - cursor > halfSignature) throw new Error('无效的 P-521 签名。');
    result.set(der.subarray(cursor, end), (part + 1) * halfSignature - (end - cursor));
    cursor = end;
  }
  if (cursor !== der.length) throw new Error('ECDSA 签名含有多余数据。');
  return result;
}

function pemBytes(pem) {
  if (typeof pem !== 'string' || pem.length > 2048) throw new Error('无效的公钥。');
  const match = /^-----BEGIN PUBLIC KEY-----([A-Za-z0-9+/=\r\n]+)-----END PUBLIC KEY-----\s*$/.exec(pem);
  if (!match) throw new Error('无效的公钥。');
  return base64Bytes(match[1].replace(/[\r\n]/g, ''), 512);
}

function importKey(bytes) {
  return crypto.subtle.importKey('spki', bytes, curve, false, ['verify']);
}

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(keyStoreName) || '{}') || {}; }
  catch { return {}; }
}

async function trustDocuments(root, documents) {
  const keys = new Map();
  for (const document of Array.isArray(documents) ? documents.slice(0, 14) : []) {
    try {
      const bytes = pemBytes(document.key);
      const valid = await crypto.subtle.verify(scheme, root, rawSignature(document.signature), utf8.encode(document.key));
      if (valid) keys.set(await digest(bytes), { key: await importKey(bytes), document });
    } catch {
      // A corrupt or untrusted document must never enter the verification keyring.
    }
  }
  return keys;
}

export class TrustStore {
  keys = new Map();
  lastRefresh = null;
  inFlight = null;

  async initialize() {
    if (!globalThis.crypto?.subtle) throw new Error('本地验签需要 HTTPS 或 localhost。');
    const [pem, snapshot] = await Promise.all([
      fetch('/assets/trust/root.pem').then((response) => response.text()),
      fetch('/assets/trust/northwood-14.json').then((response) => response.json()),
    ]);
    this.root = await importKey(pemBytes(pem));
    const cached = readCache();
    const documents = Array.isArray(cached.documents) ? cached.documents.slice(0, 12) : [];
    this.keys = await trustDocuments(this.root, [snapshot, ...documents]);
    this.lastRefresh = typeof cached.lastRefresh === 'string' ? cached.lastRefresh : null;
  }

  refresh() {
    if (!this.root || !navigator.onLine) return Promise.resolve(false);
    this.inFlight ??= this.sync().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async sync() {
    try {
      const response = await fetch('/api/keys.php', { cache: 'no-store', signal: AbortSignal.timeout(7500) });
      if (!response.ok) return false;
      const data = await response.json();
      const keys = await trustDocuments(this.root, data.documents);
      if (!keys.size) return false;
      this.keys = new Map([...keys, ...[...this.keys].filter(([id]) => !keys.has(id))].slice(0, 14));
      this.lastRefresh = typeof data.lastRefresh === 'string' ? data.lastRefresh : this.lastRefresh;
      try {
        localStorage.setItem(keyStoreName, JSON.stringify({
          documents: [...this.keys.values()].slice(0, 12).map((entry) => entry.document),
          lastRefresh: this.lastRefresh,
        }));
      } catch {
        // The in-memory keyring remains usable in private or storage-limited sessions.
      }
      return Boolean(data.lastRefresh);
    } catch {
      return false;
    }
  }

  async match(evidence) {
    let signature;
    try {
      signature = rawSignature(evidence.envelope.signature);
    } catch {
      return { signatureStatus: 'malformed', signingKey: null };
    }
    if (!this.keys.size) return { signatureStatus: 'unavailable', signingKey: null };
    const original = utf8.encode(evidence.envelope.token);
    for (const [fingerprint, { key }] of this.keys) {
      if (await crypto.subtle.verify(scheme, key, signature, original)) {
        return { signatureStatus: 'verified', signingKey: fingerprint };
      }
    }
    return { signatureStatus: 'mismatch', signingKey: null };
  }

  async inspect(evidence) {
    let authenticity = await this.match(evidence);
    if (authenticity.signatureStatus === 'mismatch' && this.inFlight) {
      await this.inFlight;
      authenticity = await this.match(evidence);
    }
    const fingerprint = await digest(utf8.encode(evidence.envelope.token + '.' + evidence.envelope.signature));
    return { ...authenticity, fingerprint, verifiedAt: Date.now(), keyCount: this.keys.size };
  }
}

function timestamp(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, fraction, zone] = parts;
  const wallTime = year + '-' + month + '-' + day + 'T' + hour + ':' + minute + ':' + second;
  const local = new Date(wallTime + 'Z');
  if (!Number.isFinite(+local) || local.toISOString().slice(0, 19) !== wallTime
      || (/^[+-]14:/.test(zone) && !zone.endsWith(':00'))) return null;
  const parsed = Date.parse(wallTime + '.' + (fraction ?? '').padEnd(3, '0').slice(0, 3) + zone);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluatePolicy(payload, now = Date.now()) {
  const issuedAt = timestamp(payload.IssuanceTime);
  const expiresAt = timestamp(payload.ExpirationTime);
  const datesValid = issuedAt !== null && expiresAt !== null && expiresAt >= issuedAt;
  const structure = datesValid && typeof payload.UserId === 'string' && payload.UserId.length > 0
    && typeof payload.Challenge === 'string' && payload.Challenge.length > 0
    && Number.isInteger(payload.PlayerId) && typeof payload.TestSignature === 'boolean';
  const checks = [
    ['invalid', '令牌结构与日期有效', structure],
    ['version', '协议版本为 2', payload.TokenVersion === 2],
    ['usage', '用途为 Authentication', payload.Usage === 'Authentication'],
    ['test', '正式环境签名标记', payload.TestSignature === false],
    ['future', '签发时间未超过当前时间 20 分钟', issuedAt !== null && issuedAt <= now + 20 * 60_000],
    ['expired', '尚在认证时间窗口内', expiresAt !== null && expiresAt >= now],
  ];
  return { status: checks.find(([, , pass]) => !pass)?.[0] ?? 'current', checks, issuedAt, expiresAt, datesValid };
}
