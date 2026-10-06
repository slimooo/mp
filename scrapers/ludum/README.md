# Ludum × mee.plus

Complète Play-In : pour les jeux mee.plus **absents de Play-In ou marqués « à vérifier »** (et qui ont un EAN/ISBN), cherche le jeu chez [Ludum](https://www.ludum.fr) et récupère l'URL de la fiche, ses images et la présence au catalogue Ludum (oui / non). Ludum ne publie pas de règles PDF : elles ne sont pas collectées.

**Un jeu n'est relié que si l'un de ses EAN/ISBN est identique à l'EAN13 de la section « Détails du produit » de la fiche Ludum** (lignes `EAN13`, sous « Références spécifiques »). Le `gtin13` des données structurées est gardé à part (`gtin13_jsonld`) et ne sert pas à l'appariement.

```bash
npm run scrape:ludum   # ~2h15 la première fois : 9 800 fiches de jeux à ~1,25 requête/s (reprise possible)
npm run match:ludum    # quelques secondes
```

## Pourquoi pas la recherche par EAN

Le `robots.txt` de Ludum interdit `/rechercher` (et toute URL à paramètres) à tous les robots. Le scraper lit donc une fois chaque fiche de jeu listée dans le sitemap (`/1_fr_0_sitemap.xml`), relève son EAN13, puis l'appariement se fait en local. Le résultat est le même qu'une recherche par EAN, sans page interdite.

Le scraper s'identifie comme `scrappfire/1.0`, applique les règles `User-agent: *` du `robots.txt`, fait une requête à la fois et ralentit sur 429 / 503. Les mangas, BD, comics, puzzles et fournitures de peinture du sitemap sont ignorés (`SKIPPED_CATEGORIES` dans `scrape.mjs`).

## Fichiers (`data/ludum`)

| Fichier | Contenu |
| --- | --- |
| `meeplus-ludum.csv.gz` / `.jsonl.gz` | une ligne par jeu recherché (avec EAN/ISBN, non trouvé ou à vérifier chez Play-In) : `ml_id`, `meeplus_source_ref`, `title`, `edition`, `type`, `publishers`, `barcodes`, `playin_present`, `playin_title_check`, `ludum_present` (oui/non), `ludum_matched_ean`, `ludum_title_check`, `ludum_ids`, `ludum_names`, `ludum_urls`, `ludum_images` (`ludum_rules_pdf` reste vide) |
| `products.jsonl.gz` | toutes les fiches lues : EAN13 des détails, `gtin13_jsonld`, éditeur, catégorie, disponibilité, prix, détails complets, images |
| `urls.txt.gz` | les fiches de jeux du sitemap |

## Dernier passage (4 octobre 2026)

- Ludum : 9 831 fiches de jeux lues (0 erreur), 901 sans EAN13 dans les détails ; l'EAN13 des détails est toujours identique au `gtin13` des données structurées quand les deux existent.
- 15 519 jeux mee.plus recherchés (avec EAN/ISBN ; 15 475 absents de Play-In, 44 « à vérifier » chez Play-In).
- **2 593 trouvés chez Ludum** (dont 864 extensions), reliés à 2 550 fiches ; tous ont au moins une image ; 71 titres « à vérifier ».
- Sur les 44 « à vérifier » de Play-In, 8 sont confirmés par Ludum avec un titre cohérent. Plusieurs autres retombent sur le même produit (Gaudi → Orloj, Ice and the Sky → Pollen) : c'est alors l'EAN côté MyLudo/mee.plus qui est probablement faux.
