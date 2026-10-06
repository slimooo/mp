# Play-In × mee.plus

Retrouve les jeux de mee.plus dans le catalogue de [Play-In](https://www.play-in.com/fr) et récupère, pour chaque jeu et extension : l'URL de la fiche Play-In, les images d'illustration, la règle PDF quand elle existe et la présence au catalogue (oui / non).

**Un jeu n'est relié à une fiche Play-In que si l'un de ses codes EAN/ISBN est identique au code-barres de la fiche.** Aucun rapprochement par titre. Les codes sont comparés sous forme GTIN-14 (chiffres complétés de zéros à gauche) : un UPC-12 et son EAN-13 « 0… » sont le même code.

Certains éditeurs réutilisent un code-barres, et des codes sont mal saisis d'un côté ou de l'autre. Un jeu relié dont le titre ne ressemble pas au nom Play-In reste relié (le code est identique) mais reçoit `playin_title_check` = `à vérifier` (Gaudi ↔ Orloj, Splendor ↔ Daybreak…, mais aussi des titres traduits comme Ticket To Ride ↔ Les Aventuriers du Rail).

```bash
npm run scrape:playin   # ~1h30 la première fois : listing du catalogue puis lecture de chaque fiche produit (reprise possible)
npm run match:playin    # quelques secondes : appariement avec data/myludo/games.jsonl.gz
```

## Sources

- **Jeux mee.plus** : le scrape MyLudo (`data/myludo/games.jsonl.gz`), filtré comme l'import de meeplus-next (`scripts/myludo/common.ts`, `filterOut`) : jeux, extensions et standalones, hors financement participatif et print and play, avec auteur, éditeur et version française. Une ligne par édition MyLudo ; la fiche mee.plus correspondante porte `myludo:<ml_id>` dans `sourceRef` / `sourceRefs`.
- **Catalogue Play-In** : la recherche du site (server action Next.js `fetchSearchResults`, filtre « Aucune carte à l'unité ») liste tous les produits scellés en vente, puis chaque page `/fr/produit/<id>` donne le code-barres (`barCode`, et `gtin14` des données structurées), les images (`imagesUrl`) et les règles (`boardgameRules`). Les produits retirés de la vente ne sont pas listés et ne peuvent pas être énumérés (un identifiant inconnu ou masqué renvoie la même page générique) : « présent » veut dire « au catalogue Play-In actuel ».

L'identifiant de la server action change quand Play-In redéploie son site : voir le commentaire de `SEARCH_ACTION` dans `client.mjs` pour le retrouver.

## Fichiers produits (`data/playin`)

| Fichier | Contenu |
| --- | --- |
| `meeplus-playin.csv.gz` / `.jsonl.gz` | une ligne par jeu mee.plus : `ml_id`, `meeplus_source_ref`, `title`, `edition`, `type`, `publishers`, `barcodes`, `playin_present` (oui/non), `playin_matched_ean`, `playin_title_check`, `playin_ids`, `playin_names`, `playin_urls`, `playin_images`, `playin_rules_pdf`. Dans le CSV, les listes sont jointes par ` \| `. |
| `products.jsonl.gz` | toutes les fiches Play-In lues : code-barres, gamme, catégorie, éditeur, langue, auteurs, images, règles, vidéos… |

`catalog.jsonl`, `products.jsonl` et `errors.jsonl` sont les fichiers de travail du scrape (non versionnés).

## Dernier passage (4 octobre 2026)

- Play-In : 7 202 produits scellés lus (0 erreur), 449 sans code-barres.
- mee.plus : 30 289 jeux, dont 18 281 avec un EAN/ISBN.
- **2 795 jeux présents chez Play-In** (dont 481 extensions), reliés à 2 690 fiches Play-In ; 856 avec une règle PDF ; tous ont au moins une image ; 44 titres à vérifier.
