"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");

const source = fs.readFileSync(require.resolve("../src/totp.js"), "utf8");
const context = { crypto: webcrypto };
context.globalThis = context;
vm.runInNewContext(source, context);

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const vectors = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"]
];

(async () => {
  for (const [seconds, expected] of vectors) {
    const actual = await context.PurdueTotp.generate(secret, seconds * 1000, { digits: 8 });
    assert.equal(actual, expected);
  }

  assert.equal(context.PurdueTotp.normalizeBase32("jbsw y3dp-ehpk3pxp===="), "JBSWY3DPEHPK3PXP");
  assert.throws(() => context.PurdueTotp.normalizeBase32("not-base32-!"));
  console.log("TOTP RFC 6238 vectors passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
