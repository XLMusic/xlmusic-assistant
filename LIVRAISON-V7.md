# Assistant XLMusic V7

## Diagnostic de V6

Base examinée · `main`, commit `aa70c57` (« Add files via upload »).

| Symptôme | Constat vérifié |
| --- | --- |
| Panier à 797 € pour une demande à 400 € | V6 utilisait le budget comme bonus de classement par article. Le serveur ne filtrait ni le plafond ni la somme du panier. |
| Blackstar HT-1R et Mac Mah SC-1000 cités | Le classement comparait des fragments de mots du message aux fiches. Il supprimait notamment « sans » et ne vérifiait ni l’absence d’ampli traditionnel ni l’alimentation sur batterie. En mode Oxatis, les trois premiers résultats étaient les seuls relus avant la réponse libre. |
| Liens manquants | La normalisation des fiches issues de l’API Oxatis ne renseigne pas de lien public, comme l’indique le README V6. |
| Compteurs de diagnostic divergents | En V6, `/health` répondait immédiatement à partir de l’état mémoire et renvoyait toujours HTTP 200 avec `ok: true`. `/api/catalog/status` relisait PostgreSQL en mode Oxatis. Le 27 novembre 2026, les deux routes publiques ont renvoyé 2 718 produits, sans erreur. |

Les facteurs ci-dessus expliquent les possibilités offertes par le code. Sans les traces des cinq requêtes d’origine, la liste réellement transmise à OpenAI, la pondération précise qui a retenu chaque fiche, le rôle joué par le modèle et l’origine de la divergence ponctuelle des compteurs restent à confirmer. Les guitares compatibles que V6 aurait pu manquer dans le catalogue réel restent également à identifier.

## Comportement V7

- Le modèle interprète la demande et les quatre derniers messages du client. Il renvoie des critères structurés. Le serveur applique les contraintes de famille, marque, stock, caractéristiques et prix à toutes les fiches publiées qu’il a chargées, puis revérifie les candidats retenus.
- Le plafond porte sur la somme des articles TTC, calculée en centimes. « Moins de » exclut le prix égal. Le mode Oxatis relit jusqu’à quatre fiches par demande, contre trois en V6. Le serveur recalcule les totaux avec les prix relus. Le devis de livraison dépend de la boutique et le total affiché porte sur le matériel.
- Le serveur rédige la réponse à partir des fiches retenues. Une recommandation unique suffit. Les fiches hors stock, incompatibles ou à caractéristique indispensable non confirmée sont écartées. Les articles commandables sont annoncés avec leur délai à confirmer. Une question courte aide à préciser l’usage quand elle peut changer le conseil.
- Les liens présentent une fiche HTTPS sur le domaine XLMusic avec vérification de la référence ou du code EAN dans la page produit. En mode Oxatis, la vérification essaie une adresse candidate avec l’identifiant de la fiche. Un lien public de secours est identifié par la référence de la Squier Sonic Sienna Sunburst. Les résultats de vérification sont mis en cache brièvement. Une réponse sans lien peut rester utile quand la fiche publique est inaccessible.
- `/health` et `/api/catalog/status` utilisent la même lecture de l’état catalogue. Le diagnostic affiche la source active, la date de publication, le nombre de produits et les indicateurs de configuration des services. `/health` répond HTTP 503 lorsque le catalogue requis est indisponible ou que la configuration obligatoire est absente. Un secret configuré indique uniquement sa présence.

Le filtrage se base sur les catégories, intitulés et descriptions disponibles. Des fiches trop peu détaillées ou dont la catégorie a changé depuis la publication peuvent échapper à la première sélection. La relecture reste volontairement bornée pour protéger le quota Oxatis. Les demandes complexes de plus de deux articles déclenchent une demande de précision. Ces limites et la qualité de l’interprétation OpenAI doivent être vérifiées en préproduction.

