# Philibert × mee.plus

Troisième passe, après Play-In et Ludum : pour les jeux mee.plus **qu'aucune des deux n'a trouvés, ou marqués « à vérifier »** (et qui ont un EAN/ISBN), cherche le jeu chez [Philibert](https://www.philibertnet.com) et récupère l'URL de la fiche, ses images et la présence au catalogue Philibert (oui / non).

**Un jeu n'est relié que si l'un de ses EAN/ISBN est identique à l'EAN de la section « Fiche technique » de la fiche Philibert.** L'EAN du JSON-LD (`gtin_jsonld`) et celui de l'URL (`url_ean`) sont gardés à part et ne servent pas à l'appariement.

```bash
npm run scrape:philibert -- --all   # ~3h la première fois : ~17 000 fiches à ~1,25 requête/s (reprise possible, --max-minutes pour découper)
npm run match:philibert             # quelques secondes
```

## Quelles fiches sont lues

Le `robots.txt` de Philibert interdit la recherche (`/fr/recherche`) à tous les robots. Le sitemap (`/sitemaps/sitemap_1.xml`) liste ~56 600 fiches en français, la plupart avec leur EAN en fin d'URL (`…/100084-khora-3760175517501.html`). Le scraper ne lit que :
- les fiches dont l'URL se termine par l'EAN d'un jeu recherché ;
- les fiches dont l'URL ne contient pas d'EAN.

Au passage du 4 octobre 2026, l'EAN de l'URL était toujours identique à celui de la fiche technique, et aucune fiche sans EAN dans l'URL n'avait d'EAN dans sa fiche technique (accessoires, goodies…).

Le scraper s'identifie comme `scrappfire/1.0`, applique les règles `User-agent: *` du `robots.txt`, fait une requête à la fois et ralentit sur 429 / 503.

## Fichiers (`data/philibert`)

| Fichier | Contenu |
| --- | --- |
| `meeplus-philibert.csv.gz` / `.jsonl.gz` | une ligne par jeu recherché : `ml_id`, `meeplus_source_ref`, `title`, `edition`, `type`, `publishers`, `barcodes`, `playin_present`, `playin_title_check`, `ludum_present`, `ludum_title_check`, `philibert_present` (oui/non), `philibert_matched_ean`, `philibert_title_check`, `philibert_ids`, `philibert_names`, `philibert_urls`, `philibert_images` (`philibert_rules_pdf` reste vide) |
| `products.jsonl.gz` | toutes les fiches lues : EAN de la fiche technique, `gtin_jsonld`, `url_ean`, référence, éditeur, prix, fiche technique complète, images (`thickbox_default`) |
| `urls.txt.gz` | les fiches sélectionnées dans le sitemap |

## Dernier passage (4 octobre 2026)

- 13 013 fiches lues (0 erreur) sur 56 595 fiches FR du sitemap.
- 12 997 jeux mee.plus recherchés (avec EAN/ISBN, ni chez Play-In ni chez Ludum avec un titre cohérent).
- **1 464 trouvés chez Philibert** (dont 369 extensions), reliés à 1 440 fiches ; tous ont au moins une image ; 106 titres « à vérifier ».
- Gaudi → Orloj, Ice and the Sky → Pollen, Splendor → Daybreak… retombent sur le même produit chez les trois boutiques : l'EAN côté MyLudo/mee.plus est faux pour ces jeux.
