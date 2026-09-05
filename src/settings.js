(function (scope) {
  "use strict";
  function account(value) {
    const name = String(value || "").trim().toLowerCase();
    return name && !name.includes("@") ? name + "@purdue.edu" : name;
  }
  function build(input, current = {}) {
    const oneClick = Boolean(input.oneClick);
    const username = String(input.username || "").trim();
    let password = "";
    if (oneClick) {
      if (!/^[^\s@]+@purdue\.edu$/.test(account(username))) {
        throw new Error("One-click mode requires your Purdue username or email.");
      }
      const sameAccount = account(username) === account(current.username);
      password = input.password || (sameAccount ? current.password : "") || "";
      if (!password) throw new Error("Enter your password to enable one-click mode (or after changing username).");
    }
    return {
      username, oneClick, password,
      totpSecret: scope.PurdueTotp.normalizeBase32(input.totpSecret),
      enabled: Boolean(input.enabled),
      autoSelectMethod: Boolean(input.autoSelectMethod),
      autoSubmit: Boolean(input.autoSubmit)
    };
  }
  scope.PurdueSettings = Object.freeze({ build });
})(globalThis);
