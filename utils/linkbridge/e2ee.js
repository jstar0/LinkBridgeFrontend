const nacl = require('./vendor/tweetnacl-fast');

// E2EE message envelope prefixes (kept short so backend stores them as plain text).
// - Key announce is not encrypted; it only carries the sender's public key.
// - Encrypted payload is a JSON envelope encoded in Base64.
const PREFIX_KEY = 'LBK1|';
const PREFIX_ENC = 'LBE1|';

const STORE_IDENTITY_KEYPAIR = 'lb_e2ee_identity_keypair_v1';
const STORE_PEER_PUB_PREFIX = 'lb_e2ee_peer_pub_v1_';
const STORE_SESSION_KEY_PREFIX = 'lb_e2ee_session_key_v1_';
const STORE_KEY_ANNOUNCED_PREFIX = 'lb_e2ee_key_announced_v1_';

function bytesToB64(bytes) {
  if (!bytes) return '';
  try {
    return wx.arrayBufferToBase64(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  } catch (e) {
    return '';
  }
}

function b64ToBytes(b64) {
  const s = String(b64 || '').trim();
  if (!s) return new Uint8Array(0);
  try {
    const ab = wx.base64ToArrayBuffer(s);
    return new Uint8Array(ab);
  } catch (e) {
    return new Uint8Array(0);
  }
}

function utf8ToBytes(str) {
  const s = typeof str === 'string' ? str : str == null ? '' : String(str);
  try {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  } catch (e) {
    // ignore
  }
  // Fallback: encodeURIComponent trick (works for BMP).
  const encoded = unescape(encodeURIComponent(s));
  const out = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) out[i] = encoded.charCodeAt(i);
  return out;
}

function bytesToUtf8(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  try {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: false }).decode(b);
  } catch (e) {
    // ignore
  }
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  try {
    return decodeURIComponent(escape(s));
  } catch (e) {
    return s;
  }
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return '';
  }
}

function ensurePrng() {
  // Ensure TweetNaCl has a PRNG for randomBytes().
  // Prefer wx.getRandomValues (secure), otherwise fallback to Math.random (weak).
  if (ensurePrng._done) return;
  ensurePrng._done = true;

  // WebCrypto (sync) – some base libs expose `crypto.getRandomValues`.
  try {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && typeof c.getRandomValues === 'function') {
      nacl.setPRNG((x, n) => {
        const tmp = new Uint8Array(n);
        c.getRandomValues(tmp);
        for (let i = 0; i < n; i++) x[i] = tmp[i];
      });
      return;
    }
  } catch (e) {
    // ignore
  }

  const hasWxRand = typeof wx?.getRandomValues === 'function';
  if (hasWxRand) {
    nacl.setPRNG((x, n) => {
      const out = new Uint8Array(n);
      let done = false;
      try {
        wx.getRandomValues({
          length: n,
          success: (res) => {
            try {
              out.set(res.randomValues);
            } catch (e) {
              // ignore
            }
            done = true;
          },
          fail: () => {
            done = true;
          },
        });
      } catch (e) {
        done = false;
      }

      // Some base libs callback synchronously; if not, fallback.
      if (!done) {
        for (let i = 0; i < n; i++) out[i] = (Math.random() * 256) | 0;
      }

      for (let i = 0; i < n; i++) x[i] = out[i];
    });
    return;
  }

  nacl.setPRNG((x, n) => {
    for (let i = 0; i < n; i++) x[i] = (Math.random() * 256) | 0;
  });
}

function getIdentityKeyPair() {
  ensurePrng();
  try {
    const raw = wx.getStorageSync(STORE_IDENTITY_KEYPAIR);
    if (raw) {
      const obj = typeof raw === 'string' ? safeJsonParse(raw) : raw;
      const pub = b64ToBytes(obj?.publicKey);
      const sec = b64ToBytes(obj?.secretKey);
      if (pub.length === 32 && sec.length === 32) return { publicKey: pub, secretKey: sec };
    }
  } catch (e) {
    // ignore
  }

  // X25519 keypair: scalarMult.base(secretKey)
  const secretKey = nacl.randomBytes(32);
  const publicKey = nacl.scalarMult.base(secretKey);
  try {
    wx.setStorageSync(
      STORE_IDENTITY_KEYPAIR,
      safeJsonStringify({ publicKey: bytesToB64(publicKey), secretKey: bytesToB64(secretKey) })
    );
  } catch (e) {
    // ignore
  }
  return { publicKey, secretKey };
}

function getMyPublicKeyBase64() {
  const kp = getIdentityKeyPair();
  return bytesToB64(kp.publicKey);
}

function getPeerPublicKey(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  try {
    const raw = wx.getStorageSync(`${STORE_PEER_PUB_PREFIX}${sid}`);
    const obj = raw ? (typeof raw === 'string' ? safeJsonParse(raw) : raw) : null;
    const pub = b64ToBytes(obj?.publicKey);
    if (pub.length === 32) return pub;
  } catch (e) {
    // ignore
  }
  return null;
}

function setPeerPublicKey(sessionId, publicKeyBytes) {
  const sid = String(sessionId || '').trim();
  const pub = publicKeyBytes instanceof Uint8Array ? publicKeyBytes : new Uint8Array(0);
  if (!sid || pub.length !== 32) return false;
  try {
    wx.setStorageSync(`${STORE_PEER_PUB_PREFIX}${sid}`, safeJsonStringify({ publicKey: bytesToB64(pub) }));
  } catch (e) {
    // ignore
  }
  return true;
}

