import type { enAccountPages } from './en-account-pages';

export const frAccountPages: Record<keyof typeof enAccountPages, string> = {
  'acct.pages': 'Pages du compte', 'acct.pagesDesc': 'Personnalisez les pages de connexion, de compte, de commande et d’adresses de votre boutique en ligne dans l’éditeur de thème.',
  'acct.customize': 'Personnaliser', 'acct.noTheme': 'Publiez d’abord un thème : les pages du compte font partie du thème en ligne.',
  'editor.groupPages': 'Pages', 'editor.groupAccount': 'Comptes clients', 'editor.pageAlt': '{page} : {name}',
  'editor.page.customers/login': 'Connexion', 'editor.page.customers/register': 'Création de compte', 'editor.page.customers/account': 'Compte et commandes',
  'editor.page.customers/order': 'Détail de commande', 'editor.page.customers/addresses': 'Adresses', 'editor.page.customers/activate_account': 'Activation du compte',
  'editor.page.customers/reset_password': 'Réinitialisation du mot de passe', 'editor.page.gift_card': 'Carte-cadeau', 'editor.page.password': 'Page de mot de passe',
  'editor.sampleCustomer': 'Affichée avec un client d’exemple. Aucune donnée client réelle n’apparaît dans l’éditeur.',
};
