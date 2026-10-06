#!/usr/bin/env bash
# Rebuilds the whole MyLudo games file from its versioned slices (data/myludo/games-NNN.jsonl.gz), or from
# the single games.jsonl.gz of before the slices. Usage: bash scripts/myludo-games.sh <out.jsonl | out.jsonl.gz>
set -euo pipefail
out="$1"
dir="$(dirname "$out")"
shopt -s nullglob
slices=("$dir"/games-[0-9][0-9][0-9].jsonl.gz)
if [ ${#slices[@]} -gt 0 ]; then
  src=(zcat "${slices[@]}")
elif [ -f "$dir/games.jsonl.gz" ] && [ "$out" != "$dir/games.jsonl.gz" ]; then
  src=(zcat "$dir/games.jsonl.gz")
else
  echo "Aucun fichier de jeux MyLudo dans $dir" >&2
  exit 1
fi
case "$out" in
  *.gz) "${src[@]}" | gzip -1 -n > "$out" ;;
  *) "${src[@]}" > "$out" ;;
esac
echo "Jeux MyLudo reconstitués : $out"
