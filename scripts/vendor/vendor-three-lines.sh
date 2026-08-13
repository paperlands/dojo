#!/usr/bin/env bash
# Drop pristine three.js fat-line addons into utils/three-addons/lines/.
#
#   vendor-three-lines.sh [tag]     default tag: r185 (match core REVISION)
#
# Bodies come from upstream examples/jsm/lines/* with ONE mechanical rewrite:
#   from 'three'  →  from '../../three.module.min.js'
# Sibling imports (../lines/X) stay pristine — the files live in a dir named
# lines/, matching upstream layout. GrowLine is dojo-owned and is not touched.
#
# After a successful drop, restamp hashes:
#   ./scripts/verify/vendor_verify.sh --record
set -euo pipefail
cd "$(dirname "$0")/../.." || exit 1

TAG="${1:-r185}"
DEST="assets/js/utils/three-addons/lines"
BASE="https://raw.githubusercontent.com/mrdoob/three.js/${TAG}/examples/jsm/lines"
FILES=(Line2.js LineGeometry.js LineMaterial.js LineSegments2.js LineSegmentsGeometry.js)

mkdir -p "$DEST"
for f in "${FILES[@]}"; do
    echo "fetch  $TAG  $f"
    curl -fsSL "$BASE/$f" -o "$DEST/$f"
done

# The one rewrite. Do not hand-edit the files for anything else.
sed -i "s|from 'three'|from '../../three.module.min.js'|" "$DEST"/*.js

echo
echo "dropped $TAG into $DEST (bodies + one import rewrite)."
echo "restamp hashes:  ./scripts/verify/vendor_verify.sh --record"
echo "then check:      ./scripts/verify/vendor_verify.sh"
echo "and:             node --test test/js/render/growline_test.mjs test/js/seams/vendor_test.mjs"
