# Appariement mee.plus × boutiques

- `match.mjs --shop <dossier> [--only-missing-from <dossier>,…]` : une ligne par édition MyLudo, pour une boutique (voir les README de `playin`, `ludum`, `philibert`).
- `consolidate.mjs` : **le fichier consolidé**, une ligne par fiche mee.plus trouvée dans au moins une boutique, avec les liens et images des trois boutiques.

Règle commune : une édition n'est reliée à un produit que si l'un de ses EAN/ISBN est identique au code-barres lu sur la fiche de la boutique (comparaison en GTIN-14), et le lien n'est gardé que si les titres concordent.

## Fichier consolidé (`data/shops/meeplus-boutiques.{csv,jsonl}.gz`)

```bash
npm run consolidate   # quelques secondes, à partir des fiches déjà scrapées
```

- **Une ligne par fiche mee.plus** : les rééditions sont regroupées comme dans l'import mee.plus (même titre, même type, un auteur en commun ; l'édition la plus récente donne `source_ref`). Exemple : Pickomino 2005, 2014 et 2023 forment une seule fiche.
- **Toutes les boutiques pour chaque fiche** : contrairement aux fichiers par boutique, chaque fiche est comparée aux trois catalogues. Pour Philibert, cela suppose d'avoir lu les fiches de tous les EAN mee.plus (`scrapers/philibert/scrape.mjs --all`).
- **Les 157 éditions « à vérifier »** (`exports/liens-ean-a-valider.xlsx`) ne sont pas utilisées tant qu'elles ne sont pas validées. Leur fiche garde les liens trouvés par ses autres éditions ; elles sont listées dans `editions_a_verifier`.

Colonnes : `source_ref`, `source_refs`, `title`, `type`, `editions`, `editions_a_verifier`, `isbns`, `shops` (nombre de boutiques), puis pour chaque boutique `<boutique>_present` (oui/non), `<boutique>_urls`, `<boutique>_images`, et `playin_rules_pdf`.

### Dernier passage (5 octobre 2026)

- 27 920 fiches mee.plus (30 289 éditions) ; **6 447 trouvées** dans au moins une boutique : 2 319 dans une, 1 848 dans deux, 2 280 dans les trois.
- Play-In 2 672 fiches, Ludum 4 881, Philibert 5 302 ; 37 375 liens d'images ; règle PDF Play-In pour 812 fiches.
