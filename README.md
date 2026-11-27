# XLMusic Assistant V8

Assistant de conseil commercial pour les instruments, la sonorisation et
l’éclairage. La V8 relit le catalogue PostgreSQL publié et confirme chaque
recommandation via Oxatis et sa fiche publique XLMusic.

## Démarrage et tests

Utiliser Node.js 24. Installer les dépendances avec `npm ci`, lancer
les tests avec `npm test`, puis démarrer le service avec `npm start`.
Les tests utilisent des réponses simulées et n’ont pas besoin de secrets.

En mode Oxatis, renseigner dans l’environnement privé du service
`CATALOG_SOURCE=oxatis`, `DATABASE_URL`, `OXATIS_APP_ID`,
`OXATIS_TOKEN` et `OPENAI_API_KEY`. `OPENAI_MODEL` conserve le
modèle du service lorsqu’il est renseigné. Render fournit le port
de lancement. `CATALOG_ADMIN_TOKEN` protège les opérations
administratives et peut rester absent en recette.

## Documentation

- [Déploiement GitHub et Render](DEPLOIEMENT-V8.txt)
- [Modifications, résultats et limites](RAPPORT-V8.txt)
- [Documentation historique V7](LIVRAISON-V7.md)
