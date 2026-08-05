#!/usr/bin/env bash
# Exercises await-deployment.sh against a stubbed gh CLI.
#
# The behaviour that matters here is a failure path: when the site deployment fails, the workflow
# that published the snapshot has to fail too. Reproducing that against the real repository would
# mean deliberately breaking the production deployment, so the gh calls are stubbed instead and
# every branch of the script is driven directly.
#
# The stub records every invocation so the scenarios can assert what was asked for, not only what
# the script concluded. In particular they assert that the deployment is identified by the id the
# dispatch reported, so a regression back to "dispatch, then adopt the newest run" is caught.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/await-deployment.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/bin"
cat >"$work/bin/gh" <<'STUB'
#!/usr/bin/env bash
state_dir="$STUB_STATE"
printf '%s\n' "$*" >>"$state_dir/calls"
case "$1" in
  api)
    echo $(( $(cat "$state_dir/dispatch_calls") + 1 )) >"$state_dir/dispatch_calls"
    staged="$state_dir/run_id_$(cat "$state_dir/dispatch_calls")"
    if [ -f "$staged" ]; then
      cat "$staged"
      exit 0
    fi
    cat "$state_dir/dispatch_response"
    exit "$(cat "$state_dir/dispatch_status")"
    ;;
  run)
    calls=$(( $(cat "$state_dir/view_calls") + 1 ))
    echo "$calls" >"$state_dir/view_calls"
    staged="$state_dir/conclusion_$(cat "$state_dir/dispatch_calls")"
    if [ -f "$staged" ]; then
      echo "completed $(cat "$staged") deadbeef"
      exit 0
    fi
    if [ -f "$state_dir/view_fail_until" ] && [ "$calls" -le "$(cat "$state_dir/view_fail_until")" ]; then
      echo "gh: transient error" >&2
      exit 1
    fi
    if [ "$calls" -lt "$(cat "$state_dir/completes_on_call")" ]; then
      echo "in_progress - deadbeef"
    else
      echo "completed $(cat "$state_dir/conclusion") deadbeef"
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
  local state="$1" timeout="$2" response="$3" status="$4" completes="$5" conclusion="$6"
  local view_fail="$7"
  rm -rf "$state"; mkdir -p "$state"
  echo 0 >"$state/view_calls"
  echo 0 >"$state/dispatch_calls"
  echo "$completes" >"$state/completes_on_call"
  echo "$conclusion" >"$state/conclusion"
  printf '%s' "$response" >"$state/dispatch_response"
  echo "$status" >"$state/dispatch_status"
  [ "$view_fail" -gt 0 ] && echo "$view_fail" >"$state/view_fail_until"
  : >"$state/calls"

  PATH="$work/bin:$PATH" \
  STUB_STATE="$state" \
  GH_TOKEN=stub GITHUB_REPOSITORY=o/r WORKFLOW=pages.yml BRANCH=main \
  TIMEOUT_MINUTES="$timeout" GITHUB_SERVER_URL=https://github.com POLL_SECONDS=0 \
  bash "$script" 2>&1
}

