#!/usr/bin/env bash
# Exercises await-analysis.sh against a stubbed gh CLI.
#
# The behaviour that matters is what the script refuses to hand on. A failed, cancelled, or unfinished
# analysis must never reach the publisher, and a run that succeeds must always reach it. Reproducing
# those against the real repository would mean deliberately breaking the analysis, so the gh calls are
# stubbed and every branch is driven directly.
#
# The stub records every invocation, so the scenarios can assert which run was read rather than only
# what the script concluded.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/await-analysis.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin"
cat >"$work/bin/gh" <<'STUB'
#!/usr/bin/env bash
state_dir="$STUB_STATE"
printf '%s\n' "$*" >>"$state_dir/calls"
case "$1" in
  run)
    calls=$(( $(cat "$state_dir/view_calls") + 1 ))
    echo "$calls" >"$state_dir/view_calls"
    if [ -f "$state_dir/view_fail_until" ] && [ "$calls" -le "$(cat "$state_dir/view_fail_until")" ]; then
      echo "gh: transient error" >&2
      exit 1
    fi
    if [ "$calls" -lt "$(cat "$state_dir/completes_on_call")" ]; then
      echo "in_progress -"
    else
      echo "completed $(cat "$state_dir/conclusion")"
    fi
    exit 0
    ;;
esac
echo "unexpected gh invocation: $*" >&2
exit 1
STUB
chmod +x "$work/bin/gh"

pass=0
fail=0

check() {
  local label="$1" condition="$2"
  if [ "$condition" = "ok" ]; then
    pass=$(( pass + 1 ))
  else
    echo "FAIL  $label"
    fail=$(( fail + 1 ))
  fi
}

run_script() {
  local state="$1" timeout="$2" completes="$3" conclusion="$4" view_fail="$5" run_id="${6-4242}"
  rm -rf "$state"; mkdir -p "$state"
  echo 0 >"$state/view_calls"
  echo "$completes" >"$state/completes_on_call"
  echo "$conclusion" >"$state/conclusion"
  [ "$view_fail" -gt 0 ] && echo "$view_fail" >"$state/view_fail_until"
  : >"$state/calls"
  : >"$state/output"

  PATH="$work/bin:$PATH" \
  STUB_STATE="$state" \
  GH_TOKEN=stub GITHUB_REPOSITORY=o/r RUN_ID="$run_id" \
  TIMEOUT_MINUTES="$timeout" GITHUB_SERVER_URL=https://github.com POLL_SECONDS=0 \
  GITHUB_OUTPUT="$state/output" \
  bash "$script" 2>&1
}

scenario() {
  local name="$1" expected="$2" conclusion="$3" completes="$4" timeout="$5"
  local view_fail="${6:-0}" run_id="${7-4242}"
  local state="$work/state" out actual calls published

  out=$(run_script "$state" "$timeout" "$completes" "$conclusion" "$view_fail" "$run_id")
  actual=$?
  calls="$(cat "$state/calls")"
  published="$(cat "$state/output")"

  echo "--- $name (exit $actual, expected $expected)"
  check "$name exit code" "$([ "$actual" -eq "$expected" ] && echo ok)"

  # Handing the run on is the whole point of the step, so it is asserted directly rather than
  # inferred from the exit code: a script that exited 0 without writing the id would leave the
  # publisher unreachable exactly like the bug this gate exists to prevent.
  if [ "$expected" -eq 0 ]; then
    check "$name hands the run to the publisher" \
      "$([ "$published" = "run-id=$run_id" ] && echo ok)"
  else
    check "$name hands nothing to the publisher" "$([ -z "$published" ] && echo ok)"
  fi

  # Reads must name the run that was dispatched, never a run discovered by listing.
  check "$name never lists runs to guess the analysis" \
    "$(grep -q 'run list' <<<"$calls" && echo no || echo ok)"
  if grep -q 'run view' <<<"$calls"; then
    check "$name reads only the requested run" \
      "$(grep 'run view' <<<"$calls" | grep -qv "run view $run_id " && echo no || echo ok)"
  fi

  # The workflow command prefix is stripped before echoing: these are expected failures from a stub,
  # and leaving them intact makes a passing CI run display red error annotations.
  echo "$out" | sed -e 's/::error::/(expected error) /g' -e 's/^/        /'
  echo
}

expect_message() {
  local label="$1" needle="$2" haystack="$3"
  check "$label mentions \"$needle\"" "$(grep -qF "$needle" <<<"$haystack" && echo ok)"
}

scenario "successful analysis is published"      0 success    1    90
scenario "failed analysis is not published"      1 failure    1    90
scenario "cancelled analysis is not published"   1 cancelled  1    90
scenario "timed out analysis is not published"   1 timed_out  1    90
scenario "skipped analysis is not published"     1 skipped    1    90
scenario "run never completes times out"         1 success    9999 0
scenario "transient view errors are retried"     0 success    3    90 2
# A run id that is not a run id must fail rather than be forwarded to the publisher, which would
# otherwise spend a job proving the same thing.
scenario "non-numeric run id fails"              1 success    1    90 0 "not-a-run"
scenario "empty run id fails"                    1 success    1    90 0 ""

# The diagnostics have to say which side broke, otherwise a scheduled failure is unactionable.
# Asserting the message also proves each scenario failed for the reason it claims: an exit code alone
# would accept a script that aborted early on an unrelated shell error.
message=$(run_script "$work/state" 90 1 failure 0)
expect_message "failure diagnostic" "::error::" "$message"
expect_message "failure diagnostic" "finished as 'failure'" "$message"
expect_message "failure diagnostic" "The snapshot itself is published and deployed" "$message"
expect_message "failure diagnostic" "https://github.com/o/r/actions/runs/4242" "$message"

message=$(run_script "$work/state" 0 9999 success 0)
expect_message "timeout diagnostic" "::error::" "$message"
expect_message "timeout diagnostic" "did not finish within" "$message"

message=$(run_script "$work/state" 90 1 success 0)
expect_message "success log" "Analysis run 4242 succeeded" "$message"

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
