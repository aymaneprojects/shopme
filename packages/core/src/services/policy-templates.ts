import { shopAddressOf } from './settings/shop-settings';
import { configOf } from './settings/config';
import { POLICY_TYPE_KEYS, policiesOf, updatePolicy, type PolicyType } from './legal';
import { returnRulesHtml } from './return-rules';
import type { Executor } from '../db/client';
import type { Shop } from './shops';

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Starting text of each policy, filled with the store's name, contact details and business entity. These are generic templates to
 * edit: they are not legal advice and every merchant should have them reviewed for their country.
 */
export async function policyTemplate(db: Executor, shop: Shop, type: PolicyType): Promise<string> {
  const fr = shop.locale.slice(0, 2).toLowerCase() === 'fr';
  const name = esc(shop.name);
  const a = shopAddressOf(shop);
  const entity = configOf(shop, 'GENERAL').businessEntity;
  const addressLine = [a.address1, a.address2, [a.zip, a.city].filter(Boolean).join(' '), a.countryCode].filter(Boolean).map((x) => esc(String(x))).join(', ');
  const contact = [`<a href="mailto:${esc(shop.email)}">${esc(shop.email)}</a>`, a.phone ? esc(a.phone) : '', addressLine].filter(Boolean).join('<br>');
  const p = (s: string) => `<p>${s}</p>`;
  switch (type) {
    case 'REFUND_POLICY': {
      const rules = await returnRulesHtml(db, shop);
      return fr
        ? `<h2>Politique de remboursement</h2>${p(`Chez ${name}, votre satisfaction compte. Si un article ne vous convient pas, contactez-nous à ${esc(shop.email)} pour organiser un retour.`)}${p('Les articles doivent être retournés dans leur état d’origine. Le remboursement est effectué sur le moyen de paiement utilisé lors de la commande, après réception et contrôle du colis.')}${rules}`
        : `<h2>Refund policy</h2>${p(`At ${name} we want you to be happy with your order. If an item is not right, contact us at ${esc(shop.email)} and we will arrange a return.`)}${p('Items must come back in their original condition. Refunds go to the payment method used for the order once we have received and checked the parcel.')}${rules}`;
    }
    case 'PRIVACY_POLICY':
      return fr
        ? `<h2>Politique de confidentialité</h2>${p(`${name} collecte les données nécessaires pour traiter vos commandes : nom, adresse, e-mail, téléphone et historique d’achat. Elles ne sont jamais vendues.`)}${p('Elles sont partagées uniquement avec nos prestataires de paiement, de livraison et d’hébergement, dans la mesure nécessaire à la commande.')}${p(`Vous pouvez demander l’accès, la rectification ou la suppression de vos données à tout moment en écrivant à ${esc(shop.email)}.`)}`
        : `<h2>Privacy policy</h2>${p(`${name} collects the data needed to process your orders: name, address, email, phone number and purchase history. We never sell it.`)}${p('It is shared only with our payment, shipping and hosting providers, as far as needed to fulfil your order.')}${p(`You can ask to access, correct or delete your data at any time by writing to ${esc(shop.email)}.`)}`;
    case 'TERMS_OF_SERVICE':
      return fr
        ? `<h2>Conditions d’utilisation</h2>${p(`En visitant ${name} et en passant commande, vous acceptez les présentes conditions.`)}${p('Les informations de la boutique (prix, disponibilités, descriptions) peuvent changer sans préavis. Nous nous réservons le droit de refuser ou d’annuler une commande en cas d’erreur manifeste ou de suspicion de fraude.')}${p('Le contenu de la boutique (textes, images, marques) est protégé et ne peut être réutilisé sans autorisation.')}`
        : `<h2>Terms of service</h2>${p(`By visiting ${name} and placing an order you accept these terms.`)}${p('Store information (prices, availability, descriptions) may change without notice. We may refuse or cancel an order in case of an obvious error or suspected fraud.')}${p('The content of the store (text, images, trademarks) is protected and may not be reused without permission.')}`;
    case 'SHIPPING_POLICY':
      return fr
        ? `<h2>Politique d’expédition</h2>${p('Les délais de livraison estimés sont affichés à la caisse pour chaque mode de livraison. Ils courent à partir de l’expédition de la commande.')}${p('Les frais de livraison sont calculés selon la destination, le poids et le montant de la commande. Les droits de douane éventuels sont indiqués avant le paiement lorsqu’ils sont perçus par la boutique.')}${p(`Une question sur votre colis ? Écrivez-nous à ${esc(shop.email)}.`)}`
        : `<h2>Shipping policy</h2>${p('Estimated delivery times are shown at checkout for each delivery method. They start once your order has shipped.')}${p('Shipping costs depend on the destination, weight and order value. Any customs duties are shown before you pay when the store collects them.')}${p(`Questions about your parcel? Write to ${esc(shop.email)}.`)}`;
    case 'CONTACT_INFORMATION':
      return fr ? `<h2>Nous contacter</h2>${p(esc(entity.legalName || shop.name))}${p(contact)}` : `<h2>Contact information</h2>${p(esc(entity.legalName || shop.name))}${p(contact)}`;
    case 'TERMS_OF_SALE':
      return fr
        ? `<h2>Conditions générales de vente</h2>${p(`Les présentes conditions régissent les ventes réalisées par ${esc(entity.legalName || shop.name)}.`)}${p('Les prix sont indiqués dans la devise affichée, taxes comprises ou hors taxes selon la boutique. La commande est ferme après confirmation du paiement.')}${p('Les produits restent la propriété du vendeur jusqu’au paiement complet.')}`
        : `<h2>Terms of sale</h2>${p(`These terms govern sales made by ${esc(entity.legalName || shop.name)}.`)}${p('Prices are shown in the displayed currency, with or without tax depending on the store. An order is binding once payment is confirmed.')}${p('Goods remain the property of the seller until paid in full.')}`;
    case 'LEGAL_NOTICE': {
      const lines = [esc(entity.legalName || shop.name), [entity.address1, entity.address2, [entity.zip, entity.city].filter(Boolean).join(' '), entity.countryCode].filter(Boolean).map(esc).join(', ') || addressLine, entity.taxId ? `${fr ? 'N° de TVA / identifiant fiscal' : 'Tax ID'} : ${esc(entity.taxId)}` : '', `<a href="mailto:${esc(shop.email)}">${esc(shop.email)}</a>`].filter(Boolean);
      return fr ? `<h2>Mentions légales</h2>${p(lines.join('<br>'))}` : `<h2>Legal notice</h2>${p(lines.join('<br>'))}`;
    }
    case 'SUBSCRIPTION_POLICY':
      return fr
        ? `<h2>Résiliation d’abonnement</h2>${p(`Vous pouvez résilier un abonnement à tout moment depuis votre compte ou en écrivant à ${esc(shop.email)}. La résiliation prend effet à la fin de la période déjà payée.`)}`
        : `<h2>Subscription cancellation</h2>${p(`You can cancel a subscription at any time from your account or by writing to ${esc(shop.email)}. Cancellation takes effect at the end of the period already paid.`)}`;
  }
}

/** Fill the policies that are still empty (or all of them with `overwrite`) from the templates. Returns the types written. */
export async function generatePolicies(db: Executor, shop: Shop, types: string[] | null, overwrite: boolean): Promise<PolicyType[]> {
  const wanted = (types?.length ? POLICY_TYPE_KEYS.filter((t) => types.includes(t)) : POLICY_TYPE_KEYS) as PolicyType[];
  const written: PolicyType[] = [];
  let current = shop;
  for (const type of wanted) {
    const existing = policiesOf(current).find((x) => x.type === type);
    if (!overwrite && existing?.body.replace(/<[^>]*>/g, '').trim()) continue;
    const r = await updatePolicy(db, current, type, await policyTemplate(db, current, type));
    if (r.ok) { written.push(type); current = { ...current, settings: { ...current.settings, policies: { ...((current.settings.policies ?? {}) as object), [r.value.handle]: { title: r.value.title, body: r.value.body, createdAt: r.value.createdAt.toISOString(), updatedAt: r.value.updatedAt.toISOString() } } } }; }
  }
  return written;
}