scenario() {
  local name="$1" expected="$2" conclusion="$3" completes="$4" timeout="$5"
  local view_fail="${6:-0}" response="${7-\{\"workflow_run_id\":4242\}}" status="${8:-0}"
  local state="$work/state" out actual calls

  out=$(run_script "$state" "$timeout" "$response" "$status" "$completes" "$conclusion" "$view_fail")
  actual=$?
  calls="$(cat "$state/calls")"

  echo "--- $name (exit $actual, expected $expected)"
  check "$name exit code" "$([ "$actual" -eq "$expected" ] && echo ok)"

  # The dispatch must target the requested workflow and branch on the requested repository.
  check "$name dispatches the requested workflow" \
    "$(grep -q 'repos/o/r/actions/workflows/pages.yml/dispatches' <<<"$calls" && echo ok)"
  check "$name dispatches the requested branch" "$(grep -q 'ref=main' <<<"$calls" && echo ok)"
  check "$name pins the API version that reports the run id" \
    "$(grep -q 'X-GitHub-Api-Version: 2026-03-10' <<<"$calls" && echo ok)"

  # Reads must name the run the dispatch reported, never a run discovered by listing.
  check "$name never lists runs to guess the deployment" \
    "$(grep -q 'run list' <<<"$calls" && echo no || echo ok)"
  if grep -q 'run view' <<<"$calls"; then
    check "$name reads only the dispatched run" \
      "$(grep 'run view' <<<"$calls" | grep -qv 'run view 4242 ' && echo no || echo ok)"
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

scenario "success deploys and passes"          0 success   1    30
scenario "failed deployment fails caller"      1 failure   1    30
scenario "cancellation past the deadline fails" 1 cancelled 1    0
scenario "timed out deployment fails caller"   1 timed_out 1    30
scenario "run never completes times out"        1 success   9999 0
scenario "transient view errors are retried"   0 success   3    30 2

# A dispatch that does not report a run id must fail rather than fall back to guessing.
scenario "dispatch without a run id fails"     1 success   1    30 0 '{}'
scenario "dispatch with a junk run id fails"   1 success   1    30 0 '{"workflow_run_id":"nope"}'
scenario "empty dispatch response fails"       1 success   1    30 0 ''
scenario "rejected dispatch fails"             1 success   1    30 0 '{"message":"Not Found"}' 1

# The diagnostics have to say which side broke, otherwise a scheduled failure is unactionable.
# Asserting the message also proves each scenario failed for the reason it claims: an exit code
# alone would accept a script that aborted early on an unrelated shell error.
message=$(run_script "$work/state" 30 '{"workflow_run_id":4242}' 0 1 failure 0)
expect_message "failure diagnostic" "::error::" "$message"
expect_message "failure diagnostic" "finished as 'failure'" "$message"
expect_message "failure diagnostic" "still serves the previous snapshot" "$message"
expect_message "failure diagnostic" "https://github.com/o/r/actions/runs/4242" "$message"

message=$(run_script "$work/state" 0 '{"workflow_run_id":4242}' 0 9999 success 0)
expect_message "timeout diagnostic" "::error::" "$message"
expect_message "timeout diagnostic" "did not finish within" "$message"
expect_message "timeout diagnostic" "the site may still serve the previous snapshot" "$message"

message=$(run_script "$work/state" 30 '{"workflow_run_id":4242}' 0 1 success 0)
expect_message "success log" "Deployment 4242 succeeded" "$message"

# A cancelled run means this deployment never happened, so it is retried rather than trusted. The
# usual cause is benign - a push supersedes the queued deployment - and retrying converges on a
# real answer instead of raising a false alarm.
staged_run() {
  local state="$work/state" timeout="$1"
  rm -rf "$state"; mkdir -p "$state"
  echo 0 >"$state/view_calls"; echo 0 >"$state/dispatch_calls"
  echo 1 >"$state/completes_on_call"; echo success >"$state/conclusion"
  printf '{"workflow_run_id":4242}' >"$state/dispatch_response"; echo 0 >"$state/dispatch_status"
  printf '{"workflow_run_id":4242}' >"$state/run_id_1"
  printf '{"workflow_run_id":5353}' >"$state/run_id_2"
  echo cancelled >"$state/conclusion_1"
  echo "$2" >"$state/conclusion_2"
  : >"$state/calls"
  PATH="$work/bin:$PATH" STUB_STATE="$state" GH_TOKEN=stub GITHUB_REPOSITORY=o/r \
  WORKFLOW=pages.yml BRANCH=main TIMEOUT_MINUTES="$timeout" \
  GITHUB_SERVER_URL=https://github.com POLL_SECONDS=0 bash "$script" 2>&1
}

message=$(staged_run 30 success); actual=$?
check "cancelled run is retried and then succeeds" "$([ "$actual" -eq 0 ] && echo ok)"
expect_message "cancelled retry" "was cancelled" "$message"
expect_message "cancelled retry" "Deployment 5353 succeeded" "$message"
check "cancelled retry dispatches a second deployment" \
  "$([ "$(grep -c 'dispatches' "$work/state/calls")" -eq 2 ] && echo ok)"
check "cancelled retry watches the newly dispatched run" \
  "$(grep -q 'run view 5353 ' "$work/state/calls" && echo ok)"

message=$(staged_run 30 failure); actual=$?
check "retry that fails still fails the caller" "$([ "$actual" -eq 1 ] && echo ok)"
expect_message "cancelled then failed" "finished as 'failure'" "$message"

# The retry is bounded: once the deadline passes, a cancellation is reported rather than retried.
message=$(staged_run 0 success); actual=$?
check "cancellation past the deadline fails the caller" "$([ "$actual" -eq 1 ] && echo ok)"
expect_message "cancelled past deadline" "finished as 'cancelled'" "$message"

echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
