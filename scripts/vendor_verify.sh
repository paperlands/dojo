#!/usr/bin/env bash
# Drift check for vendored files — silent when intact, loud when edited.
#
# The invariant (assets/js/utils/VENDOR.org): vendored files are IMMUTABLE.
# Dojo behaviour extends them from dojo-owned code; nobody edits them in place.
# This catches the accidental one-line "quick fix" that would otherwise only
# surface as a mystery conflict at the next three.js upgrade.
#
#   vendor_verify.sh            check; print drift, exit 1 if any
#   vendor_verify.sh --record   restamp hashes into VENDOR.org (after an upgrade)
#
# Two sources of truth, because there are two kinds of vendored file: files we
# curled are hashed against VENDOR.org; the CM6 bundle we build is hashed
# against the sidecar its own build emits.
cd "$(dirname "$0")/.." || exit 1

MANIFEST="assets/js/utils/VENDOR.org"
FILES=(
    assets/js/utils/three.core.min.js
    assets/js/utils/three.module.min.js
    assets/js/utils/threetext.js
    assets/js/utils/threeorbital.js
    assets/js/utils/three-addons/lines/Line2.js
    assets/js/utils/three-addons/lines/LineGeometry.js
    assets/js/utils/three-addons/lines/LineMaterial.js
    assets/js/utils/three-addons/lines/LineSegments2.js
    assets/js/utils/three-addons/lines/LineSegmentsGeometry.js
    assets/js/utils/earcut.js
    assets/js/utils/mediabunny.min.mjs
)

drift=0
for f in "${FILES[@]}"; do
    base="$(basename "$f")"
    if [ ! -f "$f" ]; then
        echo "MISSING  $f" >&2; drift=1; continue
    fi
    have="$(sha256sum "$f" | cut -c1-16)"
    # The manifest row is `| =name= | status | =hash= |`
    want="$(grep -F "=$base=" "$MANIFEST" | grep -oE '=[0-9a-f]{16}=' | tr -d '=' | head -1)"

    if [ "$1" = "--record" ]; then
        [ -n "$want" ] && [ "$want" != "$have" ] && \
            sed -i "s/=$want=/=$have=/" "$MANIFEST" && echo "restamped $base  $want -> $have"
        continue
    fi

    if [ -z "$want" ]; then
        echo "UNRECORDED  $f — add it to $MANIFEST" >&2; drift=1
    elif [ "$want" != "$have" ]; then
        echo "DRIFTED  $f" >&2
        echo "         manifest $want, on disk $have" >&2
        echo "         vendored files are immutable — put the change in dojo-owned code," >&2
        echo "         or if this was a deliberate upgrade, run: $0 --record" >&2
        drift=1
    fi
done


# --- three.js REVISION -----------------------------------------------------
# VENDOR.org records *Version: =179dev=.* — a claim. Without a check it is a
# comment: a three swap that forgets the doc leaves the doc lying, which is the
# exact failure the CM6 ?v= token was fixed for. Asymmetry with CM6 is deliberate:
# CM6 carries its version to a URL token because the browser loads it that way;
# three is bundled, so the consumption point is the build — no token to bust,
# only a record to keep honest.
THREE_CORE="assets/js/utils/three.core.min.js"

if [ "$1" != "--record" ]; then
    if [ ! -f "$THREE_CORE" ]; then
        echo "MISSING  $THREE_CORE" >&2; drift=1
    else
        # Minified export is `<ident> as REVISION`; the module-level const that
        # seeds it is the first assignment of that ident (three puts REVISION
        # first in the file). Do not hardcode the short name — minifiers rename.
        rev_ident="$(grep -oE '[A-Za-z_$][A-Za-z0-9_$]* as REVISION' "$THREE_CORE" | head -1 | awk '{print $1}')"
        have_rev=""
        if [ -n "$rev_ident" ]; then
            have_rev="$(grep -oE "const ${rev_ident}=\"[^\"]+\"" "$THREE_CORE" | head -1 | sed -E 's/^const [^=]+="//;s/"$//')"
        fi
        # Prose claim in the manifest: *Version: =179dev=.*
        want_rev="$(grep -oE 'Version: =[^=]+=' "$MANIFEST" | head -1 | sed 's/Version: =//;s/=$//')"

        if [ -z "$have_rev" ]; then
            echo "UNREADABLE  $THREE_CORE — could not derive REVISION" >&2
            echo "            expected an export \`<ident> as REVISION\` and a matching const" >&2
            drift=1
        elif [ -z "$want_rev" ]; then
            echo "UNRECORDED  three.js REVISION is $have_rev on disk, but $MANIFEST has no Version: =…= claim" >&2
            echo "            add: *Version: =$have_rev=.*" >&2
            drift=1
        elif [ "$want_rev" != "$have_rev" ]; then
            echo "STALE    $MANIFEST — records Version: =$want_rev=, $THREE_CORE exports REVISION=$have_rev" >&2
            echo "         after a deliberate upgrade, set the Version: claim to =$have_rev=" >&2
            drift=1
        fi
    fi
