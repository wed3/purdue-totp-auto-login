"use strict";

const form = document.getElementById("settings");
const username = document.getElementById("username");
const secret = document.getElementById("totpSecret");
const enabled = document.getElementById("enabled");
const autoSelectMethod = document.getElementById("autoSelectMethod");
const autoSubmit = document.getElementById("autoSubmit");
const status = document.getElementById("status");
const currentCode = document.getElementById("currentCode");
const countdown = document.getElementById("countdown");
const oneClick = document.getElementById("oneClick");
const password = document.getElementById("savedPassword");
const passwordStatus = document.getElementById("passwordStatus");
const secretState = document.getElementById("secretState");
let storedSecret = "";
let passwordSaved = false;
let codeRequest = 0;

load();
window.setInterval(updateCode, 1000);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const current = await chrome.storage.local.get({ username: "", password: "" });
    const settings = PurdueSettings.build({
      username: username.value.trim(),
      totpSecret: secret.value,
      oneClick: oneClick.checked,
      password: password.value,
      enabled: enabled.checked,
      autoSelectMethod: autoSelectMethod.checked,
      autoSubmit: autoSubmit.checked
    }, current);
    await PurdueTotp.generate(settings.totpSecret);
    await chrome.storage.local.set(settings);
    storedSecret = settings.totpSecret;
    secret.value = storedSecret;
    passwordSaved = Boolean(settings.password);
    password.value = "";
    refreshPasswordState();
    showStatus(settings.oneClick ? "Saved. One-click mode enabled; click Auto log in on the sign-in page." : "Settings saved. Password entry remains manual.", false);
    updateCode();
  } catch (error) {
    showStatus(error.message, true);
  }
});

document.getElementById("toggleSecret").addEventListener("click", (event) => {
  const reveal = secret.type === "password";
  secret.type = reveal ? "text" : "password";
  event.currentTarget.textContent = reveal ? "Hide" : "Show";
});

document.getElementById("clearSecret").addEventListener("click", async () => {
  if (!window.confirm("Clear the stored TOTP secret? Auto-login will stop working.")) {
    return;
  }
  await chrome.storage.local.remove("totpSecret");
  storedSecret = "";
  secret.value = "";
  currentCode.textContent = "------";
  countdown.textContent = "--s";
  showStatus("Stored secret cleared.", false);
  updateCode();
});

secret.addEventListener("input", updateCode);
oneClick.addEventListener("change", refreshPasswordState);
document.getElementById("clearPassword").addEventListener("click", async () => {
  if (!window.confirm("Forget the saved password and disable one-click mode? Your MFA secret will be kept.")) return;
  await chrome.storage.local.set({ password: "", oneClick: false });
  password.value = "";
  passwordSaved = false;
  oneClick.checked = false;
  refreshPasswordState();
  showStatus("Saved password removed. Existing MFA setup kept.", false);
});

async function load() {
  const settings = await chrome.storage.local.get({
    username: "",
    oneClick: false,
    password: "",
    totpSecret: "",
    enabled: true,
    autoSelectMethod: true,
    autoSubmit: true
  });
  username.value = settings.username;
  secret.value = settings.totpSecret;
  storedSecret = settings.totpSecret;
  oneClick.checked = settings.oneClick;
  passwordSaved = Boolean(settings.password);
  refreshPasswordState();
  enabled.checked = settings.enabled;
  autoSelectMethod.checked = settings.autoSelectMethod;
  autoSubmit.checked = settings.autoSubmit;
  updateCode();
}

async function updateCode() {
  const request = ++codeRequest;
  try {
    if (!secret.value.trim()) {
      currentCode.textContent = "------";
      countdown.textContent = "--s";
      secretState.textContent = storedSecret ? "Unsaved change: the stored key has not been cleared." : "No key saved.";
      return;
    }
    const normalized = PurdueTotp.normalizeBase32(secret.value);
    secretState.textContent = normalized === storedSecret ? "Preview matches the saved key." : "Unsaved key: click Save settings before using auto-login.";
    const now = Date.now();
    const code = await PurdueTotp.generate(normalized, now);
    if (request !== codeRequest) return;
    currentCode.textContent = code;
    countdown.textContent = `${PurdueTotp.secondsRemaining(now)}s`;
  } catch (_) {
    if (request !== codeRequest) return;
    currentCode.textContent = "invalid";
    countdown.textContent = "--s";
    secretState.textContent = "Invalid key preview; saved settings are unchanged.";
  }
}

function refreshPasswordState() {
  password.disabled = !oneClick.checked;
  password.placeholder = passwordSaved ? "Leave blank to keep saved password" : "Enter your Purdue password";
  passwordStatus.textContent = passwordSaved ? "Password saved locally. It is not displayed here." : "No password saved.";
  autoSelectMethod.disabled = oneClick.checked;
  autoSubmit.disabled = oneClick.checked;
}

function showStatus(message, isError) {
  status.textContent = message;
  status.className = isError ? "error" : "success";
}
