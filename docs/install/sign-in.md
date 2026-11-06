# Signing in: passkeys, e-mail codes and secure sign-in

The admin login is e-mail first: the e-mail, then the password. This page explains the extra ways in and the extra checks.

## Passkeys

A passkey lets a person sign in with a fingerprint, a face scan or the screen lock of their device, with no password. ShopMe uses WebAuthn discoverable credentials ([`@simplewebauthn/server`](https://simplewebauthn.dev) and `@simplewebauthn/browser`, MIT).

- **Add one:** Settings > Users > Security > Passkeys > "Add a passkey". The account password is asked again first, because a passkey is a way in that skips the other checks. Up to 10 passkeys per account. They can be listed and deleted from the same page.
- **Use one:** "Log in with a passkey" on the login page. No e-mail needs to be typed.
- **"Last used" badge:** the button shows a "Last used" badge when that browser last signed in with a passkey. It is remembered in the browser's `localStorage` only.
- **A passkey replaces every other check.** It is phishing-resistant (the browser only offers it on the real site) and user-verified (PIN, fingerprint or face), so a passkey sign-in skips the e-mail code and two-step verification.
- **Where it works:** the passkey is bound to the admin host (the relying party ID). Single-store: the host of `APP_URL`. Multi-store: the first host of `ADMIN_HOST`. Origins are checked against `APP_URL` (and, in multi-store mode, the hosts of `ADMIN_HOST`, plus `TRUSTED_ORIGINS` entries on the same host). Changing the admin host later means passkeys must be added again; passwords keep working. Passkeys need HTTPS (or `localhost`). The button is hidden when the browser does not support passkeys or the page is on another host.
- **Data:** table `account_passkeys` (migration `0032`): credential ID, public key, counter, transports and a name. No secret leaves the device.

There are no new environment variables: passkeys use `APP_URL` and `ADMIN_HOST`.

## E-mail code on a new device

After the password, a device this account has not used before must confirm a 6-digit code mailed to the account:

- the code is random, stored hashed, valid 10 minutes and single use; 5 wrong tries kill it (ask for a new one);
- "Resend code" has a 30 second cooldown and is limited to 5 codes per 15 minutes;
- after a correct code, a signed cookie (`shopme_td_<account id>`, 90 days) marks the browser as trusted for that account. Changing the password makes every trusted browser ask again;
- an account with an authenticator app (two-step verification) keeps that step instead; a passkey sign-in skips both.

**This step only exists where e-mail can be delivered.** The code is asked only when the installation's e-mail health (Settings > E-mails, the same status that drives the banner) is "ok" for the store being opened. On a fresh install, in the desktop app (no e-mail), or while sending is broken, people sign in with the password alone, so nobody is locked out. If the mail cannot be handed to the mailer at sign-in time, the step is skipped too.

The mail is the "Sign-in verification code" notification (Settings > Notifications), in English and French.

## Forgotten password

"Forgot your password?" (offered only where e-mail can be delivered) mails a 6-digit code (the "Password reset code" notification). With the code the person chooses a new password; all their sessions are signed out. The answer never says whether an address has an account.

## Secure sign-in method for invited users

Settings > Users > "Add users" has a "Secure sign-in method" switch. For users invited with it on:

- they can use the admin only after they set up a passkey or two-step verification (the first sign-in opens the Security page);
- once they have a passkey but no authenticator app, a password sign-in is refused: they must use the passkey (or turn on two-step verification);
- with two-step verification, the usual code step applies.

## Joining another store with an existing account (multi-store)

Accepting an invitation with an account that already exists asks for its password **and** its two-step verification code when it has one. Wrong passwords and codes are rate limited like a normal sign-in (10 failures per 15 minutes per address and per invitation).

## Footer links

The sign-in screens show "Need help?" (the ShopMe docs on GitHub by default) and, when set, terms and privacy links. The platform owner can set them with `PUT /admin/api/platform/settings` (`helpUrl`, `termsUrl`, `privacyUrl`, https URLs; an empty string clears one).

## Not supported

Sign-in with Google or Apple is not supported: accounts are local to your installation.
