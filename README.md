# Purdue TOTP Auto Login

A Chromium extension that completes Purdue's new Microsoft MFA verification code, with optional **one-click mode**. It does not emulate Microsoft Authenticator or approve push notifications. It makes no separate network requests. It only fills and submits the normal sign-in forms automatically so you don't have to pull your phone out every time.

## What it does

1. Adds an **Auto log in** button to Purdue's Microsoft-hosted sign-in page, including the initial email screen, and to legacy `sso.purdue.edu`.
2. Arms that browser tab for up to five minutes after you press the button.
3. In optional one-click mode, enters your username, chooses **Use your password instead** if shown, fills your saved password, and clicks **Sign in**.
4. Selects the verification-code method, generates the RFC 6238 TOTP locally, and submits it.
5. In one-click mode, chooses **No** if Microsoft asks **Stay signed in?**, without accepting application consent or extra permissions.

The Microsoft step runs only in the same tab where you explicitly started a Purdue login. Ordinary Microsoft sign-ins are left alone.

## Disclaimer
This project was largely vibecoded and as such you will want to audit the code before installing. I have confirmed it to work but you should be sure to double check all functions and workflows yourself before running it. All AI generated code was written by a local LLM running on my own hardware.

## Install in Chrome, Brave, or Edge

1. Extract this archive to a permanent folder.
2. Open the browser's extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
   - Edge: `edge://extensions`
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the folder containing `manifest.json`.
5. The settings page opens automatically.

## Register a Purdue TOTP method

1. Go to <https://mysignins.microsoft.com/security-info> and sign in with your Purdue account.
2. Select **Add sign-in method** and then **Authenticator app**.
3. Select **I want to use a different authenticator app**.
4. Select **Can't scan QR code?** and copy the Base32 secret key.
5. Paste the key into the extension settings and save it.
6. Enter the extension's current test code into Microsoft to finish registration.

Keep Microsoft Authenticator or another recovery method registered until the new code method has been tested.

## Use without storing a password (default)

1. Open a Purdue service. It may go directly to Purdue's tenant on `login.microsoftonline.com`; legacy `sso.purdue.edu` also works.
2. On Microsoft's initial email screen, enter your Purdue email (or save your username in extension settings), then press **Auto log in**.
3. Enter/autofill your password and press Microsoft's normal **Sign in** button. The extension does not read or submit the Microsoft password field.
4. The extension remains active for that tab and handles the authenticator code prompt. **Cancel auto log in** stops activation. On legacy SSO, enter/autofill your password before pressing **Auto log in**.

If Microsoft changes its page markup, try selecting the authenticator verification code method manually. The extension fills only recognized authenticator code prompts; it leaves SMS, email, and unrecognized prompts alone. It submits at most once per activation. A rejected code is not retried automatically. Microsoft can still require a different authentication method under account or application policy.

One-click password submission is likewise limited to one attempt per activation, including page reloads. Wrong password attempts stop automation. Unknown layouts, account pickers, CAPTCHAs, password-change requirements, mandatory enrollment, and application consent screens may still require manual interaction. Do not repeatedly retry a rejected stored password; update it in settings first.

The test-code area now explicitly marks an unsaved key. Enrollment preview uses the editable field; auto-login uses the saved value. Close/reopen settings to check what is actually saved.

## Enable one-click mode

1. Open extension settings. Keep your existing working TOTP secret and do not re-enroll.
2. Enter your Purdue username or email.
3. Check **One-click mode — store my password locally…** and read the warning.
4. Enter your Purdue password in the newly enabled password field and click **Save settings**.
5. Open a Purdue login and click **Auto log in** once, on the email, passwordless notification, password, or MFA screen.

The normal email -> password fallback -> password -> MFA code sequence now proceeds without further clicks when the supported controls appear. No action starts on page load by itself. One-click mode overrides the individual MFA selection/submission switches while enabled. If already signed in enough to skip MFA, it can still dismiss a recognized Stay signed in prompt.

Saved passwords are not displayed when settings reopen. Leaving the password field blank keeps the saved password for the same username. Enter a replacement when your password or username changes. **Forget saved password** immediately removes it and turns off one-click mode; unchecking one-click mode and saving does the same. Your TOTP secret is preserved.

This mode stores both password and MFA seed unencrypted in the same browser profile. Anyone able to read that profile may recover both; this is not equivalent to a hardware authenticator or an encrypted password vault.

## Security model

- The TOTP seed and optional password stay in `chrome.storage.local`. sync is not used.
- Content scripts cannot directly read extension storage on current Chromium builds.
- The seed never enters the Purdue or Microsoft page. The background worker returns current codes only to an explicitly armed, Microsoft sign-in tab.
- The authorization is bound to a tab and expires after five minutes. Credential/settings changes revoke active authorizations.
- The worker releases a saved password only in opt-in one-click mode, after activation, to the matching account on an allowed sign-in page. It releases the password at most once per activation.
- In default manual mode, the Microsoft password field is not read or submitted. The legacy Purdue script checks whether its password field is filled but does not save its value.
- After MFA submission, credential requests are disabled. One-click mode retains at most one minute of continuation to dismiss a recognized Stay signed in prompt with **No**.

The seed is stored **unencrypted** in the browser profile. Keeping a password in a separate password manager on the same device does not restore the separation of factors. a compromised device may expose both. This is a convenience/security tradeoff. Remove the registered authenticator method from Microsoft Security Info if the device is lost or compromised.

## Development check

Run all regression checks, including the RFC 6238 test vectors, with Node.js:

```bash
node --test tests/*.test.js
```

## Official Purdue references

- [How to use Microsoft MFA with Purdue Login](https://service.purdue.edu/TDClient/32/Purdue/KB/PrintArticle?ID=1796)
- [How to obtain and register a Base32 OATH-TOTP secret](https://service.purdue.edu/TDClient/32/Purdue/KB/PrintArticle?ID=2219)

This project is not endorsed by or affiliated with Purdue University or Microsoft.

## License

MIT
