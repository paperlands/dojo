#!/usr/bin/env bash
# Pair dojo ↔ specs (nested repo): same branch name, pin file is the tip.
#
# Daily path is git hooks (core.hooksPath=scripts/githooks). This script is
# what they call — and what you run by hand when a hook refused (dirty tree).
#
#   specs_sync.sh              drift check; exit 1 if misaligned
#   specs_sync.sh --status     one-liner
#   specs_sync.sh --sync       mirror dojo branch name onto specs (no SHA move)
#   specs_sync.sh --checkout   restore specs to specs.lock SHA (safe ff only)
#   specs_sync.sh --record     write specs.lock from specs HEAD (also pre-commit)
#   specs_sync.sh --install    git config core.hooksPath scripts/githooks
#
# Env:
#   SPECS_SYNC_FORCE=1  --checkout may reset on diverge (never discards dirty)
#   SPECS_SYNC_QUIET=1  hooks: suppress "aligned" chatter
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPECS="$ROOT/specs"
LOCK="$ROOT/specs.lock"
cd "$ROOT"

die() { echo "specs_sync: $*" >&2; exit 1; }
msg() { echo "specs_sync: $*" >&2; }
have_specs() { [ -d "$SPECS/.git" ]; }

dojo_branch() {
  git -C "$ROOT" branch --show-current
}

specs_branch() {
  git -C "$SPECS" branch --show-current
}

specs_head() {
  git -C "$SPECS" rev-parse HEAD
}

specs_dirty() {
  [ -n "$(git -C "$SPECS" status --porcelain)" ]
}

lock_conflicted() {
  # merge conflict markers — naive ^sha= would pick "ours" and look like a real pin
  [ -f "$LOCK" ] && grep -q '^<<<<<<< ' "$LOCK"
}

read_lock() {
  # sets LOCK_BRANCH LOCK_SHA (empty if missing)
  LOCK_BRANCH=""
  LOCK_SHA=""
  [ -f "$LOCK" ] || return 0
  if lock_conflicted; then
    LOCK_BRANCH=""
    LOCK_SHA=""
    return 0
  fi
  LOCK_BRANCH="$(grep -E '^branch=' "$LOCK" | head -1 | cut -d= -f2- || true)"
  LOCK_SHA="$(grep -E '^sha=' "$LOCK" | head -1 | cut -d= -f2- || true)"
}

write_lock() {
  local branch="$1" sha="$2"
  cat >"$LOCK" <<EOF
# Paired constellation tip. Hooks restamp on commit; hand: specs_sync.sh --record
branch=$branch
sha=$sha
EOF
}

cmd_status() {
  have_specs || { msg "no specs/.git — skip"; return 0; }
  if lock_conflicted; then
    echo "dojo=$(dojo_branch) specs=$(specs_branch) head=$(specs_head | cut -c1-12) pin=conflict"
    return 0
  fi
  read_lock
  local db sb sh
  db="$(dojo_branch)"
  sb="$(specs_branch)"
  sh="$(specs_head)"
  local pin="${LOCK_SHA:-∅}"
  local align="drift"
  # aligned only when tip + branch names agree, and lock.branch (if set) names dojo
  if [ -n "$LOCK_SHA" ] && [ "$sh" = "$LOCK_SHA" ] && [ -n "$db" ] && [ "$db" = "$sb" ] \
    && { [ -z "$LOCK_BRANCH" ] || [ "$LOCK_BRANCH" = "$db" ]; }; then
    align="ok"
  fi
  echo "dojo=$db specs=$sb head=${sh:0:12} pin=${pin:0:12} $align"
  if [ -n "$LOCK_BRANCH" ] && [ -n "$db" ] && [ "$LOCK_BRANCH" != "$db" ]; then
    echo "lock.branch=$LOCK_BRANCH (stale vs dojo)"
  fi
  if specs_dirty; then
    echo "specs worktree: dirty"
  fi
}

cmd_record() {
  have_specs || die "no specs/.git"
  local sb sh
  sb="$(specs_branch)"
  sh="$(specs_head)"
  [ -n "$sb" ] || die "specs is detached HEAD — switch to a branch before recording"
  write_lock "$sb" "$sh"
  msg "recorded branch=$sb sha=${sh:0:12}"
  if specs_dirty; then
    msg "note: specs has uncommitted work; pin is HEAD only"
  fi
}

