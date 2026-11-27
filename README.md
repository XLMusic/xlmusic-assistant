# Assistant XLMusic

La procédure de validation et de livraison de la V7 figure dans [LIVRAISON-V7.md](LIVRAISON-V7.md).

## Archive V6

Le service utilise le flux Google Shopping existant au démarrage. La V6 ajoute un test authentifié vers Oxatis, un import progressif et une bascule explicite vers le catalogue importé. L’intégration OpenAI et le service HTTP du chatbot restent compatibles avec la V5.

## 1. Déployer la V6 en mode test sur Render

- Utiliser Node.js 22 ou 24, la commande de build `npm ci` et la commande de démarrage `npm start`. Vérifier ensuite `GET /health`.
- Garder les valeurs Render de `OPENAI_API_KEY`, `OPENAI_MODEL`, `OXATIS_APP_ID` et `OXATIS_TOKEN`.
- Générer un secret dédié de 32 caractères minimum (par exemple `openssl rand -hex 32`). Le placer dans `CATALOG_ADMIN_TOKEN` dans Render et dans l’environnement de l’opérateur. Éviter les captures, les URL et les journaux contenant sa valeur.
- Laisser `CATALOG_SOURCE` vide pendant le test. Le test ne nécessite pas de base de données.

L’appel ci-dessous doit viser **l’URL publique HTTPS du service Render qui exécute la V6**. Les trois requêtes Oxatis partent du serveur Render. Ne pas activer le traçage de la commande HTTP.

```sh
export RENDER_URL='https://VOTRE-SERVICE.onrender.com'
export DATE_START='2000-01-01T00:00:00'
export DATE_END='2026-11-27T00:00:00' # fenêtre du contrôle manuel, à actualiser pour l’import
export OXATIS_WINDOW="{\"start\":\"$DATE_START\",\"end\":\"$DATE_END\"}"

curl --silent --show-error --fail-with-body --max-time 90 \
  -H "Authorization: Bearer $CATALOG_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "$OXATIS_WINDOW" "$RENDER_URL/api/admin/oxatis/probe"
```

La réponse attendue comporte `ok: true`, le total visible, le nombre de pages, et les indicateurs commerciaux d’une fiche. La référence des tests manuels est **6 642 articles visibles, 67 pages, 100 par page**. Les chiffres peuvent évoluer. Vérifier la fenêtre et le résultat avant de poursuivre. Les dates explicites correspondent à la dernière modification Oxatis, au format local du service `AAAA-MM-JJTHH:mm:ss`. Le format et les champs suivent le [guide Oxatis](https://webservices.oxatis.com/webservices/Doc/OxatisWebServices.pdf).

Pour une erreur de réseau, réessayer une fois après le réveil du service. Une erreur Oxatis 503 signale un problème d’accès amont. Un statut applicatif Oxatis 504 signale la limite quotidienne. Le diagnostic renvoie uniquement des codes techniques, des compteurs et des indicateurs.

## 2. Importer par étapes après validation du test

Ajouter `DATABASE_URL` dans Render avec une connexion PostgreSQL persistante. Le compte doit pouvoir créer les deux tables et l’index initial, puis lire et écrire dans ces tables. Utiliser une URL avec TLS pour une base externe et respecter les paramètres fournis par l’hébergeur. Le service web Render Free perd son stockage local lors des redémarrages et mises en veille. Render Postgres gratuit expire après 30 jours. Prévoir une base durable pour conserver le catalogue au-delà de cette période. [Documentation Render Free](https://render.com/docs/free)

Choisir une fenêtre couvrant tout le catalogue visible, avec une fin postérieure aux dernières modifications pertinentes, puis répéter le test si la fenêtre a changé. Une fenêtre récente seule ne convient pas, car chaque import réussi remplace le catalogue publié.

```sh
export EXPECTED_VISIBLE=6642 # remplacer par le total du test effectué sur cette même fenêtre
curl --silent --show-error --fail-with-body --max-time 90 \
  -H "Authorization: Bearer $CATALOG_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"start\":\"$DATE_START\",\"end\":\"$DATE_END\",\"expectedVisibleCount\":$EXPECTED_VISIBLE}" \
  "$RENDER_URL/api/admin/oxatis/import/start"

node scripts/import-oxatis.js "$RENDER_URL" 10 1000
```

La commande effectue au plus 10 étapes espacées d’une seconde. La relancer pour reprendre ou augmenter le nombre d’étapes après un premier lot réussi. Les étapes lisent une page d’identifiants ou jusqu’à quatre fiches. Pour 6 642 articles, prévoir 6 709 appels de collecte, plus les sondes et les éventuels essais. La progression est validée dans PostgreSQL à la fin de chaque étape. Une erreur annule l’étape en cours. Les étapes terminées restent acquises.

`GET /api/admin/oxatis/import/status` indique l’état. `POST /api/admin/oxatis/import/cancel` annule une importation en cours avec le même jeton d’administration. Si le nombre d’articles change pendant la collecte des pages ou si deux pages contiennent le même identifiant, examiner l’état, annuler le lot en cours puis recommencer avec une fenêtre et un total vérifiés. Le précédent catalogue publié reste disponible pendant la collecte.

## 3. Activer le catalogue Oxatis

Quand l’import indique `published`, vérifier les compteurs `checked` et `usable`, puis définir `CATALOG_SOURCE=oxatis` dans Render. Contrôler `GET /api/catalog/status` et effectuer un échange de test dans le chatbot. Pour revenir au flux Google Shopping, retirer cette variable.

Le chatbot vérifie au plus trois fiches en direct par demande et écarte les fiches invisibles ou dont la lecture échoue. Le prix TTC utilise le prix et la TVA retournés. Le prix barré reste une référence et une règle de remise exige une confirmation du prix final sur la boutique. Les liens publics des fiches Oxatis sont omis tant que leur format n’a pas été validé. Les limites du chat public s’appliquent par instance, avec 20 demandes par minute et trois demandes simultanées.

## Tests locaux

`npm ci && npm test`

Les tests Oxatis utilisent des réponses simulées. La sonde sécurisée sur Render est le test de connectivité avec les identifiants réels.
