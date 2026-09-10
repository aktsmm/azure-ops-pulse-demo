#!/usr/bin/env bash
# All test state stays in the checkout; the gh/date stubs never contact GitHub.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$PWD/.candidate/semantic-wait-scenarios-$$"
mkdir -p "$work/bin"
trap 'rm -rf "$work"' EXIT
cat > "$work/bin/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$STUB_STATE/calls"
if [[ "$*" == *" -X POST "* ]]; then
  [[ "$*" == *"ref=main"* && "$*" == *"inputs[publication-run-id]=1234"* ]] || exit 11
  [[ "$*" == *"review-ai-insights.lock.yml/dispatches"* ]] || exit 12
  case "$SCENARIO" in
    dispatch-failure) exit 1 ;;
    missing-id) echo '{}' ;;
    malformed-id) echo '{"workflow_run_id":"5678"}' ;;
    same-run) echo '{"workflow_run_id":1234}' ;;
    *) echo '{"workflow_run_id":5678}' ;;
  esac
  exit 0
fi
[ "$*" = "api repos/o/r/actions/runs/5678" ] || exit 13
count=$(cat "$STUB_STATE/reads")
echo "$((count + 1))" > "$STUB_STATE/reads"
if [ "$SCENARIO" = transient ] && [ "$count" -eq 0 ]; then exit 1; fi
if [ "$SCENARIO" = unreadable ]; then exit 1; fi
if [ "$SCENARIO" = malformed ]; then echo '{'; exit 0; fi
id=5678 branch=main repo=o/r source=o/r path=.github/workflows/review-ai-insights.lock.yml
event=workflow_dispatch title="Semantic review publication 1234" status=completed conclusion=success
case "$SCENARIO" in
  wrong-id) id=9999 ;;
  wrong-branch) branch=feature ;;
  wrong-repo) repo=other/repo ;;
  wrong-source) source=other/repo ;;
  wrong-path) path=.github/workflows/ai-insights.lock.yml ;;
  wrong-event) event=push ;;
  wrong-input) title="Semantic review publication 9999" ;;
  failed) conclusion=failure ;;
  cancelled) conclusion=cancelled ;;
  timed-out) conclusion=timed_out ;;
  skipped) conclusion=skipped ;;
  waiting) status=in_progress; conclusion=null ;;
esac
jq -n --argjson id "$id" --arg branch "$branch" --arg repo "$repo" --arg source "$source" \
  --arg path "$path" --arg event "$event" --arg title "$title" --arg status "$status" \
  --arg conclusion "$conclusion" \
  '{id:$id,head_branch:$branch,repository:{full_name:$repo},head_repository:{full_name:$source},
    path:$path,event:$event,display_title:$title,status:$status,conclusion:$conclusion}'
STUB
cat > "$work/bin/date" <<'STUB'
#!/usr/bin/env bash
count=$(cat "$STUB_STATE/clock")
echo "$((count + 1))" > "$STUB_STATE/clock"
echo "$((count * 60))"
STUB
chmod +x "$work/bin/gh" "$work/bin/date"
passed=0
scenario() {
  local name="$1" expected="$2" message="$3" timeout="${4:-1}" actual=0
  mkdir -p "$work/state"
  : > "$work/state/calls"; : > "$work/state/output"
  echo 0 > "$work/state/reads"; echo 0 > "$work/state/clock"
  PATH="$work/bin:$PATH" STUB_STATE="$work/state" SCENARIO="$name" \
    GH_TOKEN=stub GITHUB_REPOSITORY=o/r PUBLICATION_RUN_ID=1234 BRANCH=main \
    TIMEOUT_MINUTES="$timeout" POLL_SECONDS=0 GITHUB_OUTPUT="$work/state/output" \
    bash "$here/await-review.sh" > "$work/state/log" 2>&1 || actual=$?
  if [ "$actual" -ne "$expected" ]; then
    cat "$work/state/log"; echo "FAIL $name: exit $actual"; exit 1
  fi
  if [ "$expected" -eq 0 ]; then
    [ "$(cat "$work/state/output")" = run-id=5678 ]
  else
    [ ! -s "$work/state/output" ]
    grep -qF "$message" "$work/state/log"
  fi
  ! grep -qE 'run list|workflow run' "$work/state/calls"
  ! grep 'api repos/o/r/actions/runs/' "$work/state/calls" | grep -qv 'runs/5678$'
  echo "PASS $name (exact run, fail-closed handoff)"
  passed=$((passed + 1))
}
scenario success 0 ""
scenario transient 0 "" 2
scenario dispatch-failure 1 "Could not dispatch"
scenario missing-id 1 "exact run id"
scenario malformed-id 1 "exact run id"
scenario same-run 1 "independent run"
for case in wrong-id wrong-branch wrong-repo wrong-source wrong-path wrong-event wrong-input malformed; do
  scenario "$case" 1 "provenance mismatch"
done
for case in failed cancelled timed-out skipped; do
  scenario "$case" 1 "did not succeed"
done
scenario waiting 1 "did not finish within"
scenario unreadable 1 "did not finish within"
scenario bad-timeout 1 "Invalid review timeout" 0
scenario excessive-timeout 1 "exceeds 60 minutes" 61
echo "passed=$passed failed=0"
