# Envoi d'e-mails

[English](email.md)

ShopMe envoie lui-même les e-mails de commande, d'expédition, de mot de passe et d'abonnement, depuis votre propre serveur. Il vous faut un nom de domaine (avec accès à ses réglages DNS) et un serveur ; il ne faut pas de compte chez un service d'e-mail. Ouvrez **Réglages > E-mails** dans l'administration : la page affiche les 3 lignes DNS à ajouter, un bouton **Vérifier** et un bouton **Envoyer un e-mail de test**.

Il y a deux façons d'envoyer, et vous pouvez en changer en deux clics (Réglages > E-mails > Options avancées) :

1. **Directement depuis ce serveur** (par défaut). ShopMe signe chaque message (DKIM) et le remet au serveur de messagerie du destinataire, comme le ferait n'importe quel serveur de messagerie.
2. **Via un relais SMTP.** N'importe quel serveur SMTP : Brevo, Postmark, Amazon SES, Mailgun, Resend, Zoho ou un autre. Mieux adapté aux grosses newsletters, et la solution quand votre hébergeur bloque l'envoi d'e-mails.

Sans aucun réglage, une boutique envoie directement. Si l'installation a une variable `SMTP_URL`, ce compte est utilisé tant que la boutique n'a pas choisi elle-même un mode.

## Zéro configuration

Au premier démarrage, ShopMe :

- trouve l'adresse IP publique du serveur (le réglage `PUBLIC_IP` si vous en avez défini un, sinon une recherche par DNS ; si rien ne marche, la page vous demande de la saisir) ;
- prend le domaine d'envoi dans l'adresse d'expéditeur de Réglages > Notifications ou, à défaut, dans le domaine principal de la boutique, puis dans l'adresse de `APP_URL` ;
- crée la paire de clés DKIM de ce domaine (RSA 2048, sélecteur `shopme1`, clé privée chiffrée dans la base) ;
- commence à envoyer directement.

Les e-mails envoyés avant que vos lignes DNS soient en place sont tout de même tentés, mais les serveurs qui les reçoivent risquent de les juger suspects. C'est pourquoi la page vous demande d'ajouter trois lignes.

## Les 3 lignes DNS

Connectez-vous chez l'entreprise où vous avez acheté le nom de domaine, ouvrez sa page **DNS** (ou « zone DNS ») et ajoutez un enregistrement de type **TXT** pour chaque ligne affichée dans Réglages > E-mails. Utilisez les boutons **Copier**. Les changements mettent de quelques minutes à quelques heures à être visibles. Exemple pour `maboutique.fr` et un serveur à l'adresse `203.0.113.7` :

| Type | Nom | Valeur |
| --- | --- | --- |
| TXT | `maboutique.fr` | `v=spf1 ip4:203.0.113.7 ~all` |
| TXT | `shopme1._domainkey.maboutique.fr` | `v=DKIM1; k=rsa; p=MIIBIjANBgkqh...` |
| TXT | `_dmarc.maboutique.fr` | `v=DMARC1; p=none; rua=mailto:postmaster@maboutique.fr` |

Certains fournisseurs ne veulent que la partie avant le domaine dans le champ Nom (`@`, `shopme1._domainkey`, `_dmarc`).

- **SPF** indique quels serveurs ont le droit d'envoyer pour votre domaine. Un domaine ne peut avoir qu'**un seul** enregistrement SPF. Si vous en avez déjà un (par exemple pour votre fournisseur de boîtes e-mail), ShopMe le lit et propose la valeur fusionnée : votre ligne actuelle avec votre serveur ajouté avant le `~all` ou `-all` final. Remplacez l'ancienne ligne par celle proposée ; n'en ajoutez pas une seconde.
- **DKIM** est la signature de vos e-mails. La valeur est la moitié publique de la clé créée par ShopMe ; la moitié privée ne quitte jamais le serveur. Avec un relais, c'est le relais qui vous donne ses propres lignes DKIM : copiez-les depuis son tableau de bord.
- **DMARC** dit aux destinataires quoi faire des e-mails qui échouent à SPF et DKIM. Il démarre avec `p=none` (simple surveillance) et une adresse de rapports (`rua`, par défaut `postmaster@votre-domaine` ; modifiable dans les Options avancées). Quand vos e-mails arrivent bien depuis quelques semaines, passez `p=none` à `p=quarantine`.

