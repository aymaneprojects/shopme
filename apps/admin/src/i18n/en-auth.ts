// Sign-in screens (AuthShell), email code, passkeys, password reset, store setup and "Add users".
export const enAuth = {
  'auth.language': 'Language', 'auth.help': 'Need help?',
  'auth.footer': 'ShopMe is free, open-source software that runs on your own server.', 'auth.terms': 'Terms', 'auth.privacy': 'Privacy policy',

  'login.title': 'Log in', 'login.subtitle': 'Continue to ShopMe', 'login.continueEmail': 'Continue with email', 'login.or': 'or',
  'login.passkey': 'Log in with a passkey', 'login.lastUsed': 'Last used', 'login.newTo': 'New to ShopMe?', 'login.start': 'Get started',
  'login.change': 'Change', 'login.forgot': 'Forgot your password?',
  'login.passkeyFailed': 'The passkey could not be used. Try again, or log in with your password.',
  'login.passkeyRequired': 'This account must log in with a passkey or two-step verification.',
  'login.emailCode.title': 'Verify your email to continue', 'login.emailCode.subtitle': 'As a security measure, enter the 6-digit code sent to {email}',
  'login.emailCode.digit': 'Digit {n}', 'login.emailCode.resend': 'Resend code', 'login.emailCode.resendIn': 'Resend code in {s} s', 'login.emailCode.verify': 'Verify',
  'login.emailCode.usePasskey': 'Use a passkey instead', 'login.emailCode.trust': 'Do not ask again on this device for 90 days',
  'login.emailCode.invalid': 'This code is not right.', 'login.emailCode.expired': 'This code expired. Request a new one.',
  'login.emailCode.locked': 'Too many wrong codes. Request a new one.', 'login.emailCode.sent': 'A new code is on its way.',
  'login.emailCode.resendLimit': 'Too many codes requested. Try again later.',

  'forgot.title': 'Reset your password', 'forgot.subtitle': 'Enter your email address and we will send you a code.', 'forgot.send': 'Send the code',
  'forgot.sent': 'If an account uses {email}, a 6-digit code is on its way.', 'forgot.newPassword': 'New password', 'forgot.submit': 'Reset password',
  'forgot.done': 'Your password was changed. You can log in now.', 'forgot.invalid': 'This code is not valid or has expired.', 'forgot.back': 'Back to log in',

  'setup.title': 'Create your store', 'setup.subtitle': 'Free and open source, on your own server', 'setup.step': 'Step {n} of {total}',
  'setup.accountTitle': 'Your account', 'setup.storeTitle': 'Your store', 'setup.next': 'Continue', 'setup.back': 'Back',
  'invite.codeHelp': 'This account uses two-step verification. Enter a code from your authenticator app to join.',
  'ms.create.subtitle': 'Free and open source: name it, choose a theme and it is ready in a minute.',

  'security.passkeys': 'Passkeys', 'security.passkeysHelp': 'Sign in with your fingerprint, face or screen lock instead of a password. A passkey also replaces the email code and two-step verification, because it cannot be phished.',
  'security.passkeyAdd': 'Add a passkey', 'security.passkeyName': 'Name', 'security.passkeyNamePlaceholder': 'My laptop', 'security.passkeyPassword': 'Confirm your password',
  'security.passkeyNone': 'No passkey yet.', 'security.passkeyAdded': 'Passkey added', 'security.passkeyDeleted': 'Passkey deleted', 'security.passkeyDelete': 'Delete passkey {name}',
  'security.passkeyCreated': 'Added {date}', 'security.passkeyLastUsed': 'Last used {date}', 'security.passkeyNever': 'Never used', 'security.passkeySynced': 'Synced',
  'security.passkeyUnsupported': 'This browser, or this address, cannot create passkeys.',
  'security.secureRequired': 'Your administrator requires a secure sign-in method. Add a passkey or turn on two-step verification to continue.',

  'users.add.title': 'Add users', 'users.add.info': 'User information', 'users.add.emails': 'Emails', 'users.add.emailsHelp': 'Type or paste several addresses, separated by commas, spaces or new lines.',
  'users.add.submit': 'Add', 'users.add.secure': 'Secure sign-in method',
  'users.add.secureHelp': 'Requires a secure sign-in method, such as a passkey or two-step verification, for these users to log in. They set it up the first time they sign in.',
  'users.add.roles': 'Roles', 'users.add.rolesHelp': 'Assign roles to define what the user can do.', 'users.add.assign': 'Assign', 'users.add.pick': 'Choose a role',
  'users.add.remove': 'Remove {email}', 'users.add.sent': '{n} invitations sent', 'users.add.sent.one': '1 invitation sent', 'users.add.failed': 'Not invited: {list}', 'users.add.back': 'Users',
  'users.add.invalid': '{email} is not a valid address',
  'notif.tpl.login_code.name': 'Sign-in verification code', 'notif.tpl.login_code.desc': 'Sent to confirm a sign-in from a new device',
  'notif.tpl.password_reset_code.name': 'Password reset code', 'notif.tpl.password_reset_code.desc': 'Sent when someone asks to reset their password',
} as const;
