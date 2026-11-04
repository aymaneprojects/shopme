const EN = {
  title: 'Checkout', contact: 'Contact', email: 'Email', marketing: 'Email me with news and offers', delivery: 'Delivery', billingAddress: 'Billing address',
  country: 'Country/region', firstName: 'First name', lastName: 'Last name', company: 'Company (optional)', address1: 'Address', address2: 'Apartment, suite, etc. (optional)',
  city: 'City', province: 'State/province', zip: 'Postal code', phone: 'Phone (optional)', shippingMethod: 'Shipping method',
  shippingEnter: 'Enter your shipping address to see the available shipping methods.', shippingNone: 'No shipping method is available for this address.',
  free: 'Free', payment: 'Payment', noPayment: 'Nothing to pay for this order.', noMethods: 'No payment method is available. Please contact the store.',
  bank_transfer: 'Bank transfer', bank_transfer_hint: 'Your order is placed now. Pay by bank transfer using the details below; we ship once the payment arrives.',
  bank_transfer_after: 'The bank details are shown after you place the order.', cod: 'Cash on delivery', cod_hint: 'Pay in cash when your order is delivered.',
  stripe: 'Credit card', stripe_hint: 'Secure payment by Stripe. Your card details never touch this store.',
  payNow: 'Pay now', placeOrder: 'Place order', processing: 'Processing...', returnToCart: 'Return to cart',
  orderSummary: 'Order summary', showSummary: 'Show order summary', hideSummary: 'Hide order summary', qty: 'Quantity', subtotal: 'Subtotal', shipping: 'Shipping', shippingTbd: 'Calculated at the next step',
  taxes: 'Taxes', includedTaxes: 'Including taxes of', discount: 'Discount', total: 'Total', discountCode: 'Discount code', apply: 'Apply', remove: 'Remove',
  discountApplied: 'Discount applied', emptyCart: 'Your cart is empty.', continueShopping: 'Continue shopping',
  err_email: 'Enter a valid email address.', err_address: 'Please complete the address: {fields}.', err_shipping_method: 'Choose a shipping method.', err_payment_method: 'Choose a payment method.',
  err_stock: 'Some items are no longer available in the quantity requested: {items}. Update your cart to continue.', err_discount: 'The discount code can no longer be used. Remove it to continue.',
  err_completed: 'This checkout was already completed.', err_empty: 'Your cart is empty.', err_generic: 'Something went wrong. Please try again.', err_payment: 'The payment could not be started. Please try again.',
  d_not_found: 'This discount code does not exist.', d_disabled: 'This discount code is not active.', d_not_started: 'This discount code is not valid yet.', d_expired: 'This discount code has expired.',
  d_usage_limit: 'This discount code has reached its usage limit.', d_minimum_subtotal: 'Your order does not reach the minimum amount for this code.', d_minimum_quantity: 'Your order does not reach the minimum quantity for this code.',
  d_already_used: 'You have already used this discount code.', d_not_applicable: 'This discount code does not apply to the items in your cart.', d_invalid_email: 'Enter a valid email address.',
  thankYou: 'Thank you, {name}!', orderNumber: 'Order {name}', confirmed: 'Your order is confirmed', confirmedPending: 'We received your order', emailSent: 'A confirmation email is on its way to {email}.',
  paymentProcessing: 'Your payment is being processed. You will receive a confirmation as soon as it completes.', bankDetails: 'Bank transfer instructions', bankDetailsMissing: 'The store will send you the bank details by email.',
  codNote: 'You will pay in cash on delivery.', shipTo: 'Shipping address', paymentMethod: 'Payment method', paid: 'Paid', pending: 'Awaiting payment', backToShop: 'Continue shopping', notFound: 'Checkout not found', notFoundText: 'This checkout link is not valid.',
  fields: { firstName: 'First name', lastName: 'Last name', address1: 'Address', city: 'City', zip: 'Postal code', countryCode: 'Country' },
};
type Dict = typeof EN;
const FR: Dict = {
  title: 'Paiement', contact: 'Contact', email: 'E-mail', marketing: 'Recevoir les actualités et offres par e-mail', delivery: 'Livraison', billingAddress: 'Adresse de facturation',
  country: 'Pays/région', firstName: 'Prénom', lastName: 'Nom', company: 'Société (facultatif)', address1: 'Adresse', address2: 'Appartement, bâtiment, etc. (facultatif)',
  city: 'Ville', province: 'État/province', zip: 'Code postal', phone: 'Téléphone (facultatif)', shippingMethod: 'Mode de livraison',
  shippingEnter: 'Saisissez votre adresse de livraison pour voir les modes de livraison disponibles.', shippingNone: "Aucun mode de livraison n'est disponible pour cette adresse.",
  free: 'Gratuit', payment: 'Paiement', noPayment: 'Rien à payer pour cette commande.', noMethods: "Aucun moyen de paiement n'est disponible. Veuillez contacter la boutique.",
  bank_transfer: 'Virement bancaire', bank_transfer_hint: "Votre commande est enregistrée maintenant. Payez par virement avec les coordonnées ci-dessous ; nous expédions à réception du paiement.",
  bank_transfer_after: 'Les coordonnées bancaires sont affichées après la validation de la commande.', cod: 'Paiement à la livraison', cod_hint: 'Payez en espèces à la livraison de votre commande.',
  stripe: 'Carte bancaire', stripe_hint: 'Paiement sécurisé par Stripe. Vos données de carte ne transitent jamais par cette boutique.',
  payNow: 'Payer maintenant', placeOrder: 'Valider la commande', processing: 'Traitement...', returnToCart: 'Retour au panier',
  orderSummary: 'Récapitulatif de la commande', showSummary: 'Afficher le récapitulatif', hideSummary: 'Masquer le récapitulatif', qty: 'Quantité', subtotal: 'Sous-total', shipping: 'Livraison', shippingTbd: "Calculée à l'étape suivante",
  taxes: 'Taxes', includedTaxes: 'Dont taxes', discount: 'Réduction', total: 'Total', discountCode: 'Code de réduction', apply: 'Appliquer', remove: 'Retirer',
  discountApplied: 'Réduction appliquée', emptyCart: 'Votre panier est vide.', continueShopping: 'Continuer mes achats',
  err_email: 'Saisissez une adresse e-mail valide.', err_address: "Veuillez compléter l'adresse : {fields}.", err_shipping_method: 'Choisissez un mode de livraison.', err_payment_method: 'Choisissez un moyen de paiement.',
  err_stock: 'Certains articles ne sont plus disponibles dans la quantité demandée : {items}. Modifiez votre panier pour continuer.', err_discount: 'Le code de réduction ne peut plus être utilisé. Retirez-le pour continuer.',
  err_completed: 'Cette commande a déjà été validée.', err_empty: 'Votre panier est vide.', err_generic: 'Une erreur est survenue. Veuillez réessayer.', err_payment: "Le paiement n'a pas pu être démarré. Veuillez réessayer.",
  d_not_found: "Ce code de réduction n'existe pas.", d_disabled: "Ce code de réduction n'est pas actif.", d_not_started: "Ce code de réduction n'est pas encore valable.", d_expired: 'Ce code de réduction a expiré.',
  d_usage_limit: "Ce code de réduction a atteint sa limite d'utilisation.", d_minimum_subtotal: "Votre commande n'atteint pas le montant minimum pour ce code.", d_minimum_quantity: "Votre commande n'atteint pas la quantité minimum pour ce code.",
  d_already_used: 'Vous avez déjà utilisé ce code de réduction.', d_not_applicable: "Ce code ne s'applique pas aux articles de votre panier.", d_invalid_email: 'Saisissez une adresse e-mail valide.',
  thankYou: 'Merci, {name} !', orderNumber: 'Commande {name}', confirmed: 'Votre commande est confirmée', confirmedPending: 'Nous avons bien reçu votre commande', emailSent: 'Un e-mail de confirmation vous est envoyé à {email}.',
  paymentProcessing: 'Votre paiement est en cours de traitement. Vous recevrez une confirmation dès qu’il sera terminé.', bankDetails: 'Instructions de virement', bankDetailsMissing: 'La boutique vous enverra les coordonnées bancaires par e-mail.',
  codNote: 'Vous paierez en espèces à la livraison.', shipTo: 'Adresse de livraison', paymentMethod: 'Moyen de paiement', paid: 'Payé', pending: 'En attente de paiement', backToShop: 'Continuer mes achats', notFound: 'Paiement introuvable', notFoundText: "Ce lien de paiement n'est pas valide.",
  fields: { firstName: 'Prénom', lastName: 'Nom', address1: 'Adresse', city: 'Ville', zip: 'Code postal', countryCode: 'Pays' },
};

export type Strings = Dict;
export type T = (key: Exclude<keyof Dict, 'fields'>, vars?: Record<string, string | number>) => string;

export function translator(locale: string): { t: T; s: Strings; lang: string } {
  const lang = locale.slice(0, 2).toLowerCase() === 'fr' ? 'fr' : 'en';
  const s = lang === 'fr' ? FR : EN;
  const t: T = (key, vars = {}) => String(s[key]).replace(/\{(\w+)\}/g, (_m, v: string) => String(vars[v] ?? ''));
  return { t, s, lang };
}