fi


# --- CM6 -------------------------------------------------------------------
# cm6.js is BUILT, not curled, so its hash is not hand-recorded in VENDOR.org —
# vendor-cm6.mjs emits it into a sidecar. --record cannot restamp that; the only
# honest restamp is a rebuild, which is also what would eat a hand-edit.
CM6="priv/static/vendor/cm6.js"
CM6_MANIFEST="priv/static/vendor/cm6.manifest.json"
CM6_CONSUMER="assets/js/hooks/shell/core.js"

if [ "$1" != "--record" ]; then
    if [ ! -f "$CM6" ] || [ ! -f "$CM6_MANIFEST" ]; then
        echo "MISSING  $CM6 or $CM6_MANIFEST — run: cd scripts && node vendor-cm6.mjs" >&2
        drift=1
    else
        want="$(grep -oE '"sha256"[^"]*"[0-9a-f]{64}"' "$CM6_MANIFEST" | grep -oE '[0-9a-f]{64}')"
        have="$(sha256sum "$CM6" | cut -d' ' -f1)"
        if [ "$want" != "$have" ]; then
            echo "DRIFTED  $CM6" >&2
            echo "         manifest $want" >&2
            echo "         on disk  $have" >&2
            echo "         this file is generated — the next rebuild eats any hand-edit." >&2
            echo "         put the change in cm6-entry.js or dojo code, then:" >&2
            echo "         cd scripts && node vendor-cm6.mjs" >&2
            drift=1
        fi

        # A matching artifact hash only says nobody edited the bundle. This says
        # the bundle was built from the lockfile that sits beside it.
        want_l="$(grep -oE '"lockfileHash"[^"]*"[0-9a-f]{64}"' "$CM6_MANIFEST" | grep -oE '[0-9a-f]{64}')"
        have_l="$(sha256sum scripts/package-lock.json | cut -d' ' -f1)"
        if [ "$want_l" != "$have_l" ]; then
            echo "UNBUILT  scripts/package-lock.json changed since cm6.js was built" >&2
            echo "         manifest $want_l" >&2
            echo "         on disk  $have_l" >&2
            echo "         rebuild so the artifact matches its deps:" >&2
            echo "         cd scripts && npm install && node vendor-cm6.mjs" >&2
            drift=1
        fi

        # The ?v= token is a version claim. A claim nobody verified gets trusted.
        # It is content-addressed (version + bundle sha), so it also busts the
        # browser cache when the bytes move under an unchanged version.
        want_v="$(grep -oE '"token"[^"]*"[^"]+"' "$CM6_MANIFEST" | sed 's/.*"token"[^"]*"\([^"]*\)"/\1/')"
        have_v="$(grep -oE "vendor/cm6\.js\?v=[^'\"]+" "$CM6_CONSUMER" | head -1 | sed 's/.*?v=//')"
        if [ "$want_v" != "$have_v" ]; then
            line="$(grep -nF "vendor/cm6.js?v=" "$CM6_CONSUMER" | head -1 | cut -d: -f1)"
            echo "STALE    $CM6_CONSUMER:$line — cm6 import says v=$have_v, built bundle is $want_v" >&2
            echo "         change that line to: /vendor/cm6.js?v=$want_v" >&2
            drift=1
        fi
    fi
fi

[ "$1" = "--record" ] && exit 0
exit $drift