La fiche Squier a été identifiée dans l’index public XLMusic par sa référence [037-3150-547](https://www.xlmusic.fr/squier-sonic-stratocaster-sienna-sunburst-c2x42636242). Les lectures HTTP directes du site et du flux effectuées depuis le poste ont répondu 403. Les liens XLMusic du Mustang Micro Plus et de l’Elokance e-GO 8X restent à valider depuis l’environnement Render de test.

## Installer dans une copie de travail

Le fichier `xlmusic-v7.patch` s’applique au dépôt de départ. Depuis une copie Git propre, avec le fichier de livraison à disposition, lancer ces commandes en remplaçant le chemin du patch.

```sh
git switch -c v7-conseil aa70c57
git apply --check /chemin/vers/xlmusic-v7.patch
git apply /chemin/vers/xlmusic-v7.patch
npm ci
npm test
```

Utiliser Node.js 22 ou 24. Les tests simulent PostgreSQL, OpenAI, Oxatis et le site marchand. Le test HTTP nécessite l’ouverture temporaire d’un port local. Les cas métier utilisent des intentions structurées enregistrées dans les tests. L’interprétation par le modèle configuré sur Render reste à valider avec les phrases d’origine.

## Recette privée avant décision de mise en production

1. Préparer une instance de test avec déploiement automatique désactivé. Utiliser la même source `CATALOG_SOURCE=oxatis`, le même catalogue publié et, si possible, un accès PostgreSQL limité à la lecture. Conserver les variables OpenAI et Oxatis dans l’environnement privé. V7 lit le catalogue publié. Aucun import ni changement EBP–Oxatis n’est requis. Les routes d’administration d’import héritées de V6 exigent leur jeton. La recette utilise uniquement les routes ci-dessous.
2. Démarrer V7 et ouvrir `/health` puis `/api/catalog/status`. Attendre V7, `ok: true`, la source `oxatis`, 2 718 produits sur les deux routes et la même date de publication. Si un compteur diffère, vérifier la source et la connexion PostgreSQL de l’instance avant d’aller plus loin.
3. Rejouer les cinq phrases suivantes dans la page de test de l’assistant, une session neuve par cas. Contrôler les liens affichés en les ouvrant et vérifier que la référence de la page correspond à la recommandation.

| Question d’origine | Critère d’acceptation |
| --- | --- |
| Je débute la guitare électrique, j'aime le rock et j'ai un budget de 400 € pour une guitare et un ampli. Que me conseillez-vous ? | Ensemble complet à 400 € TTC maximum si une combinaison est confirmée. La réponse affiche le total et écarte le panier V6 à 797 €. Si aucune combinaison ne passe, le conseiller le dit simplement. |
| Quelles guitares électriques de marque Ibanez ou Squier avez-vous en stock à moins de 200 € ? | Marques alternatives, guitares électriques en stock et prix strictement inférieur à 200 €. Contrôler la Squier Sonic à 199 € si son prix et son stock sont toujours valides. |
| Quelles guitares électriques avez-vous en stock à moins de 150 €, toutes marques confondues ? | Toute marque éligible. Si aucun résultat, le dire sans proposer la Prodipe classique. |
| Je possède une guitare électrique Fender Stratocaster et je souhaite jouer au casque sans utiliser mon ampli. Quelles solutions pouvez-vous me proposer parmi vos produits en stock ? | Solution casque autonome telle que le Mustang Micro Plus si elle est confirmée. Aucun Blackstar HT-1R. Une question sur la présence d’un casque filaire est possible. |
| Je suis chanteur et je recherche une enceinte autonome sur batterie avec Bluetooth, pour chanter lors de petites prestations devant une cinquantaine de personnes. Mon budget est de 600 €. Que me conseillez-vous ? | Les fiches retenues confirment batterie, Bluetooth et branchement ou fourniture d’un micro. Aucun SC-1000 sans batterie confirmée. Vérifier si l’Elokance e-GO 8X est sur commande. Poser la question intérieur/extérieur si elle reste ouverte, sans garantir la couverture. |

4. Reprendre ensuite le dernier test dans la même session avec « En extérieur, et j’ai déjà un micro ». Vérifier que le budget et les contraintes initiales restent actifs et que la question sur le lieu ne revient pas.
5. Valider les réponses, liens, temps de réponse et consommation du quota Oxatis avant toute activation. Conserver le commit et les paramètres V6 comme point de retour. Si une mise en production ultérieure échoue, remettre le commit V6 avec la même source et la même connexion PostgreSQL.

La version remise est locale. La branche distante, Render, PostgreSQL et la synchronisation EBP–Oxatis n’ont fait l’objet d’aucune écriture de livraison.
