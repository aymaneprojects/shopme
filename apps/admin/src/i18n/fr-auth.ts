import type { enAuth } from './en-auth';

export const frAuth: Record<keyof typeof enAuth, string> = {
  'auth.language': 'Langue', 'auth.help': "Besoin d'aide ?",
  'auth.footer': 'ShopMe est un logiciel libre et gratuit, qui tourne sur votre propre serveur.', 'auth.terms': 'Conditions', 'auth.privacy': 'Politique de confidentialité',

  'login.title': 'Se connecter', 'login.subtitle': 'Continuer vers ShopMe', 'login.continueEmail': "Continuer avec l'e-mail", 'login.or': 'ou',
  'login.passkey': "Se connecter avec une clé d'accès", 'login.lastUsed': 'Dernière utilisation', 'login.newTo': 'Nouveau sur ShopMe ?', 'login.start': 'Démarrer',
  'login.change': 'Modifier', 'login.forgot': 'Mot de passe oublié ?',
  'login.passkeyFailed': "La clé d'accès n'a pas pu être utilisée. Réessayez ou connectez-vous avec votre mot de passe.",
  'login.passkeyRequired': "Ce compte doit se connecter avec une clé d'accès ou la vérification en deux étapes.",
  'login.emailCode.title': 'Vérifiez votre e-mail pour continuer', 'login.emailCode.subtitle': 'Par mesure de sécurité, saisissez le code à 6 chiffres envoyé à {email}',
  'login.emailCode.digit': 'Chiffre {n}', 'login.emailCode.resend': 'Renvoyer le code', 'login.emailCode.resendIn': 'Renvoyer le code dans {s} s', 'login.emailCode.verify': 'Vérifier',
  'login.emailCode.usePasskey': "Utiliser plutôt une clé d'accès", 'login.emailCode.trust': 'Ne plus me le demander sur cet appareil pendant 90 jours',
  'login.emailCode.invalid': "Ce code n'est pas correct.", 'login.emailCode.expired': 'Ce code a expiré. Demandez-en un nouveau.',
  'login.emailCode.locked': 'Trop de codes erronés. Demandez-en un nouveau.', 'login.emailCode.sent': 'Un nouveau code est en route.',
  'login.emailCode.resendLimit': 'Trop de codes demandés. Réessayez plus tard.',

  'forgot.title': 'Réinitialiser votre mot de passe', 'forgot.subtitle': 'Saisissez votre adresse e-mail, nous vous enverrons un code.', 'forgot.send': 'Envoyer le code',
  'forgot.sent': 'Si un compte utilise {email}, un code à 6 chiffres est en route.', 'forgot.newPassword': 'Nouveau mot de passe', 'forgot.submit': 'Réinitialiser le mot de passe',
  'forgot.done': 'Votre mot de passe a été modifié. Vous pouvez vous connecter.', 'forgot.invalid': "Ce code n'est pas valide ou a expiré.", 'forgot.back': 'Retour à la connexion',

  'setup.title': 'Créez votre boutique', 'setup.subtitle': 'Gratuit et open source, sur votre serveur', 'setup.step': 'Étape {n} sur {total}',
  'setup.accountTitle': 'Votre compte', 'setup.storeTitle': 'Votre boutique', 'setup.next': 'Continuer', 'setup.back': 'Retour',
  'invite.codeHelp': "Ce compte utilise la vérification en deux étapes. Saisissez un code de votre application d'authentification pour rejoindre la boutique.",
  'ms.create.subtitle': 'Gratuit et open source : donnez-lui un nom, choisissez un thème, elle est prête en une minute.',

  'security.passkeys': "Clés d'accès", 'security.passkeysHelp': "Connectez-vous avec votre empreinte, votre visage ou le verrouillage de l'écran, sans mot de passe. Une clé d'accès remplace aussi le code par e-mail et la vérification en deux étapes, car elle ne peut pas être hameçonnée.",
  'security.passkeyAdd': "Ajouter une clé d'accès", 'security.passkeyName': 'Nom', 'security.passkeyNamePlaceholder': 'Mon ordinateur', 'security.passkeyPassword': 'Confirmez votre mot de passe',
  'security.passkeyNone': "Aucune clé d'accès pour l'instant.", 'security.passkeyAdded': "Clé d'accès ajoutée", 'security.passkeyDeleted': "Clé d'accès supprimée", 'security.passkeyDelete': "Supprimer la clé d'accès {name}",
  'security.passkeyCreated': 'Ajoutée le {date}', 'security.passkeyLastUsed': 'Dernière utilisation le {date}', 'security.passkeyNever': 'Jamais utilisée', 'security.passkeySynced': 'Synchronisée',
  'security.passkeyUnsupported': "Ce navigateur, ou cette adresse, ne permet pas de créer des clés d'accès.",
  'security.secureRequired': "Votre administrateur exige une méthode de connexion sécurisée. Ajoutez une clé d'accès ou activez la vérification en deux étapes pour continuer.",

  'users.add.title': 'Ajouter des utilisateurs', 'users.add.info': "Informations sur l'utilisateur", 'users.add.emails': 'E-mails', 'users.add.emailsHelp': 'Saisissez ou collez plusieurs adresses, séparées par des virgules, des espaces ou des retours à la ligne.',
  'users.add.submit': 'Ajouter', 'users.add.secure': 'Méthode de connexion sécurisée',
  'users.add.secureHelp': "Exige une méthode de connexion sécurisée, comme une clé d'accès ou la vérification en deux étapes, pour que ces utilisateurs puissent se connecter. Ils la configurent à leur première connexion.",
  'users.add.roles': 'Rôles', 'users.add.rolesHelp': "Attribuez des rôles pour définir les actions que l'utilisateur peut effectuer.", 'users.add.assign': 'Attribuer', 'users.add.pick': 'Choisir un rôle',
  'users.add.remove': 'Retirer {email}', 'users.add.sent': '{n} invitations envoyées', 'users.add.sent.one': '1 invitation envoyée', 'users.add.failed': 'Non invités : {list}', 'users.add.back': 'Utilisateurs',
  'users.add.invalid': "{email} n'est pas une adresse valide",
  'notif.tpl.login_code.name': 'Code de vérification de connexion', 'notif.tpl.login_code.desc': 'Envoyé pour confirmer une connexion depuis un nouvel appareil',
  'notif.tpl.password_reset_code.name': 'Code de réinitialisation du mot de passe', 'notif.tpl.password_reset_code.desc': "Envoyé lorsqu'une personne demande à réinitialiser son mot de passe",
};
