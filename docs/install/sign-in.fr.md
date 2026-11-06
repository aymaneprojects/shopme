# Connexion : clés d'accès, codes par e-mail et connexion sécurisée

La connexion à l'administration commence par l'e-mail, puis le mot de passe. Cette page décrit les autres moyens d'entrer et les contrôles supplémentaires.

## Clés d'accès (passkeys)

Une clé d'accès permet de se connecter avec une empreinte, un visage ou le verrouillage de l'appareil, sans mot de passe. ShopMe utilise les identifiants WebAuthn « découvrables » ([`@simplewebauthn/server`](https://simplewebauthn.dev) et `@simplewebauthn/browser`, licence MIT).

- **En ajouter une :** Paramètres > Utilisateurs > Sécurité > Clés d'accès > « Ajouter une clé d'accès ». Le mot de passe du compte est redemandé, car une clé d'accès contourne les autres contrôles. Jusqu'à 10 clés par compte, listées et supprimables sur la même page.
- **L'utiliser :** « Se connecter avec une clé d'accès » sur la page de connexion, sans saisir d'e-mail.
- **Badge « Dernière utilisation » :** le bouton l'affiche quand ce navigateur s'est connecté en dernier avec une clé d'accès. Il est mémorisé dans le `localStorage` du navigateur uniquement.
- **Une clé d'accès remplace tous les autres contrôles.** Elle résiste à l'hameçonnage (le navigateur ne la propose que sur le vrai site) et vérifie la personne (code, empreinte ou visage) : une connexion par clé d'accès saute le code par e-mail et la vérification en deux étapes.
- **Où elle fonctionne :** la clé est liée à l'hôte de l'administration (identifiant de la partie de confiance). Boutique unique : l'hôte de `APP_URL`. Multi-boutiques : le premier hôte de `ADMIN_HOST`. Les origines sont vérifiées par rapport à `APP_URL` (et, en multi-boutiques, aux hôtes de `ADMIN_HOST`, plus les entrées de `TRUSTED_ORIGINS` sur le même hôte). Changer d'hôte d'administration oblige à ajouter de nouveau les clés ; les mots de passe continuent de fonctionner. Il faut HTTPS (ou `localhost`). Le bouton est masqué si le navigateur ne gère pas les clés d'accès ou si la page est sur un autre hôte.
- **Données :** table `account_passkeys` (migration `0032`) : identifiant, clé publique, compteur, transports et un nom. Aucun secret ne quitte l'appareil.

Aucune nouvelle variable d'environnement : les clés d'accès utilisent `APP_URL` et `ADMIN_HOST`.

## Code par e-mail sur un nouvel appareil

Après le mot de passe, un appareil que le compte n'a jamais utilisé doit confirmer un code à 6 chiffres envoyé par e-mail :

- le code est aléatoire, stocké haché, valable 10 minutes et à usage unique ; 5 essais erronés l'invalident (il faut en demander un nouveau) ;
- « Renvoyer le code » a un délai de 30 secondes et est limité à 5 codes par 15 minutes ;
- après un bon code, un cookie signé (`shopme_td_<id du compte>`, 90 jours) marque le navigateur comme de confiance pour ce compte. Changer le mot de passe fait redemander le code partout ;
- un compte avec application d'authentification (vérification en deux étapes) garde cette étape à la place ; une connexion par clé d'accès saute les deux.

**Cette étape n'existe que là où l'e-mail peut être livré.** Le code n'est demandé que si l'état de l'e-mail de l'installation (Paramètres > E-mails, le même état que le bandeau) est « ok » pour la boutique ouverte. Sur une installation neuve, dans l'application de bureau (sans e-mail) ou quand l'envoi est en panne, on se connecte avec le mot de passe seul : personne n'est bloqué. Si le message ne peut pas être remis à l'expéditeur au moment de la connexion, l'étape est aussi ignorée.

Le message est la notification « Code de vérification de connexion » (Paramètres > Notifications), en français et en anglais.

## Mot de passe oublié

« Mot de passe oublié ? » (proposé seulement là où l'e-mail peut être livré) envoie un code à 6 chiffres (notification « Code de réinitialisation du mot de passe »). Avec ce code, la personne choisit un nouveau mot de passe et toutes ses sessions sont fermées. La réponse ne dit jamais si une adresse a un compte.

## Méthode de connexion sécurisée pour les utilisateurs invités

Paramètres > Utilisateurs > « Ajouter des utilisateurs » propose l'option « Méthode de connexion sécurisée ». Pour les utilisateurs invités avec cette option :

- ils n'accèdent à l'administration qu'après avoir configuré une clé d'accès ou la vérification en deux étapes (la première connexion ouvre la page Sécurité) ;
- avec une clé d'accès mais sans application d'authentification, la connexion par mot de passe est refusée : ils doivent utiliser la clé d'accès (ou activer la vérification en deux étapes) ;
- avec la vérification en deux étapes, l'étape de code habituelle s'applique.

## Rejoindre une autre boutique avec un compte existant (multi-boutiques)

Accepter une invitation avec un compte qui existe déjà demande son mot de passe **et** son code de vérification en deux étapes s'il en a un. Les mots de passe et codes erronés sont limités comme une connexion normale (10 échecs par 15 minutes, par adresse et par invitation).

## Liens du pied de page

Les écrans de connexion affichent « Besoin d'aide ? » (la documentation ShopMe sur GitHub par défaut) et, si définis, les liens vers les conditions et la politique de confidentialité. Le propriétaire de la plateforme peut les définir avec `PUT /admin/api/platform/settings` (`helpUrl`, `termsUrl`, `privacyUrl`, URL https ; une chaîne vide efface le lien).

## Non pris en charge

La connexion avec Google ou Apple n'est pas prise en charge : les comptes sont propres à votre installation.
