"use strict";

const state = document.getElementById("state");

chrome.runtime.sendMessage({ type: "getExtensionStatus" }).then((result) => {
  if (!result.ok || !result.configured) {
    state.textContent = "Setup required";
    state.className = "problem";
  } else if (!result.enabled) {
    state.textContent = "Configured, but disabled";
    state.className = "problem";
  } else {
    state.textContent = result.oneClick ? "One-click mode enabled" : "MFA-only mode enabled";
    state.className = "ready";
  }
});

document.getElementById("settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
