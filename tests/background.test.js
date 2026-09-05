const { test } = require("node:test");
const assert = require("node:assert/strict");
const { background, entry } = require("./harness.cjs");
const sender = (url = entry, id = 1, frameId = 0) => ({ url, tab: { id }, frameId });

test("direct Purdue Microsoft entry can arm and generate a code without exposing the seed", async () => {
  const b = background();
  const state = await b.send("getMicrosoftState");
  assert.equal(state.canStart, true);
  assert.equal(state.armed, false);
  assert.equal("totpSecret" in state, false);
  assert.equal((await b.send("getTotp")).ok, false);
  assert.equal((await b.send("armLogin")).ok, true);
  assert.match((await b.send("getTotp")).code, /^\d{6}$/);
  assert.ok(b.accesses.every(a => a === "TRUSTED_CONTEXTS"));
});

test("unknown tenants, generic unarmed Microsoft pages, HTTP, ports and frames cannot arm", async () => {
  for (const s of [
    sender("https://login.microsoftonline.com/other-tenant/saml2"),
    sender("https://login.microsoftonline.com/common/login"),
    sender("http://login.microsoftonline.com/" + entry.split("/").slice(3).join("/")),
    sender(entry.replace(".com/", ".com:444/")),
    sender(entry, 1, 1), sender("https://login.microsoftonline.com.example.org/")
  ]) assert.equal((await background().send("armLogin", s)).ok, false);
});

test("another tab cannot consume or erase the authorization; tabs are independent", async () => {
  const b = background();
  await b.send("armLogin", sender(entry, 1));
  assert.equal((await b.send("getMicrosoftState", sender(entry, 2))).armed, false);
  assert.equal((await b.send("getTotp", sender(entry, 2))).ok, false);
  assert.equal((await b.send("getMicrosoftState", sender(entry, 1))).armed, true);
  await b.send("armLogin", sender(entry, 2));
  await b.send("cancelLogin", sender(entry, 2));
  assert.equal((await b.send("getMicrosoftState", sender(entry, 1))).armed, true);
});

test("armed Purdue login continues on common Microsoft MFA, then is consumed", async () => {
  const b = background();
  await b.send("armLogin");
  const common = sender("https://login.microsoftonline.com/common/SAS/ProcessAuth");
  assert.equal((await b.send("getTotp", common)).ok, true);
  await b.send("completeLogin", common);
  assert.equal((await b.send("getTotp", common)).ok, false);
});

test("expiration, disablement, and switching to another tenant stop generation", async () => {
  const b = background();
  await b.send("armLogin");
  b.clock.now += 300001;
  assert.equal((await b.send("getTotp")).ok, false);
  await b.send("armLogin");
  b.local.enabled = false;
  assert.equal((await b.send("getTotp")).ok, false);
  b.local.enabled = true;
  await b.send("getMicrosoftState", sender("https://login.microsoftonline.com/another-tenant/login"));
  assert.equal((await b.send("getTotp")).ok, false);
});

test("legacy Purdue SSO still arms", async () => {
  const b = background();
  assert.equal((await b.send("armLogin", sender("https://sso.purdue.edu/login"))).ok, true);
  assert.equal((await b.send("getMicrosoftState")).armed, true);
});
