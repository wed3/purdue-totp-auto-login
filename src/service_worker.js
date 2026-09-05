"use strict";

importScripts("totp.js");

const DEFAULTS = Object.freeze({
  enabled: true,
  username: "",
  oneClick: false,
  password: "",
  totpSecret: "",
  autoSelectMethod: true,
  autoSubmit: true
});

const ARM_LIFETIME_MS = 5 * 60 * 1000;
// Tenant path visible in the reported Purdue Microsoft-hosted login.
const PURDUE_TENANT = "4130bd39-7c53-419c-b1e5-8758d6d63f21";
const passwordRequests = new Set();
let messageQueue = Promise.resolve();

function enqueue(task) {
  const result = messageQueue.then(task);
  messageQueue = result.catch(() => {});
  return result;
}

initializeStorageAccess();

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && ["totpSecret", "enabled", "username", "password", "oneClick"].some(key => changes[key])) {
    enqueue(() => chrome.storage.session.clear());
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Serialize state changes so Cancel/settings updates cannot be overwritten
  // by a credential request which was still awaiting storage.
  enqueue(() => handleMessage(message, sender))
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function initializeStorageAccess() {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
    await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  } catch (_) {
    // Older Chromium builds may not support setAccessLevel. The extension still
    // works, but updating the browser is recommended.
  }
}

async function getSettings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
}

function senderHost(sender) {
  try {
    const url = new URL(sender.url || "");
    return url.protocol === "https:" && !url.port && sender.frameId === 0
      ? url.hostname : "";
  } catch (_) {
    return "";
  }
}

function microsoftTenant(sender) {
  try {
    return new URL(sender.url).pathname.split("/")[1].toLowerCase();
  } catch (_) {
    return "";
  }
}

function isPurdueMicrosoftEntry(sender) {
  return senderHost(sender) === "login.microsoftonline.com" &&
    [PURDUE_TENANT, "purdue.edu"].includes(microsoftTenant(sender));
}

function isMicrosoftContinuation(sender) {
  return senderHost(sender) === "login.microsoftonline.com" &&
    [PURDUE_TENANT, "purdue.edu", "common", "organizations"].includes(microsoftTenant(sender));
}

function armKey(tabId) {
  return `armedLogin:${tabId}`;
}

function normalizedAccount(value) {
  const account = String(value || "").trim().toLowerCase();
  return account && !account.includes("@") ? `${account}@purdue.edu` : account;
}

async function getArmState(tabId) {
  const key = armKey(tabId);
  const { [key]: armedLogin } = await chrome.storage.session.get(key);
  if (!armedLogin || armedLogin.expiresAt <= Date.now()) {
    if (armedLogin) {
      await chrome.storage.session.remove(key);
    }
    return null;
  }
  return armedLogin;
}

