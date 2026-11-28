# Règles commerciales de l’assistant

Le conseil vérifie le type de produit, la compatibilité, les critères du client, le prix TTC actualisé et les conditions de vente. Une offre au-dessus du budget est présentée séparément uniquement lorsque le client accepte un dépassement. Parmi les options qui conviennent, l’assistant privilégie le stock magasin pour les familles concernées et sous 60 € TTC. Il départage ensuite les produits à pousser, les promotions et déstockages, puis les marques. Savarez bénéficie d’une préférence spécifique pour les jeux de cordes compatibles.

Oxatis publie une quantité Web et des conditions de vente en rupture. La quantité seule ne décrit pas sa provenance. Dans le champ complémentaire de la quantité Oxatis, « Stock Internet » correspond au dropshipping et « Stock magasin » au magasin. Une quantité positive ou une vente autorisée en rupture ne change pas la provenance par défaut, qui reste inconnue. Un prix barré supérieur au prix actuel confirme une promotion. Une grille de remise seule ne suffit pas. Une catégorie explicite « Déstockage » ou « Liquidation de stock » ou une campagne par référence peut signaler un déstockage.

## Configuration privée

La variable `COMMERCIAL_POLICY_FILE` peut désigner un fichier JSON privé. Les valeurs par défaut fonctionnent sans ce fichier. Quand le fichier est défini, l’assistant relit son contenu à chaque demande et garde la dernière configuration valide si une lecture ou l’encodage échoue. Exemple avec des références fictives :

```json
{
  "priorityBrands": ["Prodipe"],
  "preferredBrands": ["Savarez", "Mac Mah", "Elokance", "Lâg", "PRS", "Ibanez"],
  "localStockBelowCents": 6000,
  "products": {
    "EXEMPLE-1": {
      "stockSource": "store",
      "stockValidUntil": "2027-01-01T12:00:00Z",
      "campaign": "clearance",
      "campaignValidUntil": "2027-01-02T00:00:00Z",
      "push": true
    },
    "EXEMPLE-2": {
      "stockSource": "supplier",
      "stockValidUntil": "2027-01-01T12:00:00Z"
    }
  }
}
```

Une provenance fournie dans la configuration privée exige une échéance. Après celle-ci, le classement utilise de nouveau la provenance inconnue. Une référence déclarée magasin reçoit la priorité magasin uniquement lorsqu’Oxatis la confirme en stock. La sélection utilise une version cohérente de la politique par demande. Le JSON et ses motifs restent côté serveur, hors des réponses et des données transmises au modèle.

Pour l’intégration future, l’intranet pourra conserver les préférences et les produits à pousser derrière ses droits d’administration et publier atomiquement ce JSON vers un emplacement privé accessible au service. Sur des hôtes distincts, un transport privé authentifié pourra alimenter cet emplacement. L’écriture se fait dans un fichier temporaire puis par renommage. Le fournisseur de données de stock peut publier les origines attestées séparément du flux catalogue, avec des dates de validité courtes. L’intranet, les droits d’édition et le transport restent à raccorder. Aucune modification EBP/Oxatis ni migration de base n’est nécessaire.
