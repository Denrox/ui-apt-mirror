#!/bin/bash
# Tests for render-sites.sh: an upgrade from the previous release, simulated as
# "the previous release shipped the current templates, then the templates changed".
# Run from anywhere in a clone: nginx/sites-setup/test.sh
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

# shellcheck source=render-sites.sh
. "$dir/render-sites.sh" --lib
set +e

# The previous release: today's templates, and the list update-released-sites.sh
# writes for it. The next release changes every site but npm.
PREV="$work/prev-templates"
NEXT="$work/next-templates"
LIST="$work/released-sites.sha256"
cp -r "$repo/nginx/sites" "$PREV"
cp -r "$repo/nginx/sites" "$NEXT"
echo "# Stock nginx site configs of v0.0.0: <sha256> <site>." > "$LIST"
for tpl in "$PREV"/*.conf; do
    echo "$(site_hash mirror.intra < "$tpl") $(basename "$tpl")" >> "$LIST"
done
CHANGED="admin.mirror.intra.conf cheatsheets.mirror.intra.conf files.mirror.intra.conf mirror.intra.conf"
for name in $CHANGED; do
    sed -i '1i # Changed in the next release' "$NEXT/$name"
done

# A fresh install dir: $1 = case name. Sets HOST (data/conf/nginx) and SITES.
new_case() {
    CASE="$work/$1"
    HOST="$CASE/hostconf"
    SITES="$CASE/sites"
    mkdir -p "$HOST"
}

# Runs render-sites.sh for the current case: $1 = domain, $2 = templates (default: next release)
render() {
    NGINX_TEMPLATES="${2:-$NEXT}" NGINX_HOSTCONF="$HOST" NGINX_SITES="$SITES" RELEASED_SITES="$LIST" \
        MIRROR_DOMAIN="$1" bash "$dir/render-sites.sh" > "$CASE/log" 2>&1 \
        || fail "$CASE: render-sites.sh exited $?: $(cat "$CASE/log")"
}

# What the next release's template renders to for domain $2
stock() { sed "s/mirror\.intra/$2/g" "$NEXT/$1"; }

# An override copied from the previous release's container, after a start of that
# release recorded its template. $1 = site, $2 = domain it was rendered for.
prev_override() {
    mkdir -p "$HOST/custom"
    sed "s/mirror\.intra/$2/g" "$PREV/$1" > "$HOST/custom/$1"
    sha256sum < "$PREV/$1" | cut -d' ' -f1 > "$HOST/custom/.$1.stock-sha256"
}

no_overrides() { [ -z "$(ls "$HOST/custom/"*.conf 2>/dev/null)" ]; }
overrides() { (cd "$HOST/custom" && ls ./*.conf 2>/dev/null | sed 's|^\./||' | tr '\n' ' '); }
stock_everywhere() {
    local tpl name
    for tpl in "$NEXT"/*.conf; do
        name=$(basename "$tpl")
        stock "$name" "$1" | cmp -s - "$SITES/$name" || return 1
    done
}

# 1. The committed list matches the release it names
check "released-sites.sha256 matches its release" '"$dir/update-released-sites.sh" --check >/dev/null 2>&1'

# 2. Unedited overrides of the previous release, for the default and a custom domain:
#    removed where the stock changed; npm's is a copy of the current stock and stays
for domain in mirror.intra d.test; do
    new_case "unedited-$domain"
    for tpl in "$PREV"/*.conf; do prev_override "$(basename "$tpl")" "$domain"; done
    render "$domain"
    for name in $CHANGED; do
        check "$domain: unedited $name override removed" '[ ! -e "$HOST/custom/$name" ]'
        check "$domain: $name records the current stock" \
            '[ "$(cat "$HOST/custom/.$name.stock-sha256")" = "$(sha256sum < "$NEXT/$name" | cut -d" " -f1)" ]'
    done
    check "$domain: unchanged npm override kept" '[ "$(overrides)" = "npm.mirror.intra.conf " ]'
    check "$domain: sites are the current stock" "stock_everywhere $domain"
    check "$domain: no stock copies" '[ -z "$(ls "$HOST/custom/"*.stock 2>/dev/null)" ]'
    check "$domain: says why" 'grep -q "custom/files.mirror.intra.conf was the previous release" "$CASE/log"'
done

# 3. One hand-edited override among unedited ones: only that one is kept, and flagged
new_case edited
for name in $CHANGED; do prev_override "$name" d.test; done
sed -i 's|^    location /downloads/ {|    location /probe/ { return 200 "probe"; }\n&|' "$HOST/custom/files.mirror.intra.conf"
check "edited: the probe edit applied" 'grep -q /probe/ "$HOST/custom/files.mirror.intra.conf"'
cp "$HOST/custom/files.mirror.intra.conf" "$CASE/edited.conf"
render d.test
check "edited: only files is an override (got: $(overrides))" '[ "$(overrides)" = "files.mirror.intra.conf " ]'
check "edited: override is the user's file" 'cmp -s "$CASE/edited.conf" "$HOST/custom/files.mirror.intra.conf"'
check "edited: override is used" 'cmp -s "$CASE/edited.conf" "$SITES/files.mirror.intra.conf"'
check "edited: other sites are stock" 'stock admin.mirror.intra.conf d.test | cmp -s - "$SITES/admin.mirror.intra.conf"'
check "edited: stock copy offered" 'stock files.mirror.intra.conf d.test | cmp -s - "$HOST/custom/files.mirror.intra.conf.stock"'
check "edited: says the stock changed" 'grep -q "The stock files.mirror.intra.conf changed" "$CASE/log"'

# 4. Overrides are compared only as rendered for the install's domain or as the template:
#    an unedited template copy (mirror.intra) on a d.test install is removed, but a
#    copy that names another domain is the admin's, and stays (with its stock copy)
new_case template-copy
prev_override files.mirror.intra.conf mirror.intra
render d.test
check "template copy on d.test: unedited override removed" no_overrides
check "template copy on d.test: site is stock" 'stock files.mirror.intra.conf d.test | cmp -s - "$SITES/files.mirror.intra.conf"'

new_case domain-changed
prev_override files.mirror.intra.conf old.test
cp "$HOST/custom/files.mirror.intra.conf" "$CASE/edited.conf"
render new.test
check "other domain: override kept" 'cmp -s "$CASE/edited.conf" "$HOST/custom/files.mirror.intra.conf"'
check "other domain: override is used" 'cmp -s "$CASE/edited.conf" "$SITES/files.mirror.intra.conf"'
check "other domain: stock copy offered" '[ -f "$HOST/custom/files.mirror.intra.conf.stock" ]'

# 5. An editor that added CRLFs or stripped trailing spaces did not edit the config
new_case whitespace
prev_override files.mirror.intra.conf mirror.intra
prev_override admin.mirror.intra.conf mirror.intra
sed -i 's/$/\r/' "$HOST/custom/admin.mirror.intra.conf"
sed -i 's/[[:space:]]*$//' "$HOST/custom/files.mirror.intra.conf"
render mirror.intra
check "whitespace-only changes: overrides removed (got: $(overrides))" no_overrides

# 6. In-place restart of the same release: unedited and edited overrides both stay
new_case same-release
prev_override files.mirror.intra.conf mirror.intra
prev_override admin.mirror.intra.conf mirror.intra
echo '# edit' >> "$HOST/custom/admin.mirror.intra.conf"
render mirror.intra "$PREV"
check "same release: both overrides kept (got: $(overrides))" \
    '[ "$(overrides)" = "admin.mirror.intra.conf files.mirror.intra.conf " ]'
check "same release: no warning" '! grep -q "⚠" "$CASE/log"'

# 7. Copying the current stock to custom/ (as the README says) keeps it, with no warning
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

# 8. Override with no record (written before the first start): no claim that the stock changed
new_case unknown-base
mkdir -p "$HOST/custom"
{ stock files.mirror.intra.conf mirror.intra; echo '# edit'; } > "$HOST/custom/files.mirror.intra.conf"
render mirror.intra
check "unknown base: says it is unknown" 'grep -q "not known which version" "$CASE/log"'
check "unknown base: does not say the stock changed" '! grep -q "changed since" "$CASE/log"'
check "unknown base: stock copy offered" '[ -f "$HOST/custom/files.mirror.intra.conf.stock" ]'

# 9. Override recorded against an older template: stock changed
new_case changed-base
mkdir -p "$HOST/custom"
{ stock files.mirror.intra.conf mirror.intra; echo '# edit'; } > "$HOST/custom/files.mirror.intra.conf"
echo 0000 > "$HOST/custom/.files.mirror.intra.conf.stock-sha256"
render mirror.intra
check "changed base: says the stock changed" 'grep -q "The stock files.mirror.intra.conf changed" "$CASE/log"'
render mirror.intra
check "changed base: next start still reminds" 'grep -q "Compare custom/files.mirror.intra.conf" "$CASE/log"'
check "changed base: next start does not repeat the claim" '! grep -q "changed since" "$CASE/log"'

# 10. An override whose only edit is another host name for one site (r3-upgrade-2):
#     kept through a stock change, flagged, and still serves that name
for domain in mirror.intra c.test; do
    for other in files.example.org files.other.lan; do
        new_case "rename-$domain-$other"
        prev_override files.mirror.intra.conf "$domain"
        prev_override admin.mirror.intra.conf "$domain"
        sed -i "s/files\.${domain//./\\.}/$other/g" "$HOST/custom/files.mirror.intra.conf"
        cp "$HOST/custom/files.mirror.intra.conf" "$CASE/edited.conf"
        check "rename $domain -> $other: the edit applied" 'grep -q "server_name $other;" "$CASE/edited.conf"'
        # On the release it was written for, nothing changes
        render "$domain" "$PREV"
        check "rename $domain -> $other: kept on the same release" 'cmp -s "$CASE/edited.conf" "$HOST/custom/files.mirror.intra.conf"'
        # On the next release, the unedited admin copy goes and the renamed files one stays
        render "$domain"
        check "rename $domain -> $other: only files is an override (got: $(overrides))" \
            '[ "$(overrides)" = "files.mirror.intra.conf " ]'
        check "rename $domain -> $other: override is the user's file" 'cmp -s "$CASE/edited.conf" "$HOST/custom/files.mirror.intra.conf"'
        check "rename $domain -> $other: site serves $other" 'grep -q "server_name $other;" "$SITES/files.mirror.intra.conf"'
        check "rename $domain -> $other: stock copy offered" \
            'stock files.mirror.intra.conf "$domain" | cmp -s - "$HOST/custom/files.mirror.intra.conf.stock"'
        check "rename $domain -> $other: says the stock changed" 'grep -q "The stock files.mirror.intra.conf changed" "$CASE/log"'
        check "rename $domain -> $other: not called unedited" '! grep -q "custom/files.mirror.intra.conf was the previous release" "$CASE/log"'
    done
done

echo "$passes passed, $fails failed"
[ "$fails" -eq 0 ]
