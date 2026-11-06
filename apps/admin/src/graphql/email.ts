// Settings > E-mails: sending settings, DNS records, checks, test e-mail.
export const EMAIL_SETTINGS = `query EmailSettings { shopmeEmailSettings }`;
export const EMAIL_RECORDS = `query EmailRecords { shopmeEmailRecords }`;
export const EMAIL_OUTBOX = `query EmailOutbox($first: Int) { shopmeEmailOutbox(first: $first) }`;
export const EMAIL_HEALTH = `query EmailHealth { shopmeEmailHealth }`;
export const EMAIL_SETTINGS_UPDATE = `mutation EmailSettingsUpdate($input: ShopmeEmailInput!) { shopmeEmailSettingsUpdate(input: $input) { settings userErrors { field message } } }`;
export const EMAIL_CHECK = `mutation EmailCheck { shopmeEmailCheck { check userErrors { field message } } }`;
export const EMAIL_DKIM_ROTATE = `mutation EmailDkimRotate { shopmeEmailDkimRotate { records userErrors { field message } } }`;
export const EMAIL_DKIM_ACTIVATE = `mutation EmailDkimActivate { shopmeEmailDkimActivate { records userErrors { field message } } }`;
export const EMAIL_SEND_TEST = `mutation EmailSendTest($to: String!) { shopmeEmailSendTest(to: $to) { result userErrors { field message } } }`;
