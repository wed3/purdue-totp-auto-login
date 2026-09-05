(function () {
  "use strict";

  const PANEL_ID = "purdue-totp-panel";
  const MIN_SECONDS_TO_SUBMIT = 4;
  let timer = null;
  let scanning = false;
  let rerun = false;
  let acting = false;
  let handled = false;
  let choseAppCode = false;
  let participated = false;
  let clicked = new WeakSet();
  let notice = "";
  let usernameSubmitted = false;
  let passwordSubmitted = false;

  // Microsoft switches screens without always navigating. Stay ready before
  // activation too, and restore the panel when Microsoft replaces its DOM.
  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ["class", "style", "aria-hidden", "disabled"]
  });
  document.addEventListener("input", () => scheduleScan());
  window.setInterval(() => scheduleScan(), 1500);
  scheduleScan();

  function scheduleScan(delay = 100) {
    if (scanning) { rerun = true; return; }
    if (timer !== null) return;
    timer = window.setTimeout(() => { timer = null; scan(); }, delay);
  }

  async function scan() {
    if (scanning) return;
    scanning = true;
    try {
      const state = await send("getMicrosoftState");
      if (!state.ok) return;
      if (!state.allowed || (!state.canStart && !state.armed && !state.finishing && !participated)) {
        document.getElementById(PANEL_ID)?.remove();
        return;
      }
      ensurePanel(state);
      if ((!state.armed && !state.finishing) || acting) return;

      const identity = firstVisible("#displayName, #idDiv_SAOTCS_Username, .identity");
      const account = (identity?.textContent || "").trim().toLowerCase();
      const expected = normalizeAccount(state.username);
      if (account.includes("@") && (!account.endsWith("@purdue.edu") ||
          (expected && account !== expected))) {
        await send("cancelLogin");
        notice = "Account does not match Purdue settings. Auto-login stopped.";
        scheduleScan();
        return;
      }

      if (state.oneClick) {
        if (await finishStaySignedIn()) return;
        if (state.finishing || handled) return;
        if (await advanceCredentials(state)) return;
      }
      if (handled || !state.armed) return;
      // Manual mode retains the proven password-manager workflow.
      if (firstVisible('input[name="loginfmt"], #i0116, input[type="password"]')) return;

      const codeInput = findCodeInput();
      if (codeInput) { await fillCode(codeInput, state.autoSubmit); return; }
      if (!state.autoSelectMethod) return;

      const codeMethod = findCodeMethod();
      if (codeMethod) {
        choseAppCode = true;
        clickOnce(codeMethod);
        return;
      }
      const alternate = firstVisible(
        '#idA_SAASTO_TOTP, #signInAnotherWay, [data-testid="signInAnotherWay"]'
      ) || findClickableByText([
        "i can't use my microsoft authenticator app right now",
        "sign in another way",
        "other ways to sign in",
        "use a different verification option"
      ]);
      if (alternate) clickOnce(alternate);
    } catch (_) {
      notice = "Extension unavailable. Reload this page after reloading the extension.";
      setText(document.getElementById("purdue-totp-status"), notice);
    } finally {
      scanning = false;
      if (rerun) { rerun = false; scheduleScan(); }
    }
  }

  function ensurePanel(state) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      const primary = firstVisible("#idSIButton9, #idSubmit_SAOTCC_Continue");
      const root = primary?.closest("#lightbox") || firstVisible("#lightbox") ||
        primary?.closest("form") || firstVisible("form");
      if (!root) return;
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      const button = document.createElement("button");
      button.type = "button";
      button.id = "purdue-totp-auto-login-button";
      button.addEventListener("click", (event) => {
        // Page JavaScript must not silently arm a code request by .click().
        if (event.isTrusted) startOrCancel();
      });
      const status = document.createElement("p");
      status.id = "purdue-totp-status";
      status.setAttribute("role", "status");
      panel.append(button, status);
      root.append(panel);
    }
    const button = document.getElementById("purdue-totp-auto-login-button");
    setText(button, state.armed || state.finishing ? "Cancel auto log in" : "Auto log in");
    if (button.disabled !== acting) button.disabled = acting;
    setText(document.getElementById("purdue-totp-status"), notice || (
      !state.enabled ? "Extension disabled. Click to open settings." :
      !state.configured ? "TOTP setup required. Click to open settings." :
      state.finishing ? "MFA submitted. Completing sign-in…" :
      state.armed && state.oneClick ? "One-click login active. Username, password and MFA are automatic." :
      state.armed ? "Active for this tab. Enter your password normally; MFA code is automatic." :
      state.oneClick ? "One-click mode · click once to sign in with your saved credentials." :
      "Purdue extension · click to enable code-based MFA for this login."
    ));
  }

  async function startOrCancel() {
    if (acting) return;
    acting = true;
    try {
      const state = await send("getMicrosoftState");
      if (!state.ok) throw new Error(state.error || "Extension unavailable.");
      if (!state.configured || !state.enabled) { await send("openOptions"); return; }
      if (state.armed || state.finishing) {
        await send("cancelLogin");
        notice = "Auto-login cancelled.";
        return;
      }
      const username = firstVisible('input[name="loginfmt"], #i0116');
      if (username) {
        const account = normalizeAccount(username.value || state.username);
        if (!account || !/^[^\s@]+@purdue\.edu$/.test(account)) {
          notice = "Enter your Purdue email first, then click Auto log in.";
          username.focus();
          return;
        }
        const expected = normalizeAccount(state.username);
        if (expected && expected !== account) {
          notice = "This email differs from the username in extension settings.";
          return;
        }
        setInputValue(username, account);
      }
      const result = await send("armLogin");
      if (!result.ok) throw new Error(result.error || "Could not start auto-login.");
      handled = false;
      choseAppCode = false;
      participated = true;
      clicked = new WeakSet();
      notice = "";
      usernameSubmitted = false;
      passwordSubmitted = false;
      const next = username && firstVisible("#idSIButton9");
      if (next) {
        usernameSubmitted = true;
        next.click();
      }
    } catch (error) {
      notice = error.message;
    } finally {
      acting = false;
      scheduleScan();
    }
  }

  async function advanceCredentials(state) {
    const error = firstVisible("#passwordError, #usernameError");
    if (error && normalizeText(error.textContent)) {
      await send("cancelLogin");
      notice = "Microsoft rejected the sign-in details. Automation stopped; check your saved username/password.";
      scheduleScan();
      return true;
    }

    const username = firstVisible('input[name="loginfmt"], #i0116');
    if (username) {
      const account = normalizeAccount(state.username);
      if (username.value && normalizeAccount(username.value) !== account) {
        await send("cancelLogin");
        notice = "The entered account differs from the saved username. Auto-login stopped.";
        return true;
      }
      const next = firstVisible("#idSIButton9");
      if (next && !usernameSubmitted) {
        setInputValue(username, account);
        usernameSubmitted = true;
        notice = "Continuing with your saved username…";
        next.click();
      }
      return true;
    }

    // This exact visible choice appears in the user's verified working flow.
    // Do not retry the failed passwordless push using its 'Next' button.
    const passwordChoice = findClickableByText(["use your password instead", "use password instead"]);
    if (passwordChoice) {
      notice = "Switching to password sign-in…";
      clickOnce(passwordChoice);
      return true;
    }

    const password = firstVisible('#i0118, input[name="passwd"]');
    if (!password) return false;
    if (passwordSubmitted || state.passwordIssued) return true;
    const submit = firstVisible("#idSIButton9");
    if (!submit) return true;

    const result = await send("getPassword", { account: state.username });
    if (!result.ok) {
      await send("cancelLogin");
      notice = result.error || "Saved password is unavailable. Automation stopped.";
      scheduleScan();
      return true;
    }
    const current = await send("getMicrosoftState");
    if (!current.armed || !current.oneClick || !password.isConnected || !isVisible(password)) return true;
    const identity = firstVisible("#displayName, #idDiv_SAOTCS_Username, .identity");
    const account = normalizeText(identity?.textContent);
    if (account.includes("@") && account !== normalizeAccount(current.username)) {
      await send("cancelLogin");
      notice = "Account changed. Auto-login stopped.";
      return true;
    }
    passwordSubmitted = true;
    setInputValue(password, result.password);
    // Permit the page's input bindings to update before clicking Sign in.
    await new Promise(resolve => window.setTimeout(resolve, 120));
    const recheck = await send("getMicrosoftState");
    if (recheck.armed && recheck.oneClick && password.isConnected &&
        password.value === result.password && submit.isConnected && isVisible(submit)) {
      notice = "Password submitted once. Waiting for verification…";
      submit.click();
    }
    return true;
  }

  async function finishStaySignedIn() {
    const heading = firstVisible("#KmsiDescription, #kmsiDescription, #loginHeader, #kmsiTitle");
    const text = normalizeText(heading?.textContent);
    const no = firstVisible("#idBtn_Back");
    if (!no || (!/stay signed in/.test(text) && !firstVisible("#KmsiDescription, #kmsiDescription"))) return false;
    if (normalizeText(no.value || no.textContent) !== "no") return false;
    await send("finishLogin");
    notice = "Finishing sign-in without keeping a persistent session.";
    no.click();
    return true;
  }

  async function fillCode(input, autoSubmit) {
    if (input.value) {
      notice = "A code is already entered. Submit it manually or clear it to use auto-login.";
      return;
    }
    const result = await send("getTotp");
    if (!result.ok) throw new Error(result.error);
    if (result.secondsRemaining <= MIN_SECONDS_TO_SUBMIT) {
      notice = "Waiting for a fresh verification code…";
      return; // periodic scan will try after the 30-second boundary
    }
    const submit = autoSubmit ? findSubmitButton(input) : null;
    if (autoSubmit && !submit) {
      notice = "Verification button not recognized. Turn off auto-submit to fill only.";
      return;
    }
    // Revalidate after async requests: navigation or user entry may have occurred.
    if (!input.isConnected || input !== findCodeInput() || input.value) return;
    const state = await send("getMicrosoftState");
    if (!state.armed || !input.isConnected || input.value || (submit && !isVisible(submit))) return;

    handled = true;
    setInputValue(input, result.code);
    // Consume before submission. A rejected code is never retried automatically.
    await send("completeLogin");
    if (submit && input.isConnected && input.value === result.code && isVisible(submit)) {
      submit.click();
      notice = "Code submitted once. If rejected, check the seed and computer clock.";
    } else {
      notice = "Code filled. Select Verify before it expires.";
    }
    scheduleScan();
  }

  function findCodeInput() {
    const input = firstVisible('#idTxtBx_SAOTCC_OTC, input[name="otc"], input[autocomplete="one-time-code"]');
    if (!input) return null;
    const text = normalizeText(document.body.innerText);
    // SMS/email screens can reuse Microsoft's OTP ID. Require app-code context.
    if (/text message|sms|code (?:we |was )?sent|sent (?:a code )?to|email.*code/.test(text)) return null;
    return choseAppCode || /authenticator|authentication app|mobile app|hardware token/.test(text) ? input : null;
  }

  function findCodeMethod() {
    return firstVisible('[data-value="PhoneAppOTP"], [data-value="SoftwareOath"]') ||
      findClickableByText(["use a verification code", "verification code", "one-time password code"]);
  }

  function findSubmitButton(input) {
    const exact = firstVisible("#idSubmit_SAOTCC_Continue");
    if (exact) return exact;
    const form = input.closest("form");
    if (!form) return null;
    return Array.from(form.querySelectorAll('input[type="submit"], button[type="submit"]'))
      .find(element => isVisible(element) && /^(verify|continue|next)$/.test(
        normalizeText(element.value || element.textContent))) || null;
  }

  function findClickableByText(phrases) {
    return Array.from(document.querySelectorAll('a, button, [role="button"], [role="option"], [data-value]'))
      .find(element => !element.closest("#" + PANEL_ID) && isVisible(element) &&
        phrases.includes(normalizeText(element.innerText || element.textContent))) || null;
  }

  function clickOnce(element) {
    if (clicked.has(element)) return;
    clicked.add(element);
    element.click();
    scheduleScan(350);
  }

  function firstVisible(selector) {
    return Array.from(document.querySelectorAll(selector)).find(isVisible) || null;
  }

  function isVisible(element) {
    if (!element || element.disabled || element.closest('[hidden], [aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function normalizeAccount(value) {
    const account = String(value || "").trim().toLowerCase();
    return account && !account.includes("@") ? account + "@purdue.edu" : account;
  }

  function normalizeText(value) {
    return String(value || "").trim().replace(/[’‘]/g, "'").replace(/\s+/g, " ").toLowerCase();
  }

  function setInputValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function send(type, data = {}) { return chrome.runtime.sendMessage({ type, ...data }); }
})();
