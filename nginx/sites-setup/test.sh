#!/bin/bash
# Tests for render-sites.sh against the stock configs of every release tag.
# Run from anywhere in a clone with all tags: nginx/sites-setup/test.sh
set -uo pipefail

dir=$(cd "$(dirname "$0")" && pwd)
repo=$(git -C "$dir" rev-parse --show-toplevel)
cd "$repo"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0
passes=0

ok() { passes=$((passes + 1)); }
fail() { echo "FAIL: $*"; fails=$((fails + 1)); }
check() { if eval "$2"; then ok; else fail "$1"; fi; }

# A fresh install dir: $1 = case name. Sets HOST (data/conf/nginx) and SITES.
new_case() {
    CASE="$work/$1"
    HOST="$CASE/hostconf"
    SITES="$CASE/sites"
    mkdir -p "$HOST"
}

# Runs render-sites.sh for the current case with templates from the work tree
render() {
    NGINX_TEMPLATES="$repo/nginx/sites" NGINX_HOSTCONF="$HOST" NGINX_SITES="$SITES" \
        MIRROR_DOMAIN="$1" bash "$dir/render-sites.sh" > "$CASE/log" 2>&1 \
        || fail "$CASE: render-sites.sh exited $?: $(cat "$CASE/log")"
}

# What the stock template renders to for domain $2
stock() { sed "s/mirror\.intra/$2/g" "$repo/nginx/sites/$1"; }

# Old setup.sh copied the release's sites-available and ran sed s/mirror.intra/<domain>/ once
legacy_from_tag() {
    local tag=$1 domain=$2 file
    mkdir -p "$HOST/sites-available"
    for file in $(git ls-tree --name-only "$tag" data/conf/nginx/sites-available/ | grep '\.conf$'); do
        git show "$tag:$file" | sed "s/mirror\.intra/$domain/g" > "$HOST/sites-available/$(basename "$file")"
    done
}

