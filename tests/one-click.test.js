const { test } = require("node:test");
const assert = require("node:assert/strict");
const { background, dom, entry } = require("./harness.cjs");
const saved = { oneClick: true, password: "test-only-password-not-a-real-credential" };
const passMessage = { type: "getPassword", account: "testuser@purdue.edu" };
const sender = (url = entry, id = 1, frameId = 0) => ({ url, tab: { id }, frameId });
const settle = async d => { for (let i = 0; i < 8; i++) await d.poll(); };

function passwordScreen(d) {
  const identity = d.node("div", { id: "displayName" }, "testuser@purdue.edu");
  const input = d.node("input", { id: "i0118", name: "passwd", type: "password" });
  const submit = d.node("input", { id: "idSIButton9", type: "submit", value: "Sign in" });
  const form = d.screen(identity, input, submit);
  return { input, submit, form };
}

test("password is inaccessible before activation, outside one-click mode, or from the wrong tab/account/origin/frame", async () => {
  const b = background(saved);
  assert.equal((await b.send(passMessage)).ok, false);
  await b.send("armLogin");
  for (const s of [sender(entry, 2), sender(entry, 1, 1), sender("https://example.com/"), sender("https://login.microsoftonline.com/other/login")]) {
    assert.equal((await b.send(passMessage, s)).ok, false);
  }
  assert.equal((await b.send({ ...passMessage, account: "other@purdue.edu" })).ok, false);
  const manual = background({ password: saved.password }); await manual.send("armLogin");
  assert.equal((await manual.send(passMessage)).ok, false);
  const state = await b.send("getMicrosoftState");
  assert.equal("password" in state, false); assert.equal("totpSecret" in state, false);
});

test("password is released once per activation, including simultaneous requests", async () => {
  const b = background(saved); await b.send("armLogin");
  const results = await Promise.all([b.send(passMessage), b.send(passMessage)]);
  assert.equal(results.filter(r => r.ok).length, 1);
  assert.equal(results.find(r => r.ok).password, saved.password);
  assert.equal((await b.send(passMessage)).ok, false);
});

test("expiry and cancellation revoke password access", async () => {
  const b = background(saved); await b.send("armLogin"); b.clock.now += 300001;
  assert.equal((await b.send(passMessage)).ok, false);
  await b.send("armLogin"); await b.send("cancelLogin");
  assert.equal((await b.send(passMessage)).ok, false);
});

test("one-click mode cannot arm with incomplete saved credentials", async () => {
  assert.equal((await background({ oneClick: true }).send("armLogin")).ok, false);
  assert.equal((await background({ ...saved, username: "" }).send("armLogin")).ok, false);
});

test("one trusted click completes username, passwordless fallback, password, MFA and KMSI with no more user input", async () => {
  const b = background({ ...saved, autoSubmit: false, autoSelectMethod: false });
  const d = dom(b);
  const username = d.node("input", { id: "i0116", name: "loginfmt" });
  const next = d.node("input", { id: "idSIButton9", type: "submit", value: "Next" });
  let fallback, pushRetry, pass, otp, verify, no, yes;
  next.addEventListener("click", () => {
    fallback = d.node("a", {}, "Use your password instead");
    pushRetry = d.node("input", { id: "idSIButton9", type: "submit", value: "Next" });
    fallback.addEventListener("click", () => {
      pass = passwordScreen(d);
      pass.submit.addEventListener("click", () => {
        const alternate = d.node("a", { id: "signInAnotherWay" }, "Sign in another way");
        alternate.addEventListener("click", () => {
          const method = d.node("div", {}, "Use a verification code");
          method.setAttribute("data-value", "PhoneAppOTP");
          method.addEventListener("click", () => {
            otp = d.node("input", { id: "idTxtBx_SAOTCC_OTC", name: "otc" });
            verify = d.node("input", { id: "idSubmit_SAOTCC_Continue", type: "submit", value: "Verify" });
            verify.addEventListener("click", () => {
              no = d.node("input", { id: "idBtn_Back", value: "No", type: "button" });
              yes = d.node("input", { id: "idSIButton9", value: "Yes", type: "submit" });
              no.addEventListener("click", () => d.screen(d.node("p", {}, "Simulated destination")));
              d.screen(d.node("h1", { id: "loginHeader" }, "Stay signed in?"), no, yes);
            });
            d.screen(d.node("p", {}, "Enter code from your authenticator app"), otp, verify);
          });
          d.screen(method);
        });
        d.screen(alternate);
      });
    });
    d.screen(d.node("h1", {}, "Request wasn't sent"), fallback, pushRetry);
  });
  d.screen(username, next); d.start(); await d.flush();
  assert.equal(next.clicks, 0); assert.equal(d.calls.includes("getPassword"), false);
  d.button().userClick(); await settle(d);
  assert.equal(username.value, "testuser@purdue.edu"); assert.equal(next.clicks, 1);
  assert.equal(fallback.clicks, 1); assert.equal(pushRetry.clicks, 0);
  assert.equal(pass.input.value, saved.password); assert.equal(pass.submit.clicks, 1);
  assert.match(otp.value, /^\d{6}$/); assert.equal(verify.clicks, 1);
  assert.equal(no.clicks, 1); assert.equal(yes.clicks, 0);
  assert.equal((await b.send("getMicrosoftState")).armed, false);
  assert.equal((await b.send("getMicrosoftState")).finishing, false);
});