cmd_sync() {
  have_specs || die "no specs/.git"
  local db sb
  db="$(dojo_branch)"
  [ -n "$db" ] || die "dojo is detached HEAD — no branch to mirror"
  sb="$(specs_branch)"

  if [ "$sb" = "$db" ]; then
    [ -z "${SPECS_SYNC_QUIET:-}" ] && msg "already on $db"
    return 0
  fi

  if specs_dirty; then
    # switch often still works with dirty; try, but refuse create-from-wrong-base ambiguity
    if git -C "$SPECS" show-ref --verify --quiet "refs/heads/$db"; then
      git -C "$SPECS" switch "$db" || die "dirty worktree blocks switch to $db — commit or stash in specs/"
    else
      git -C "$SPECS" switch -c "$db" || die "dirty worktree blocks creating $db — commit or stash in specs/"
    fi
  else
    if git -C "$SPECS" show-ref --verify --quiet "refs/heads/$db"; then
      git -C "$SPECS" switch "$db"
    else
      git -C "$SPECS" switch -c "$db"
      msg "created specs branch $db at $(specs_head | cut -c1-12)"
    fi
  fi
  msg "specs → $(specs_branch)"
}

# Restore to pin. Fast-forward when behind; leave alone when ahead; refuse diverge unless FORCE.
cmd_checkout() {
  have_specs || die "no specs/.git"
  lock_conflicted && die "specs.lock has conflict markers — resolve, then --checkout or --record"
  read_lock
  [ -n "$LOCK_SHA" ] || die "no sha= in specs.lock — nothing to restore"
  git -C "$SPECS" cat-file -e "$LOCK_SHA^{commit}" 2>/dev/null \
    || die "pin sha $LOCK_SHA not in specs repo (fetch/reflog?)"

  if specs_dirty; then
    die "specs worktree dirty — commit or stash before --checkout"
  fi

  local target_branch db
  db="$(dojo_branch)"
  target_branch="${LOCK_BRANCH:-$db}"
  [ -n "$target_branch" ] || die "no branch in lock and dojo detached"

  if ! git -C "$SPECS" show-ref --verify --quiet "refs/heads/$target_branch"; then
    git -C "$SPECS" branch "$target_branch" "$LOCK_SHA"
    msg "created specs branch $target_branch at ${LOCK_SHA:0:12}"
  fi
  git -C "$SPECS" switch "$target_branch"

  local sh
  sh="$(specs_head)"
  if [ "$sh" = "$LOCK_SHA" ]; then
    [ -z "${SPECS_SYNC_QUIET:-}" ] && msg "specs already at pin ${LOCK_SHA:0:12}"
    return 0
  fi

  if git -C "$SPECS" merge-base --is-ancestor "$sh" "$LOCK_SHA"; then
    # behind pin — fast-forward
    git -C "$SPECS" merge --ff-only "$LOCK_SHA"
    msg "fast-forwarded $target_branch → ${LOCK_SHA:0:12}"
    return 0
  fi

  if git -C "$SPECS" merge-base --is-ancestor "$LOCK_SHA" "$sh"; then
    msg "specs ahead of pin (${sh:0:12} vs ${LOCK_SHA:0:12}) — leaving tip; pre-commit will restamp"
    return 0
  fi

  # diverged
  if [ "${SPECS_SYNC_FORCE:-}" = "1" ]; then
    git -C "$SPECS" reset --hard "$LOCK_SHA"
    msg "FORCE reset $target_branch → ${LOCK_SHA:0:12}"
    return 0
  fi
  die "specs diverged from pin (head ${sh:0:12}, pin ${LOCK_SHA:0:12}) — merge in specs/ or SPECS_SYNC_FORCE=1"
}

cmd_check() {
  have_specs || return 0
  if lock_conflicted; then
    msg "DRIFT  specs.lock has conflict markers — resolve before pairing"
    return 1
  fi
  read_lock
  local db sb sh drift=0
  db="$(dojo_branch)"
  sb="$(specs_branch)"
  sh="$(specs_head)"

  if [ -z "$LOCK_SHA" ]; then
    msg "DRIFT  no specs.lock — run: bash scripts/verify/specs_sync.sh --record"
    drift=1
  else
    if [ "$sh" != "$LOCK_SHA" ]; then
      msg "DRIFT  specs HEAD ${sh:0:12} ≠ pin ${LOCK_SHA:0:12}"
      drift=1
    fi
    if [ -n "$db" ] && [ -n "$sb" ] && [ "$db" != "$sb" ]; then
      msg "DRIFT  branch dojo=$db specs=$sb"
      drift=1
    fi
    if [ -n "$LOCK_BRANCH" ] && [ -n "$db" ] && [ "$LOCK_BRANCH" != "$db" ]; then
      msg "DRIFT  specs.lock branch=$LOCK_BRANCH ≠ dojo=$db (stale/untracked lock?)"
      drift=1
    fi
  fi
  if specs_dirty; then
    msg "note: specs worktree dirty (pin is HEAD-only)"
  fi
  [ "$drift" -eq 0 ]
}

