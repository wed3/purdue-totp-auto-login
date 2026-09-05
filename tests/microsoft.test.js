const { test } = require("node:test");
const assert = require("node:assert/strict");
const { background, dom, entry } = require("./harness.cjs");

function usernameScreen(d) {
  const input = d.node("input", { id: "i0116", name: "loginfmt" });
  const next = d.node("input", { id: "idSIButton9", type: "submit", value: "Next" });
  d.screen(input, next);
  return { input, next };
}
function otpScreen(d, text = "Enter a code from your authenticator app") {
  const input = d.node("input", { id: "idTxtBx_SAOTCC_OTC", name: "otc" });
  const verify = d.node("input", { id: "idSubmit_SAOTCC_Continue", type: "submit", value: "Verify" });
  d.screen(d.node("p", {}, text), input, verify);
  return { input, verify };
}

test("reported direct-entry page shows button before activation; synthetic click does not arm", async () => {
  const b = background(); const d = dom(b);
  usernameScreen(d); d.start(); await d.flush();
  assert.equal(d.button().textContent, "Auto log in");
  assert.equal(d.calls.includes("getTotp"), false);
  d.button().click(); await d.flush();
  assert.equal((await b.send("getMicrosoftState")).armed, false);
});

test("explicit click fills saved username, advances Next, preserves activation across screen replacement, and submits one MFA code", async () => {
  const b = background(); const d = dom(b);
  const { input, next } = usernameScreen(d); d.start(); await d.flush();
  d.button().userClick(); await d.flush();
  assert.equal(input.value, "testuser@purdue.edu");
  assert.equal(next.clicks, 1);
  assert.equal((await b.send("getMicrosoftState")).armed, true);
  const password = d.node("input", { type: "password", value: "test-only-not-a-real-password" });
  const signin = d.node("input", { id: "idSIButton9", type: "submit", value: "Sign in" });
  d.screen(password, signin); await d.flush();
  assert.ok(d.button());
  assert.equal(signin.clicks, 0);
  const { input: otp, verify } = otpScreen(d); await d.flush();
  // WebCrypto HMAC resolves asynchronously independently of mock timers.
  for (let i = 0; i < 10 && !otp.value; i++) await d.poll();
  assert.match(otp.value, /^\d{6}$/);
  assert.equal(verify.clicks, 1);
  assert.equal((await b.send("getMicrosoftState")).armed, false);
  await d.poll(); assert.equal(verify.clicks, 1);
});

test("button is restored after delayed Microsoft rendering and not duplicated", async () => {
  const d = dom(background()); d.start(); await d.flush();
  assert.equal(d.button(), null);
  usernameScreen(d); await d.flush(); await d.poll();
  assert.equal(d.document.querySelectorAll("#purdue-totp-auto-login-button").length, 1);
});

test("unconfigured and disabled users can see the button and open settings", async () => {
  for (const config of [{ totpSecret: "" }, { enabled: false }]) {
    const d = dom(background(config)); usernameScreen(d); d.start(); await d.flush();
    d.button().userClick(); await d.flush();
    assert.ok(d.calls.includes("openOptions"));
    assert.equal(d.calls.includes("armLogin"), false);
  }
});

test("missing or non-Purdue username does not advance or arm", async () => {
  for (const value of ["", "someone@example.com"]) {
    const b = background({ username: "" }); const d = dom(b);
    const { input, next } = usernameScreen(d); input.value = value;
    d.start(); await d.flush(); d.button().userClick(); await d.flush();
    assert.equal(next.clicks, 0);
    assert.equal((await b.send("getMicrosoftState")).armed, false);
  }
});

test("ordinary Microsoft and other-tenant logins receive no button", async () => {
  for (const url of ["https://login.microsoftonline.com/common/login", "https://login.microsoftonline.com/other-tenant/login"]) {
    const d = dom(background(), { url }); usernameScreen(d); d.start(); await d.flush();
    assert.equal(d.button(), null);
  }
});

test("SMS, email, and unknown code screens never receive a TOTP", async () => {
  for (const text of ["Enter the code sent to your phone by SMS", "Email verification code", "Enter code"]) {
    const b = background(); await b.send("armLogin"); const d = dom(b);
    const { input, verify } = otpScreen(d, text); d.start(); await d.flush();
    assert.equal(input.value, ""); assert.equal(verify.clicks, 0);
    assert.equal(d.calls.includes("getTotp"), false);
  }
});