function deriveSessionKey(sessionId) {
  ensurePrng();
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  const my = getIdentityKeyPair();
  const peerPub = getPeerPublicKey(sid);
  if (!peerPub) return null;

  // X25519 shared secret (32 bytes)
  const shared = nacl.scalarMult(my.secretKey, peerPub);

  // KDF: SHA-512(shared || utf8(sessionId)) -> first 32 bytes
  const info = utf8ToBytes(`lb-session:${sid}`);
  const material = new Uint8Array(shared.length + info.length);
  material.set(shared, 0);
  material.set(info, shared.length);
  const hash = nacl.hash(material); // 64 bytes
  const key = hash.slice(0, 32);

  return key;
}

function getSessionKey(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return null;
  try {
    const raw = wx.getStorageSync(`${STORE_SESSION_KEY_PREFIX}${sid}`);
    const obj = raw ? (typeof raw === 'string' ? safeJsonParse(raw) : raw) : null;
    const key = b64ToBytes(obj?.key);
    if (key.length === 32) return key;
  } catch (e) {
    // ignore
  }

  const derived = deriveSessionKey(sid);
  if (!derived) return null;
  try {
    wx.setStorageSync(`${STORE_SESSION_KEY_PREFIX}${sid}`, safeJsonStringify({ key: bytesToB64(derived) }));
  } catch (e) {
    // ignore
  }
  return derived;
}

function isKeyAnnounceText(text) {
  const t = typeof text === 'string' ? text : '';
  return t.startsWith(PREFIX_KEY);
}

function isEncryptedText(text) {
  const t = typeof text === 'string' ? text : '';
  return t.startsWith(PREFIX_ENC);
}

function buildKeyAnnounceText() {
  const pub = getMyPublicKeyBase64();
  const payload = safeJsonStringify({ v: 1, publicKey: pub });
  return `${PREFIX_KEY}${bytesToB64(utf8ToBytes(payload))}`;
}

function tryConsumeKeyAnnounce(sessionId, text) {
  const sid = String(sessionId || '').trim();
  const t = typeof text === 'string' ? text : '';
  if (!sid || !t.startsWith(PREFIX_KEY)) return { consumed: false };

  const b64 = t.slice(PREFIX_KEY.length);
  const jsonRaw = bytesToUtf8(b64ToBytes(b64));
  const obj = safeJsonParse(jsonRaw);
  const pub = b64ToBytes(obj?.publicKey);
  if (pub.length !== 32) return { consumed: false };

  const changed = setPeerPublicKey(sid, pub);
  // Once we have peer pub, session key can be derived.
  const key = getSessionKey(sid);
  return { consumed: true, changed, ready: !!key };
}

function shouldAnnounceKey(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return false;
  try {
    return !wx.getStorageSync(`${STORE_KEY_ANNOUNCED_PREFIX}${sid}`);
  } catch (e) {
    return true;
  }
}

function markKeyAnnounced(sessionId) {
  const sid = String(sessionId || '').trim();
  if (!sid) return;
  try {
    wx.setStorageSync(`${STORE_KEY_ANNOUNCED_PREFIX}${sid}`, 1);
  } catch (e) {
    // ignore
  }
}

function encryptText(sessionId, plaintext, burnAfterSec) {
  ensurePrng();
  const sid = String(sessionId || '').trim();
  const key = getSessionKey(sid);
  if (!sid || !key) return { ok: false, reason: 'KEY_NOT_READY' };

  const text = typeof plaintext === 'string' ? plaintext : plaintext == null ? '' : String(plaintext);
  const nonce = nacl.randomBytes(24);
  const box = nacl.secretbox(utf8ToBytes(text), nonce, key);

  const payload = {
    v: 1,
    alg: 'xsalsa20-poly1305',
    nonce: bytesToB64(nonce),
    box: bytesToB64(box),
    sentAtMs: Date.now(),
    burnAfterSec: Number(burnAfterSec) > 0 ? Math.min(120, Math.max(1, Number(burnAfterSec))) : 0,
  };
  const encoded = bytesToB64(utf8ToBytes(safeJsonStringify(payload)));
  return { ok: true, text: `${PREFIX_ENC}${encoded}` };
}

function decryptText(sessionId, encryptedText) {
  const sid = String(sessionId || '').trim();
  const t = typeof encryptedText === 'string' ? encryptedText : '';
  if (!sid || !t.startsWith(PREFIX_ENC)) return { ok: false, reason: 'NOT_ENCRYPTED' };

  const key = getSessionKey(sid);
  if (!key) return { ok: false, reason: 'KEY_NOT_READY' };

  const b64 = t.slice(PREFIX_ENC.length);
  const jsonRaw = bytesToUtf8(b64ToBytes(b64));
  const payload = safeJsonParse(jsonRaw);
  const nonce = b64ToBytes(payload?.nonce);
  const box = b64ToBytes(payload?.box);

  if (nonce.length !== 24 || box.length < 16) return { ok: false, reason: 'INVALID_PAYLOAD' };
  const opened = nacl.secretbox.open(box, nonce, key);
  if (!opened) return { ok: false, reason: 'DECRYPT_FAILED' };

  return {
    ok: true,
    text: bytesToUtf8(opened),
    sentAtMs: Number(payload?.sentAtMs || 0) || 0,
    burnAfterSec: Number(payload?.burnAfterSec || 0) || 0,
  };
}

module.exports = {
  PREFIX_KEY,
  PREFIX_ENC,
  getMyPublicKeyBase64,
  isKeyAnnounceText,
  isEncryptedText,
  buildKeyAnnounceText,
  tryConsumeKeyAnnounce,
  shouldAnnounceKey,
  markKeyAnnounced,
  getPeerPublicKey,
  getSessionKey,
  encryptText,
  decryptText,
};