### Vérifier

**Vérifier** interroge les enregistrements en direct et indique, pour chaque ligne, **Fait**, **À faire** ou **Problème**, avec la correction en une phrase. Le résultat est conservé : ShopMe revérifie tout seul toutes les dix minutes tant que SPF ou DKIM ne sont pas en place, puis deux fois par jour.

### Quelle adresse dans « De »

Un message envoyé directement depuis votre serveur n'arrive en boîte de réception que si le domaine de l'expéditeur est authentifié (SPF et DKIM réussissent). Donc :

- Tant que le SPF et le DKIM de votre domaine ne réussissent pas, ou quand l'expéditeur est une messagerie gratuite comme `gmail.com`, ShopMe n'utilise **pas** cette adresse dans « De ». Il envoie depuis l'adresse de la plateforme, `no-reply@<domaine de la plateforme>`, avec le nom de votre boutique comme nom affiché et l'adresse de votre boutique en adresse de réponse. La page l'indique : « Envoyés depuis no-reply@… au nom de votre boutique, en attendant que votre domaine soit vérifié ».
- Dès que vos propres vérifications réussissent, l'envoi passe tout seul à votre adresse.
- Le domaine de la plateforme est celui de `APP_URL` (une boutique) ou `STORE_BASE_DOMAIN` / `ADMIN_HOST` (multi-boutique). Il lui faut les mêmes 3 lignes, une seule fois pour toute l'installation : en multi-boutique, le propriétaire de la plateforme le fait dans l'espace plateforme ; avec une seule boutique, dans Réglages > E-mails > Détails, « Domaine de l'installation ». Sans domaine de plateforme authentifié, il n'y a pas de secours, et l'administration affiche un bandeau.
- Avec un relais ou le `SMTP_URL` de l'installation, « De » reste votre adresse.

## Contrôles du serveur (envoi direct)

Dans **Détails**, ShopMe explique chaque contrôle en mots simples :

1. **Port 25 sortant.** ShopMe se connecte à des serveurs de messagerie connus sur le port 25. Beaucoup d'hébergeurs bloquent ce port par défaut contre le spam, ou l'ouvrent sur demande. Il faut vérifier auprès de votre hébergeur ; ShopMe ne peut pas le changer. S'il est bloqué, utilisez un relais.
2. **DNS inverse (PTR).** Le nom auquel l'adresse IP de votre serveur correspond en sens inverse. Les destinataires apprécient que ce nom renvoie vers la même adresse (« confirmé dans les deux sens ») et qu'il ne soit pas un nom générique fabriqué à partir de l'IP. Il se règle dans l'espace de votre hébergeur (souvent « DNS inverse » ou « rDNS »), pas dans le DNS de votre domaine. Choisissez un nom comme `mail.maboutique.fr` que vous faites aussi pointer vers l'IP du serveur.
3. **Listes de blocage.** ShopMe demande à quelques listes de blocage DNS publiques (Spamhaus ZEN, SpamCop, PSBL) si l'IP y figure. IPv4 seulement, uniquement quand vous appuyez sur Vérifier, réponses gardées une heure. Certaines listes refusent les questions venant de serveurs de noms publics ; cela s'affiche « inconnu », pas comme un échec.
4. **IP du serveur.** Prise dans `PUBLIC_IP`, sinon détectée, sinon saisie dans la page.

Quand le port 25 est bloqué ou que l'IP est listée, la page recommande tout de suite le relais.

## Livraison, nouveaux essais et boîte d'envoi

Chaque message passe par une boîte d'envoi (Réglages > E-mails > Détails > Derniers e-mails) avec son état, son nombre d'essais, sa dernière erreur et son Message-ID : un échec n'est jamais silencieux.

