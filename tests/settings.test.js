const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const context = vm.createContext({});
for (const name of ["totp.js", "settings.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src", name), "utf8"), context);
}
const build = context.PurdueSettings.build;
const input = { username: "testuser", totpSecret: "JBSWY3DPEHPK3PXP", enabled: true, autoSelectMethod: true, autoSubmit: true };

test("one-click defaults off and does not retain a password accidentally", () => {
  const settings = build(input, { password: "test-only-password" });
  assert.equal(settings.oneClick, false); assert.equal(settings.password, "");
});
test("one-click requires both a valid Purdue username and a password", () => {
  assert.throws(() => build({ ...input, oneClick: true }), /password/);
  assert.throws(() => build({ ...input, username: "", oneClick: true, password: "test" }), /username/);
  assert.throws(() => build({ ...input, username: "test@example.com", oneClick: true, password: "test" }), /username/);
});
test("password spaces are preserved exactly; secrets normalize", () => {
  const settings = build({ ...input, oneClick: true, password: " test-only password ", totpSecret: "jbsw y3dp-ehpk3pxp" });
  assert.equal(settings.password, " test-only password ");
  assert.equal(settings.totpSecret, "JBSWY3DPEHPK3PXP");
});
test("blank password keeps the existing value only for the same account", () => {
  const old = { username: "testuser@purdue.edu", password: "test-only-password" };
  assert.equal(build({ ...input, oneClick: true, password: "" }, old).password, old.password);
  assert.throws(() => build({ ...input, username: "anotheruser", oneClick: true }, old), /password/);
});
test("disabling one-click erases the saved password but keeps the MFA key", () => {
  const settings = build({ ...input, oneClick: false, password: "ignored" }, { password: "old" });
  assert.equal(settings.password, ""); assert.equal(settings.totpSecret, input.totpSecret);
});
