(function (scope) {
  "use strict";

  const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function normalizeBase32(value) {
    const normalized = String(value || "")
      .toUpperCase()
      .replace(/[\s-]+/g, "")
      .replace(/=+$/g, "");

    if (!normalized) {
      throw new Error("enter a TOTP secret");
    }

    if (!/^[A-Z2-7]+$/.test(normalized)) {
      throw new Error("the secret must contain only Base32 characters A-Z and 2-7");
    }

    return normalized;
  }

  function base32ToBytes(value) {
    const normalized = normalizeBase32(value);
    const bytes = [];
    let buffer = 0;
    let bits = 0;

    for (const character of normalized) {
      buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
      bits += 5;

      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >>> bits) & 0xff);
      }

      // Keeping only the unconsumed bits avoids 32-bit overflow on long keys.
      buffer &= (1 << bits) - 1;
    }

    return new Uint8Array(bytes);
  }

  async function generate(secret, timestamp = Date.now(), options = {}) {
    const period = options.period || 30;
    const digits = options.digits || 6;
    const algorithm = options.algorithm || "SHA-1";
    const counter = Math.floor(timestamp / 1000 / period);
    const counterBytes = new ArrayBuffer(8);
    const view = new DataView(counterBytes);
    view.setUint32(0, Math.floor(counter / 0x100000000), false);
    view.setUint32(4, counter >>> 0, false);

    const key = await crypto.subtle.importKey(
      "raw",
      base32ToBytes(secret),
      { name: "HMAC", hash: algorithm },
      false,
      ["sign"]
    );
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3];

    return String(binary % (10 ** digits)).padStart(digits, "0");
  }

  function secondsRemaining(timestamp = Date.now(), period = 30) {
    const elapsed = Math.floor(timestamp / 1000) % period;
    return period - elapsed;
  }

  scope.PurdueTotp = Object.freeze({
    normalizeBase32,
    base32ToBytes,
    generate,
    secondsRemaining
  });
})(globalThis);