- Le serveur cherche les serveurs MX du domaine du destinataire avec le résolveur du système (un domaine sans MX se rabat sur son adresse, un « MX nul » est un échec définitif), et se connecte sur le port 25 avec STARTTLS opportuniste. En cas de problème de connexion ou de réponse 4xx, il essaie le MX suivant.
- Une réponse **4xx** (temporaire : liste grise, boîte occupée) est retentée 4 fois de plus avec des délais croissants (15 minutes, 1 heure, 4 heures, 18 heures) : cinq essais sur environ 23 heures. Les nouveaux essais survivent à un redémarrage car ils sont pilotés par la table de la boîte d'envoi.
- Une réponse **5xx** (définitive : utilisateur inconnu, refus) marque aussitôt le message **Échec**, avec les mots du serveur.
- L'expéditeur de l'enveloppe et le Message-ID utilisent le domaine d'envoi.
- Les **e-mails promotionnels** (relances de panier abandonné, newsletters) portent les en-têtes `List-Unsubscribe` (un lien et un mailto, plus le désabonnement en un clic quand la boutique est en HTTPS) ; les e-mails de commande, d'expédition, de mot de passe et d'abonnement n'en ont pas.

Les serveurs MX et relais situés sur des adresses privées ou locales sont refusés. Pour le développement seulement, `EMAIL_ALLOW_PRIVATE_HOSTS=true` les autorise.

## Mode relais

Réglages > E-mails > Options avancées > « Via un service d'e-mail ». Choisissez un préréglage (il remplit serveur, port et chiffrement), saisissez le nom d'utilisateur et le mot de passe ou la clé d'API, enregistrez. Le mot de passe est stocké chiffré, par boutique, et n'est plus jamais affiché. Les préréglages sont des points de départ : vérifiez le serveur, le port et l'`include:` SPF exacts dans le tableau de bord de votre fournisseur.

| Service | Serveur | Port | Chiffrement |
| --- | --- | --- | --- |
| Brevo | `smtp-relay.brevo.com` | 587 | STARTTLS |
| Postmark | `smtp.postmarkapp.com` | 587 | STARTTLS |
| Amazon SES | `email-smtp.<région>.amazonaws.com` | 587 | STARTTLS |
| Mailgun | `smtp.mailgun.org` | 587 | STARTTLS |
| Resend | `smtp.resend.com` | 465 | TLS |
| Zoho Mail | `smtp.zoho.com` | 465 | TLS |

Ajoutez l'`include:` SPF et les lignes DKIM que votre service vous donne, et gardez la ligne DMARC. **Vérifier** contrôle votre include SPF et DMARC ; le DKIM est l'affaire du service.

## Recevoir des e-mails

ShopMe n'a pas de serveur de réception. Pour l'adresse où vos clients vous écrivent, utilisez la redirection e-mail gratuite de votre bureau d'enregistrement ou une boîte existante. Cette adresse sert d'**adresse de réponse** aux e-mails que vous envoyez.

## Conseils de montée en charge

Une nouvelle adresse IP n'a pas encore de réputation. Commencez par les e-mails transactionnels seulement (commandes, expéditions), envoyez quelques messages de test à vos propres boîtes chez plusieurs fournisseurs, et laissez le volume monter sur quelques semaines. N'envoyez pas une grosse newsletter dès le premier jour. Surveillez la boîte d'envoi et, quand tout va bien, passez DMARC à `p=quarantine`.

## Limites

- L'envoi direct convient aux volumes transactionnels (commandes, expéditions, mots de passe, quelques relances de panier). Pour de grosses newsletters, utilisez un relais : il a la réputation et la régulation qu'il faut pour l'envoi en masse.
- ShopMe remet chaque message au domaine de chaque destinataire séparément ; il n'y a pas de traitement des rebonds au-delà de la réponse reçue pendant la livraison. Un message accepté par le serveur distant peut encore être filtré ensuite.
- L'IPv6 est ajoutée au SPF quand elle est détectée, mais les listes de blocage ne sont vérifiées qu'en IPv4.
- Les serveurs destinataires peuvent encore refuser une IP neuve ou listée, ou sans nom inverse : les contrôles ci-dessus vous disent pourquoi.

## Réglages

| Variable | Rôle |
| --- | --- |
| `PUBLIC_IP` | L'IPv4 publique du serveur (et éventuellement l'IPv6, séparée par une virgule) pour la ligne SPF, quand elle ne peut pas être détectée. |
| `SMTP_URL` | Compte SMTP de toute l'installation, utilisé par les boutiques qui n'ont pas choisi de mode. Elles peuvent toujours passer à l'envoi direct ou à leur propre relais. |
| `MAIL_FROM` | Expéditeur par défaut quand rien d'autre ne s'applique. |
| `EMAIL_ALLOW_PRIVATE_HOSTS` | `true` autorise les relais et serveurs MX sur des adresses privées ou locales (développement seulement). |
