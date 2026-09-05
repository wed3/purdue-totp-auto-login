(function () {
  "use strict";

  const BUTTON_ID = "purdue-totp-auto-login-button";
  const STATUS_ID = "purdue-totp-auto-login-status";

  initialize();

  async function initialize() {
    const settings = await send({ type: "getPurdueSettings" });
    if (!settings.ok || !settings.enabled) {
      return;
    }

    const loginButton = await waitFor(findLoginButton, 10000);
    if (!loginButton || document.getElementById(BUTTON_ID)) {
      return;
    }

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "Auto log in";
    button.className = loginButton.className;
    button.style.marginBottom = "5px";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.setAttribute("role", "status");
    status.style.fontSize = "0.875rem";
    status.style.margin = "0.35rem 0";

    const container = document.createElement("div");
    container.append(button, status);
    loginButton.parentElement.insertAdjacentElement("beforebegin", container);

    if (!settings.configured) {
      setStatus("TOTP setup is required. Click to open extension settings.", true);
    }

    button.addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      button.disabled = true;
      try {
        const settings = await send({ type: "getPurdueSettings" });
        if (!settings.configured) {
          await send({ type: "openOptions" });
          return;
        }

        const usernameInput = document.querySelector(
          '#username, input[name="username"], input[autocomplete="username"]'
        );
        const passwordInput = document.querySelector(
          '#password, input[name="password"], input[type="password"]'
        );

        if (usernameInput && !usernameInput.value && settings.username) {
          setInputValue(usernameInput, settings.username);
        }

        const account = value => {
          const name = String(value || "").trim().toLowerCase();
          return name && !name.includes("@") ? name + "@purdue.edu" : name;
        };
        if (settings.oneClick && usernameInput && account(usernameInput.value) !== account(settings.username)) {
          throw new Error("This account differs from your saved username. Auto-login stopped.");
        }

        if (!settings.oneClick && passwordInput && !passwordInput.value) {
          setStatus("Enter or autofill your password, then click Auto log in again.", true);
          passwordInput.focus();
          return;
        }

        const result = await send({ type: "armLogin" });
        if (!result.ok) {
          throw new Error(result.error || "could not start auto-login");
        }

        if (settings.oneClick && passwordInput) {
          const credentials = await send({ type: "getPassword", account: settings.username });
          if (!credentials.ok) throw new Error(credentials.error || "Saved password unavailable.");
          if (!passwordInput.isConnected || !loginButton.isConnected) return;
          setInputValue(passwordInput, credentials.password);
        }

        setStatus("Auto-login armed for this tab.");
        loginButton.click();
      } catch (error) {
        await send({ type: "cancelLogin" }).catch(() => {});
        setStatus(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  }

  function findLoginButton() {
    return (
      document.querySelector('button[value="Login"]') ||
      document.querySelector('button[type="submit"]') ||
      document.querySelector('input[type="submit"]')
    );
  }

  function setStatus(message, isError = false) {
    const status = document.getElementById(STATUS_ID);
    if (status) {
      status.textContent = message;
      status.style.color = isError ? "#9b1c1c" : "#155724";
    }
  }

  function setInputValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    );
    descriptor.set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function waitFor(getter, timeoutMs) {
    return new Promise((resolve) => {
      const immediate = getter();
      if (immediate) {
        resolve(immediate);
        return;
      }

      const observer = new MutationObserver(() => {
        const value = getter();
        if (value) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(value);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      const timeout = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  function send(message) {
    return chrome.runtime.sendMessage(message);
  }
})();