async function handleMessage(message, sender) {
  const type = message && message.type;
  const host = senderHost(sender);
  const tabId = sender.tab && sender.tab.id;

  if (type === "getExtensionStatus") {
    const settings = await getSettings();
    return {
      ok: true,
      configured: Boolean(settings.totpSecret),
      enabled: settings.enabled,
      oneClick: settings.oneClick,
      passwordSaved: Boolean(settings.password)
    };
  }

  if (type === "openOptions") {
    await chrome.runtime.openOptionsPage();
    return { ok: true };
  }

  if (type === "getPurdueSettings") {
    if (host !== "sso.purdue.edu") {
      throw new Error("request rejected outside Purdue SSO");
    }
    const settings = await getSettings();
    return {
      ok: true,
      enabled: settings.enabled,
      configured: Boolean(settings.totpSecret),
      username: settings.username,
      oneClick: settings.oneClick
    };
  }

  if (type === "armLogin") {
    const existing = Number.isInteger(tabId) ? await getArmState(tabId) : null;
    if (!Number.isInteger(tabId) || !(host === "sso.purdue.edu" ||
        isPurdueMicrosoftEntry(sender) || (existing && isMicrosoftContinuation(sender)))) {
      throw new Error("start from the Purdue Microsoft sign-in page or Purdue SSO");
    }
    const settings = await getSettings();
    if (!settings.enabled || !settings.totpSecret) {
      throw new Error("configure and enable the extension first");
    }
    const account = normalizedAccount(settings.username);
    if (settings.oneClick && (!settings.password || !/^[^\s@]+@purdue\.edu$/.test(account))) {
      throw new Error("save your Purdue username and password in one-click settings first");
    }
    await chrome.storage.session.set({
      [armKey(tabId)]: {
        tabId,
        account,
        oneClick: Boolean(settings.oneClick),
        passwordIssued: false,
        mfaDone: false,
        startedAt: Date.now(),
        expiresAt: Date.now() + ARM_LIFETIME_MS
      }
    });
    return { ok: true };
  }

  if (type === "getMicrosoftState") {
    if (!isMicrosoftContinuation(sender) || !Number.isInteger(tabId)) {
      if (Number.isInteger(tabId)) await chrome.storage.session.remove(armKey(tabId));
      return { ok: true, armed: false };
    }
    const settings = await getSettings();
    const armed = await getArmState(tabId);
    return {
      ok: true,
      allowed: true,
      canStart: isPurdueMicrosoftEntry(sender),
      enabled: settings.enabled,
      configured: Boolean(settings.totpSecret),
      username: settings.username,
      armed: Boolean(settings.enabled && armed && !armed.mfaDone),
      finishing: Boolean(settings.enabled && armed?.oneClick && armed.mfaDone),
      oneClick: Boolean(armed ? armed.oneClick && settings.oneClick : settings.oneClick),
      passwordIssued: Boolean(armed?.passwordIssued),
      autoSelectMethod: Boolean(armed?.oneClick || settings.autoSelectMethod),
      autoSubmit: Boolean(armed?.oneClick || settings.autoSubmit)
    };
  }

  if (type === "getPassword") {
    if (!Number.isInteger(tabId) || !(isMicrosoftContinuation(sender) || host === "sso.purdue.edu")) {
      throw new Error("password request rejected outside the supported sign-in pages");
    }
    if (passwordRequests.has(tabId)) throw new Error("password request already in progress");
    passwordRequests.add(tabId);
    try {
      const armed = await getArmState(tabId);
      const settings = await getSettings();
      if (!armed || armed.mfaDone || !armed.oneClick || !settings.oneClick || !settings.enabled || !settings.password) {
        throw new Error("one-click login is not active for this tab");
      }
      if (armed.passwordIssued) throw new Error("password already used; start a new login to retry");
      const account = normalizedAccount(message.account);
      if (!account || account !== armed.account || account !== normalizedAccount(settings.username)) {
        throw new Error("account does not match the saved password");
      }
      // Persist the one-attempt limit across navigation and worker restarts.
      await chrome.storage.session.set({ [armKey(tabId)]: { ...armed, passwordIssued: true } });
      return { ok: true, password: settings.password };
    } finally {
      passwordRequests.delete(tabId);
    }
  }

  if (type === "getTotp") {
    if (!isMicrosoftContinuation(sender) || !Number.isInteger(tabId)) {
      throw new Error("code request rejected outside Microsoft sign-in");
    }
    const armed = await getArmState(tabId);
    if (!armed || armed.mfaDone) {
      throw new Error("this login is not armed or has expired");
    }
    const settings = await getSettings();
    if (!settings.enabled || !settings.totpSecret) {
      throw new Error("TOTP is not configured");
    }
    const now = Date.now();
    return {
      ok: true,
      code: await PurdueTotp.generate(settings.totpSecret, now),
      secondsRemaining: PurdueTotp.secondsRemaining(now),
      step: Math.floor(now / 30000),
      autoSubmit: settings.autoSubmit
    };
  }

  if (type === "completeLogin" || type === "cancelLogin" || type === "finishLogin") {
    if ((host === "login.microsoftonline.com" || host === "sso.purdue.edu") && Number.isInteger(tabId)) {
      const armed = await getArmState(tabId);
      if (armed) {
        if (type === "completeLogin" && armed.oneClick) {
          // No further credential access. Retain only a short continuation for
          // an optional 'Stay signed in?' screen; never accept app consent.
          await chrome.storage.session.set({ [armKey(tabId)]: {
            ...armed, mfaDone: true, expiresAt: Math.min(armed.expiresAt, Date.now() + 60000)
          } });
        } else {
          await chrome.storage.session.remove(armKey(tabId));
        }
      }
    }
    return { ok: true };
  }

  throw new Error("unknown request");
}
