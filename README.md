# mp — automatisation de mee.plus

Ce dépôt contient **uniquement le code et les workflows** qui alimentent [mee.plus](https://mee.plus) :

| # | Quoi | Où |
|---|---|---|
| 1 | Scrapers MyLudo, Play-In, Ludum et Philibert, appariement avec les jeux mee.plus par EAN | `scrapers/` |
| 2 | Scrape quotidien automatique (nouveaux jeux, nouveaux produits, règles ajoutées) | `scripts/daily-scrape.sh`, workflow **Scrape quotidien** |
| 3 | Mise à jour de la base mee.plus : **ajout** des nouveaux jeux seulement, jamais de modification ni de suppression de fiche | workflow **Import mee.plus** |
| 4 | Récupération des images, détourage du fond blanc, couleurs, publication | workflow **Images mee.plus** |
| 5 | Analyse des images par IA (fiche IA de chaque image) | workflow **Analyse IA des images** |

Ce qu'il ne contient **pas** :

- **les données scrapées** : elles restent dans le dépôt privé [slimooo/scrappfire](https://github.com/slimooo/scrappfire) (dossier `data/`). Les workflows les lisent et y écrivent avec un jeton ; rien n'est copié ici ;
- **le code du site** : les scripts d'import et d'images (3, 4, 5) font partie du dépôt privé [MeePlus/meeplus-next](https://github.com/MeePlus/meeplus-next) (`scripts/import-myludo*.ts`, `scripts/shop-images/`), car ils utilisent la logique du site (création des fiches, schéma de la base). Les workflows d'ici les récupèrent et les lancent.

Le dépôt est public pour que les minutes GitHub Actions soient gratuites. Aucun secret n'est dans le code ; les journaux d'exécution, eux, sont publics (titres de jeux, nombres de fiches) et ne contiennent jamais de secret (GitHub les masque).

## Calendrier

| Workflow | Quand | Ce qu'il fait | Durée |
|---|---|---|---|
| **Scrape quotidien** (`scrape.yml`) | chaque jour à 2 h 23 UTC | MyLudo : jeux apparus dans les sitemaps et leurs nouveaux auteurs / illustrateurs · Play-In : produits mis en vente et fiches liées à mee.plus sans règle PDF (Play-In en ajoute après coup) · Ludum, Philibert : fiches apparues dans les sitemaps · appariement et fichier consolidé · un commit dans scrappfire s'il y a du nouveau | 30 min à 2 h |
| **Import mee.plus** (`meeplus-import.yml`) | après chaque scrape, et toutes les 6 h | nouvelles fiches, crédits, gammes, base des notes MyLudo, index de recherche | quelques minutes une fois le catalogue à jour ; plusieurs exécutions de quelques heures pour rattraper le retard |
| **Images mee.plus** (`images-publish.yml`) | après chaque import, et toutes les 6 h | images des fiches pas encore traitées | ~2 s par image |
| **Analyse IA des images** (`images-analyze.yml`) | toutes les heures, 50 min au plus | images publiées pas encore analysées | ~4 images par minute |

Chaque traitement reprend où il s'était arrêté : l'avancement est dans les fichiers de scrappfire (scrapers) ou dans la base mee.plus (import, images, analyse). Deux exécutions d'un même workflow ne tournent jamais en même temps. L'analyse IA ne bloque jamais la publication des images.

Tous se lancent aussi à la main : onglet **Actions**, choisir le workflow, **Run workflow** (case décochée : essai sans rien écrire, pour l'import et les images).

## Secrets

À ajouter dans **Settings → Secrets and variables → Actions → New repository secret** :
https://github.com/slimooo/mp/settings/secrets/actions

| Secret | Valeur | Utilisé par |
|---|---|---|
| `DATA_REPO_TOKEN` | jeton GitHub *fine-grained* : propriétaire **slimooo**, dépôt **scrappfire** seulement, permission **Contents : Read and write** | scrape (lecture et écriture des données), import et images (lecture) |
| `MEEPLUS_REPO_TOKEN` | jeton GitHub *fine-grained* : propriétaire **MeePlus**, dépôt **meeplus-next** seulement, permission **Contents : Read-only** | import, images, analyse |
| `MEEPLUS_DATABASE_URL` | URL MongoDB de mee.plus (la même que `DATABASE_URL` sur le conteneur Scaleway) | import, images, analyse |
| `MEEPLUS_ALGOLIA_APP_ID`, `MEEPLUS_ALGOLIA_WRITE_KEY` | les mêmes que `ALGOLIA_APP_ID` / `ALGOLIA_WRITE_KEY` sur le conteneur | import (index de recherche) |
| `MEEPLUS_SCW_ACCESS_KEY`, `MEEPLUS_SCW_SECRET_KEY` | clé d'API Scaleway avec droit d'écriture sur le bucket `meeplus` | images |
| `NVIDIA_API_KEY` | clé `nvapi-…` de [build.nvidia.com](https://build.nvidia.com) | analyse IA |

Les jetons *fine-grained* se créent sur https://github.com/settings/personal-access-tokens/new. Un jeton ne couvre qu'un propriétaire : il en faut un pour `slimooo/scrappfire` et un pour `MeePlus/meeplus-next` (l'organisation MeePlus doit autoriser les jetons fine-grained). Donnez-leur une date d'expiration et notez-la : à expiration, les workflows échouent avec un message sur le secret.

## Données (dans scrappfire)

| Dossier | Fichiers versionnés |
|---|---|
| `data/myludo` | `games-NNN.jsonl.gz` (les jeux, par tranches de 2 000 dans l'ordre du scrape : un nouveau jeu ne modifie que la dernière tranche), `people.jsonl.gz`, `people.csv.gz` |
| `data/playin`, `data/ludum`, `data/philibert` | `products.jsonl.gz` (fiches lues), `meeplus-<boutique>.jsonl.gz` / `.csv.gz` (appariement), `urls.txt.gz` |
| `data/shops` | `meeplus-boutiques.jsonl.gz` / `.csv.gz` : une ligne par fiche mee.plus trouvée en boutique, liens, images et règles |

`bash scripts/myludo-games.sh <fichier.jsonl>` reconstitue le fichier complet des jeux MyLudo à partir des tranches.

## En local

Node 22 ou plus, aucune dépendance à installer.

```bash
git clone https://github.com/slimooo/scrappfire ../scrappfire          # les données (dépôt privé)
DATA_DIR=../scrappfire/data bash scripts/daily-scrape.sh              # le scrape quotidien
DATA_DIR=../scrappfire/data npm run scrape:myludo -- --limit 5        # un scraper seul
```

Chaque scraper a son README dans `scrapers/<site>/` (règles d'appariement, `robots.txt`, rythme des requêtes).

## Sécurité du dépôt public

- Les workflows ne se déclenchent que sur planning, à la main ou à la suite d'un autre workflow : jamais sur une pull request. Ne pas ajouter de déclencheur `pull_request_target`, qui donnerait les secrets au code d'une pull request externe.
- Les workflows n'ont que la permission de lecture sur ce dépôt (`permissions: contents: read`).