test("one-click can start directly on password screen; wrong-password error stops without a retry", async () => {
  const b = background(saved); const d = dom(b); const pass = passwordScreen(d);
  pass.submit.addEventListener("click", () => pass.form.append(d.node("p", { id: "passwordError" }, "Incorrect password")));
  d.start(); await d.flush(); d.button().userClick(); await settle(d);
  assert.equal(pass.submit.clicks, 1);
  assert.equal((await b.send("getMicrosoftState")).armed, false);
  await settle(d); assert.equal(pass.submit.clicks, 1);
});

test("manual mode does not select password fallback or read/fill/submit password", async () => {
  const b = background(); await b.send("armLogin"); const d = dom(b);
  const fallback = d.node("a", {}, "Use your password instead");
  d.screen(fallback); d.start(); await d.flush(); assert.equal(fallback.clicks, 0);
  const pass = passwordScreen(d); await settle(d);
  assert.equal(pass.input.value, ""); assert.equal(pass.submit.clicks, 0);
  assert.equal(d.calls.includes("getPassword"), false);
});

test("other displayed account prevents password release", async () => {
  const b = background(saved); await b.send("armLogin"); const d = dom(b);
  const pass = passwordScreen(d); d.document.getElementById("displayName").textContent = "other@purdue.edu";
  d.start(); await settle(d);
  assert.equal(pass.input.value, ""); assert.equal(d.calls.includes("getPassword"), false);
  assert.equal((await b.send("getMicrosoftState")).armed, false);
});

test("MFA completion revokes credential access; KMSI continuation expires in a minute", async () => {
  const b = background(saved); await b.send("armLogin"); await b.send("completeLogin");
  assert.equal((await b.send("getPassword")).ok, false);
  assert.equal((await b.send("getTotp")).ok, false);
  assert.equal((await b.send("getMicrosoftState")).finishing, true);
  b.clock.now += 60001;
  assert.equal((await b.send("getMicrosoftState")).finishing, false);
});

test("one-click never presses Yes on application consent", async () => {
  const b = background(saved); await b.send("armLogin"); const d = dom(b);
  const yes = d.node("input", { id: "idSIButton9", type: "submit", value: "Yes" });
  const no = d.node("input", { id: "idBtn_Back", value: "No" });
  d.screen(d.node("h1", { id: "loginHeader" }, "Permissions requested"), yes, no);
  d.start(); await settle(d); assert.equal(yes.clicks, 0); assert.equal(no.clicks, 0);
});

test("password attempt limit survives navigation to a new content-script instance", async () => {
  const b = background(saved); await b.send("armLogin");
  const d = dom(b); passwordScreen(d); d.start(); await settle(d);
  const d2 = dom(b, { url: "https://login.microsoftonline.com/common/login" });
  const pass2 = passwordScreen(d2); d2.start(); await settle(d2);
  assert.equal(pass2.input.value, ""); assert.equal(pass2.submit.clicks, 0);
});

test("credential/settings changes revoke all active tabs", async () => {
  for (const change of [{ password: "new-test-password" }, { oneClick: false }, { enabled: false }, { username: "another" }]) {
    const b = background(saved); await b.send("armLogin"); await b.send("armLogin", sender(entry, 2));
    await b.changeSettings(change);
    assert.equal((await b.send("getMicrosoftState")).armed, false);
    assert.equal((await b.send("getMicrosoftState", sender(entry, 2))).armed, false);
    assert.equal((await b.send(passMessage)).ok, false);
  }
});

test("cancellation queued during a password request cannot be undone by that request", async () => {
  const b = background(saved); await b.send("armLogin");
  await Promise.all([b.send(passMessage), b.send("cancelLogin")]);
  assert.equal((await b.send("getMicrosoftState")).armed, false);
  assert.equal((await b.send(passMessage)).ok, false);
});
