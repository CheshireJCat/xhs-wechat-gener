#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
node scripts/check.mjs
node scripts/check-consent.mjs
node scripts/check-insert.mjs

# Publish only the website. Keep source, development tools and releases private.
repo_url="$(git remote get-url origin)"
pages_dir="$(mktemp -d)"
trap 'rm -rf "$pages_dir"' EXIT
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' clone --quiet --no-checkout "$repo_url" "$pages_dir"
if git -C "$pages_dir" show-ref --verify --quiet refs/remotes/origin/gh-pages; then
  git -C "$pages_dir" checkout --quiet -b gh-pages origin/gh-pages
else
  git -C "$pages_dir" checkout --quiet --orphan gh-pages
fi
git -C "$pages_dir" rm -r --quiet --ignore-unmatch .
cp -R dist/. "$pages_dir/"
touch "$pages_dir/.nojekyll"
git -C "$pages_dir" add --all
if git -C "$pages_dir" diff --cached --quiet; then
  echo 'Pages files are already current.'
  exit 0
fi
git -C "$pages_dir" commit -m 'Deploy current chat generator to Pages'
git -C "$pages_dir" -c credential.helper= -c 'credential.helper=!gh auth git-credential' push origin gh-pages
