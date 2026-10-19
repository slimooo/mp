#!/usr/bin/env bash
# Daily scrape (workflow « Scrape quotidien »): looks for what is new on each site and updates the data
# files of the private data repository, in DATA_DIR (its data/ folder). Every step only reads what it has
# not read yet, so a day with nothing new is quick:
#   MyLudo     new games of the sitemaps, then the profiles of their new authors / illustrators
#   Play-In    products newly on sale, and the products linked to a mee.plus game that had no rules PDF yet
#   Ludum      pages newly listed in the sitemap
#   Philibert  pages newly listed in the sitemap for a mee.plus EAN
# then the matching with the mee.plus games (by EAN) and the consolidated mee.plus × shops file.
# Only the compressed files (*.gz) are versioned; the working files next to them are not.
#
# The MyLudo games (300+ MB) are versioned in slices of 2 000 games, data/myludo/games-NNN.jsonl.gz, in the
# order they were scraped: new games only change the last slice, so the data repository grows by about
# a megabyte a day instead of 50. scripts/myludo-games.sh rebuilds the whole file for the readers.
#
# Each site is a step of its own. A step that fails (site down, page changed, unreadable record) is reported
# and the next steps still run, so the workflow saves the data of the steps that succeeded; the script then
# exits with 1 and the run shows as failed. Before 17 October 2026 the script stopped at the first error and
# nothing of the night was saved.
#
# Usage: DATA_DIR=<data repository>/data bash scripts/daily-scrape.sh   (MAX_MINUTES per shop, default 60)
set -uo pipefail
: "${DATA_DIR:?DATA_DIR must point to the data/ folder of the data repository}"
export DATA_DIR
D="$DATA_DIR"
MAX="${MAX_MINUTES:-60}"
cd "$(dirname "$0")/.."

unpack() { if [ -f "$1.gz" ] && [ ! -f "$1" ]; then gunzip -c "$1.gz" > "$1"; fi; }
# -n: no name nor date in the archive, so an unchanged file gives the same bytes and no commit.
pack() { if [ -f "$1" ]; then gzip -9 -n -c "$1" > "$1.gz"; fi; }

FAILED=()
# Runs a step in a subshell that stops at its first error; the failure is reported and the script goes on.
# The subshell is not run inside an `if`: bash ignores `set -e` in a tested command, subshell included.
step() {
  local name="$1"
  shift
  echo
  echo "::group::$name"
  ( set -e; "$@" )
  local rc=$?
  echo "::endgroup::"
  if [ "$rc" -ne 0 ]; then
    echo "::error::Étape « $name » échouée (code $rc) : les étapes suivantes continuent, les données des étapes réussies sont enregistrées."
    FAILED+=("$name")
  fi
}

myludo() {
  mkdir -p "$D/myludo"
  bash scripts/myludo-games.sh "$D/myludo/games.jsonl"
  unpack "$D/myludo/people.jsonl"
  node scrapers/myludo/scrape.mjs
  node scrapers/myludo/people.mjs
  node scrapers/myludo/names.mjs
  pack "$D/myludo/people.csv"
}

# Always after the MyLudo step, even when it failed halfway: the scrapers append as they go, so what was read
# is kept and the next run carries on. Every line is checked first: one unreadable line would stop every
# reader, and once versioned, every following run.
myludo_slices() {
  [ -f "$D/myludo/games.jsonl" ] || return 0
  # A removed line marks the step as failed (something wrote a bad record), but the cleaned files are still sliced.
  local status=0
  node scrapers/myludo/check.mjs "$D/myludo/games.jsonl" "$D/myludo/people.jsonl" || status=$?
  pack "$D/myludo/people.jsonl"
  # Versioned slices, then the whole file (not versioned) for the matching below.
  rm -f "$D"/myludo/games-*.jsonl "$D"/myludo/games-*.jsonl.gz
  split -l 2000 -d -a 3 --additional-suffix=.jsonl "$D/myludo/games.jsonl" "$D/myludo/games-"
  for f in "$D"/myludo/games-*.jsonl; do gzip -9 -n "$f"; done
  gzip -1 -n -c "$D/myludo/games.jsonl" > "$D/myludo/games.jsonl.gz"
  return $status
}

playin() {
  node scrapers/playin/scrape.mjs --refresh-rules
  node scrapers/shop-match/match.mjs --shop playin --label Play-In
}

ludum() {
  node scrapers/ludum/scrape.mjs --refresh-urls --max-minutes "$MAX"
  pack "$D/ludum/urls.txt"
  node scrapers/shop-match/match.mjs --shop ludum --label Ludum --only-missing-from playin
}

philibert() {
  node scrapers/philibert/scrape.mjs --all --refresh-urls --max-minutes "$MAX"
  pack "$D/philibert/urls.txt"
  node scrapers/shop-match/match.mjs --shop philibert --label Philibert --only-missing-from playin,ludum
}

consolidate() {
  node scrapers/shop-match/consolidate.mjs
}

step "MyLudo : nouveaux jeux et nouvelles personnes" myludo
step "MyLudo : vérification des fichiers et tranches" myludo_slices
step "Play-In : nouveaux produits et règles ajoutées" playin
step "Ludum : nouvelles fiches" ludum
step "Philibert : nouvelles fiches" philibert
step "Fichier consolidé mee.plus × boutiques" consolidate

if [ ${#FAILED[@]} -gt 0 ]; then
  echo
  echo "Étapes échouées : ${FAILED[*]}"
  exit 1
fi