cmd_install() {
  git -C "$ROOT" config core.hooksPath scripts/githooks
  msg "core.hooksPath=scripts/githooks"
  msg "hooks: post-checkout post-merge pre-commit"
}

# --- hook entrypoints -------------------------------------------------------

# After mirror: restore pin SHA only when lock names this dojo branch.
# Otherwise cmd_checkout's LOCK_BRANCH would undo cmd_sync (stale/untracked lock).
hook_pin_restore() {
  local when="$1"
  lock_conflicted && {
    msg "specs.lock conflicted — resolve, then --checkout or --record"
    return 0
  }
  if [ ! -f "$LOCK" ]; then
    return 0
  fi
  read_lock
  local db
  db="$(dojo_branch)"
  # Stale/untracked lock from another branch follows the worktree until first
  # commit; never let it yank specs off the mirrored branch. Warn so hand
  # --checkout is not run blind.
  if [ -n "$LOCK_BRANCH" ] && [ -n "$db" ] && [ "$LOCK_BRANCH" != "$db" ]; then
    msg "specs.lock names branch=$LOCK_BRANCH but dojo is $db — pin restore skipped (commit the lock on its feel, or --record here)"
    return 0
  fi
  if ! specs_dirty; then
    if [ -n "$LOCK_SHA" ]; then
      cmd_checkout || msg "after ${when}: resolve by hand (see above)"
    fi
  else
    local sh
    sh="$(specs_head)"
    if [ -n "$LOCK_SHA" ] && [ "$sh" != "$LOCK_SHA" ]; then
      msg "pin drift + dirty specs — commit/stash, then: bash scripts/verify/specs_sync.sh --checkout"
    fi
  fi
}

hook_post_checkout() {
  # args from git: prevHEAD newHEAD flag (1=branch)
  local flag="${1:-1}"
  [ "$flag" = "1" ] || exit 0
  have_specs || exit 0
  export SPECS_SYNC_QUIET=1
  cmd_sync || true
  hook_pin_restore "checkout"
}

hook_post_merge() {
  have_specs || exit 0
  export SPECS_SYNC_QUIET=1
  cmd_sync || true
  if specs_dirty && [ -f "$LOCK" ]; then
    msg "merged dojo; specs dirty — commit/stash, then --checkout or --record"
    return 0
  fi
  hook_pin_restore "merge"
}

hook_pre_commit() {
  have_specs || exit 0
  lock_conflicted && die "specs.lock has conflict markers — resolve before commit"
  local db sb sh
  db="$(dojo_branch)"
  sb="$(specs_branch)"
  # Mirror quietly if names differ and switch is safe
  if [ -n "$db" ] && [ -n "$sb" ] && [ "$db" != "$sb" ]; then
    msg "branch mismatch dojo=$db specs=$sb — run --sync before commit"
    exit 1
  fi
  sh="$(specs_head)"
  read_lock
  if [ "$sh" = "${LOCK_SHA:-}" ] && [ "${LOCK_BRANCH:-}" = "$sb" ]; then
    exit 0
  fi
  # Restamp and stage so this commit carries the pair
  [ -n "$sb" ] || die "specs detached — switch to a branch before committing dojo"
  write_lock "$sb" "$sh"
  git -C "$ROOT" add "$LOCK"
  msg "pre-commit: restamped specs.lock → ${sh:0:12}"
  if specs_dirty; then
    msg "note: specs has uncommitted work; pin is HEAD only"
  fi
}

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  ""|--check) cmd_check ;;
  --status) cmd_status ;;
  --sync) cmd_sync ;;
  --checkout) cmd_checkout ;;
  --record) cmd_record ;;
  --install) cmd_install ;;
  # git hooks pass their argv through; post-checkout: prev new flag
  --hook-post-checkout) hook_post_checkout "${4:-1}" ;;
  --hook-post-merge) hook_post_merge ;;
  --hook-pre-commit) hook_pre_commit ;;
  -h|--help) usage ;;
  *) die "unknown arg: $1 (try --help)" ;;
esac
