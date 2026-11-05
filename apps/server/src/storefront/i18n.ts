import type { UserError } from '@shopme/shopify-compat';

/** Messages the server itself puts into `form.errors` (the theme translates its own labels with locale files). English and French. */
const MESSAGES = {
  en: {
    login_failed: 'Incorrect email or password.', rate_limited: 'Too many attempts. Please try again later.', token_invalid: 'This link is invalid or has expired.', form_invalid: 'Please check the form and try again.',
    BLANK: "{field} can't be blank", INVALID: '{field} is invalid', TAKEN: 'This email address is already associated with an account. If this account is yours, you can reset your password.',
    TOO_SHORT: 'Password is too short (minimum is 8 characters)', TOO_LONG: '{field} is too long', CONFIRMATION: "Password confirmation doesn't match", INVALID_TOKEN: 'This link is invalid or has expired.', NOT_FOUND: 'Not found',
    email: 'Email', password: 'Password', password_confirmation: 'Password confirmation', address1: 'Address', city: 'City', country: 'Country', body: 'Message',
  },
  fr: {
    login_failed: 'E-mail ou mot de passe incorrect.', rate_limited: 'Trop de tentatives. Veuillez réessayer plus tard.', token_invalid: "Ce lien n'est pas valide ou a expiré.", form_invalid: 'Veuillez vérifier le formulaire et réessayer.',
    BLANK: '{field} ne peut pas être vide', INVALID: '{field} est invalide', TAKEN: 'Cette adresse e-mail est déjà associée à un compte. Si ce compte est le vôtre, vous pouvez réinitialiser votre mot de passe.',
    TOO_SHORT: 'Le mot de passe est trop court (8 caractères minimum)', TOO_LONG: '{field} est trop long', CONFIRMATION: 'La confirmation ne correspond pas au mot de passe', INVALID_TOKEN: "Ce lien n'est pas valide ou a expiré.", NOT_FOUND: 'Introuvable',
    email: 'E-mail', password: 'Mot de passe', password_confirmation: 'Confirmation du mot de passe', address1: 'Adresse', city: 'Ville', country: 'Pays', body: 'Message',
  },
} as const;

type Key = keyof (typeof MESSAGES)['en'];

export function messages(locale: string) {
  const d: Record<string, string> = MESSAGES[locale.slice(0, 2).toLowerCase() as 'en' | 'fr'] ?? MESSAGES.en;
  const t = (key: Key | string, vars: Record<string, string> = {}) => (d[key] ?? (MESSAGES.en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_m, v: string) => vars[v] ?? '');
  /** Service errors -> `{ field: message }` for `form.errors.messages`. */
  const fieldErrors = (errors: UserError[]): Record<string, string> => Object.fromEntries(errors.map((e) => {
    const field = e.field?.at(-1) ?? 'form';
    return [field, e.code && (e.code in d) ? t(e.code, { field: t(field) === field ? field.replace(/_/g, ' ') : t(field) }) : e.message];
  }));
  return { t, fieldErrors };
}