no_overrides() { [ -z "$(ls "$HOST/custom/"*.conf 2>/dev/null)" ]; }
overrides() { (cd "$HOST/custom" && ls ./*.conf 2>/dev/null | sed 's|^\./||' | tr '\n' ' '); }
stock_everywhere() {
    local tpl name
    for tpl in "$repo"/nginx/sites/*.conf; do
        name=$(basename "$tpl")
        stock "$name" "$1" | cmp -s - "$SITES/$name" || return 1
    done
}

# 1. The list is current
check "released-sites.sha256 is up to date" '"$dir/update-released-sites.sh" --check >/dev/null 2>&1'

# 2. Unedited configs of every release before 2.4, for the default and a custom domain
for tag in $(git tag --sort=creatordate); do
    git cat-file -e "$tag:data/conf/nginx/sites-available" 2>/dev/null || continue
    for domain in mirror.intra d.test; do
        new_case "legacy-$tag-$domain"
        legacy_from_tag "$tag" "$domain"
        render "$domain"
        check "$tag ($domain): unedited configs become overrides: $(overrides)" no_overrides
        check "$tag ($domain): sites are not the current stock" "stock_everywhere $domain"
        check "$tag ($domain): legacy dir not moved aside" '[ ! -d "$HOST/sites-available" ]'
    done
done

# 3. v2.3.1 with one hand edit (the round-2 repro): only that file is kept, and flagged
new_case edited-v2.3.1
legacy_from_tag v2.3.1 d.test
sed -i 's|^    location /downloads/ {|    location /probe/ { return 200 "probe"; }\n&|' "$HOST/sites-available/files.mirror.intra.conf"
cp "$HOST/sites-available/files.mirror.intra.conf" "$CASE/edited.conf"
render d.test
check "edited: only files is an override (got: $(overrides))" '[ "$(overrides)" = "files.mirror.intra.conf " ]'
check "edited: override is the user's file" 'cmp -s "$CASE/edited.conf" "$HOST/custom/files.mirror.intra.conf"'
check "edited: override is used" 'cmp -s "$CASE/edited.conf" "$SITES/files.mirror.intra.conf"'
check "edited: other sites are stock" 'stock admin.mirror.intra.conf d.test | cmp -s - "$SITES/admin.mirror.intra.conf"'
check "edited: stock copy offered" 'stock files.mirror.intra.conf d.test | cmp -s - "$HOST/custom/files.mirror.intra.conf.stock"'
check "edited: says the stock changed" 'grep -q "The stock files.mirror.intra.conf changed" "$CASE/log"'

# 4. Domain changed after install: files were rendered for the first domain only
new_case domain-changed
legacy_from_tag v2.2.0 old.test
render new.test
check "domain changed: unedited configs become overrides: $(overrides)" no_overrides

# 5. An editor that added CRLFs or stripped trailing spaces did not edit the config
new_case whitespace
legacy_from_tag v2.3.1 mirror.intra
sed -i 's/$/\r/' "$HOST/sites-available/admin.mirror.intra.conf"
sed -i 's/[[:space:]]*$//' "$HOST/sites-available/files.mirror.intra.conf"
render mirror.intra
check "whitespace-only changes become overrides: $(overrides)" no_overrides

# 6. Overrides 2.4.x made of unedited configs are retired; edited ones stay
new_case retire
mkdir -p "$HOST/custom"
for f in admin cheatsheets files npm; do
    git show "v2.3.1:data/conf/nginx/sites-available/$f.mirror.intra.conf" > "$HOST/custom/$f.mirror.intra.conf"
    echo deadbeef > "$HOST/custom/.$f.mirror.intra.conf.stock-sha256"
    echo old > "$HOST/custom/$f.mirror.intra.conf.stock"
done
git show v2.3.1:data/conf/nginx/sites-available/mirror.intra.conf | sed 's/mirror\.intra/d.test/g' > "$HOST/custom/mirror.intra.conf"
echo '# my edit' >> "$HOST/custom/files.mirror.intra.conf"
render d.test
check "retire: only the edited override stays (got: $(overrides))" '[ "$(overrides)" = "files.mirror.intra.conf " ]'
check "retire: retired files kept aside" '[ "$(ls "$HOST"/custom.unedited-*/ | wc -l)" = 4 ]'
check "retire: no stale stock copy" '[ ! -e "$HOST/custom/admin.mirror.intra.conf.stock" ]'
check "retire: retired sites are stock" 'stock mirror.intra.conf d.test | cmp -s - "$SITES/mirror.intra.conf"'
check "retire: edited override still flagged" '[ -f "$HOST/custom/files.mirror.intra.conf.stock" ]'

# 7. Overrides that are the 2.4.x stock rendered for the domain: retired unless still current
for tag in $(git tag --sort=creatordate); do
    git cat-file -e "$tag:nginx/sites" 2>/dev/null || continue
    new_case "custom-$tag"
    mkdir -p "$HOST/custom"
    for file in $(git ls-tree --name-only "$tag" nginx/sites/ | grep '\.conf$'); do
        name=$(basename "$file")
        git show "$tag:$file" | sed 's/mirror\.intra/c.test/g' > "$HOST/custom/$name"
        if ! git show "$tag:$file" | cmp -s - "$repo/nginx/sites/$name"; then
            echo "$name" >> "$CASE/expect-retired"
        fi
    done
    render c.test
    while read -r name; do
        check "$tag: unedited $name override retired" '[ ! -e "$HOST/custom/$name" ]'
    done < <(cat "$CASE/expect-retired" 2>/dev/null)
    check "$tag: sites are the current stock" "stock_everywhere c.test"
done

# 8. Copying the current stock to custom/ (as the README says) keeps it, with no warning
new_case new-override
render e.test
check "first start records each site's stock" '[ -s "$HOST/custom/.files.mirror.intra.conf.stock-sha256" ]'
cp "$SITES/files.mirror.intra.conf" "$HOST/custom/files.mirror.intra.conf"
render e.test
check "copy of current stock kept as override" '[ -f "$HOST/custom/files.mirror.intra.conf" ]'
echo '# edit' >> "$HOST/custom/files.mirror.intra.conf"
render e.test
check "new override: no stock copy" '[ ! -e "$HOST/custom/files.mirror.intra.conf.stock" ]'
check "new override: no warning" '! grep -q "⚠" "$CASE/log"'

# 9. Override with no record (made before records existed): no claim that the stock changed
new_case unknown-base
mkdir -p "$HOST/custom"
{ stock files.mirror.intra.conf mirror.intra; echo '# edit'; } > "$HOST/custom/files.mirror.intra.conf"
render mirror.intra
check "unknown base: says it is unknown" 'grep -q "not known which version" "$CASE/log"'
check "unknown base: does not say the stock changed" '! grep -q "changed since" "$CASE/log"'
check "unknown base: stock copy offered" '[ -f "$HOST/custom/files.mirror.intra.conf.stock" ]'

# 10. Override recorded against an older template: stock changed
new_case changed-base
mkdir -p "$HOST/custom"
{ stock files.mirror.intra.conf mirror.intra; echo '# edit'; } > "$HOST/custom/files.mirror.intra.conf"
echo 0000 > "$HOST/custom/.files.mirror.intra.conf.stock-sha256"
render mirror.intra
check "changed base: says the stock changed" 'grep -q "The stock files.mirror.intra.conf changed" "$CASE/log"'
render mirror.intra
check "changed base: next start still reminds" 'grep -q "Compare custom/files.mirror.intra.conf" "$CASE/log"'
check "changed base: next start does not repeat the claim" '! grep -q "changed since" "$CASE/log"'

echo "$passes passed, $fails failed"
[ "$fails" -eq 0 ]