test("manual code is preserved; fill-only mode never submits", async () => {
  const b = background({ autoSubmit: false }); await b.send("armLogin"); const d = dom(b);
  const { input, verify } = otpScreen(d); input.value = "123123"; d.start(); await d.flush();
  assert.equal(input.value, "123123"); assert.equal(verify.clicks, 0);
  input.value = "";
  for (let i = 0; i < 10 && !input.value; i++) await d.poll();
  assert.match(input.value, /^\d{6}$/); assert.equal(verify.clicks, 0);
  assert.equal((await b.send("getMicrosoftState")).armed, false);
});

test("code near expiry waits for a fresh window", async () => {
  const b = background(); b.clock.now += 28000; await b.send("armLogin"); const d = dom(b);
  const { input, verify } = otpScreen(d); d.start(); await d.flush(); await d.poll();
  assert.equal(input.value, ""); assert.equal(verify.clicks, 0);
  b.clock.now += 3000;
  for (let i = 0; i < 10 && !input.value; i++) await d.poll();
  assert.match(input.value, /^\d{6}$/); assert.equal(verify.clicks, 1);
});

test("other displayed account cancels; cancel button stops activation", async () => {
  const b = background(); const d = dom(b); usernameScreen(d); d.start(); await d.flush();
  d.button().userClick(); await d.flush();
  d.button().userClick(); await d.flush();
  assert.equal((await b.send("getMicrosoftState")).armed, false);
  await b.send("armLogin"); const form = d.screen(d.node("p", { id: "displayName" }, "other@example.com"));
  form.append(d.node("input", { id: "idTxtBx_SAOTCC_OTC" }));
  await d.poll();
  assert.equal((await b.send("getMicrosoftState")).armed, false);
});

test("method chooser moves from alternate-method link to app OTP then submits once", async () => {
  const b = background(); await b.send("armLogin"); const d = dom(b);
  const alternate = d.node("a", { id: "signInAnotherWay" }, "Sign in another way");
  d.screen(alternate); d.start(); await d.flush(); await d.poll();
  assert.equal(alternate.clicks, 1);
  const app = d.node("div", {}, "Use a verification code");
  app.setAttribute("data-value", "PhoneAppOTP");
  d.screen(app); await d.flush(); await d.poll();
  assert.equal(app.clicks, 1);
  const { input, verify } = otpScreen(d, "Enter code");
  for (let i = 0; i < 10 && !input.value; i++) await d.poll();
  assert.match(input.value, /^\d{6}$/); assert.equal(verify.clicks, 1);
});

test("manual method selection setting leaves the alternate link alone", async () => {
  const b = background({ autoSelectMethod: false }); await b.send("armLogin"); const d = dom(b);
  const alternate = d.node("a", { id: "signInAnotherWay" }, "Sign in another way");
  d.screen(alternate); d.start(); await d.flush();
  assert.equal(alternate.clicks, 0);
});

test("disabled Verify waits until enabled instead of consuming activation", async () => {
  const b = background(); await b.send("armLogin"); const d = dom(b);
  const { input, verify } = otpScreen(d); verify.disabled = true;
  d.start(); await d.flush(); await d.poll();
  assert.equal(input.value, "");
  assert.equal((await b.send("getMicrosoftState")).armed, true);
  verify.disabled = false;
  for (let i = 0; i < 10 && !input.value; i++) await d.poll();
  assert.match(input.value, /^\d{6}$/); assert.equal(verify.clicks, 1);
});

test("button is inserted into the white sign-in card, not its outer form", async () => {
  const d = dom(background());
  const outer = d.node("form"); const card = d.node("div", { id: "lightbox" });
  card.append(d.node("input", { id: "i0116", name: "loginfmt" }), d.node("input", { id: "idSIButton9", type: "submit", value: "Next" }));
  outer.append(card); d.document.body.append(outer); d.start(); await d.flush();
  assert.equal(d.document.getElementById("purdue-totp-panel").parentElement, card);
});
