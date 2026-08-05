#!/usr/bin/env bash
# Dispatches the deployment workflow and fails unless that deployment succeeds.
#
# Publishing a snapshot to the default branch is not the same as serving it. Without this gate a
# failed deployment leaves the site quietly showing the previous snapshot while the branch claims a
# newer one, and nobody finds out until someone happens to read the run history.
#
# The publishing push uses GITHUB_TOKEN, which by design does not trigger further workflows, so the
# deployment only happens because of the dispatch below.
#
# Environment:
#   GH_TOKEN            token used for the dispatch and the run reads
#   GITHUB_REPOSITORY   owner/repo the deployment belongs to
#   WORKFLOW            workflow file that deploys the site
#   BRANCH              branch to deploy
#   TIMEOUT_MINUTES     how long to keep trying before giving up and failing
#   POLL_SECONDS        optional gap between run reads; only lowered by the scenario tests
set -euo pipefail

poll_seconds="${POLL_SECONDS:-15}"
deadline=$(( $(date +%s) + TIMEOUT_MINUTES * 60 ))
server="${GITHUB_SERVER_URL:-https://github.com}"

fail() {
  echo "::error::$1"
  exit 1
}

# Sets the global run_id to the run this dispatch created. It assigns rather than prints because a
# command substitution would swallow both the diagnostics and the exit on failure.
# The endpoint reports the id from API version 2026-03-10 onwards, so the run is identified exactly
# rather than inferred from timing. Inferring it - dispatch, then adopt the newest run - can adopt a
# run that was allocated just before the dispatch and therefore builds a pre-publication commit,
# which would report success while the real deployment is still queued.
dispatch_run() {
  local response failed=""
  run_id=""
  response=$(gh api -X POST \
    "repos/$GITHUB_REPOSITORY/actions/workflows/$WORKFLOW/dispatches" \
    -H "X-GitHub-Api-Version: 2026-03-10" \
    -f "ref=$BRANCH" 2>&1) || failed=1

  if [[ "$response" =~ \"workflow_run_id\"[[:space:]]*:[[:space:]]*([1-9][0-9]*) ]]; then
    run_id="${BASH_REMATCH[1]}"
  fi
  if [ -n "$failed" ] || [ -z "$run_id" ]; then
    fail "Dispatching $WORKFLOW for $BRANCH did not report a deployment run, so this publication cannot be verified and the site may keep serving the previous snapshot. Response: $response"
  fi
}

# Polling for up to TIMEOUT_MINUTES means many API calls, so transient read failures are retried
# rather than aborting. The deadline still bounds the wait, and anything that keeps failing ends as
# a timeout error rather than a silent success.
await_run() {
  local run_id="$1" state status
  while :; do
    if state=$(gh run view "$run_id" --json status,conclusion,headSha \
      --jq '.status + " " + (.conclusion // "-") + " " + .headSha' 2>/dev/null); then
      read -r status conclusion head_sha <<<"$state"
      if [ "$status" = "completed" ]; then return 0; fi
    else
      echo "Could not read run $run_id this time; retrying."
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      fail "$WORKFLOW run $run_id did not finish within $TIMEOUT_MINUTES minutes, so the site may still serve the previous snapshot. See $server/$GITHUB_REPOSITORY/actions/runs/$run_id"
    fi
    sleep "$poll_seconds"
  done
}

conclusion=""
head_sha=""
run_id=""
while :; do
  dispatch_run
  run_url="$server/$GITHUB_REPOSITORY/actions/runs/$run_id"
  echo "Waiting for $WORKFLOW run $run_id ($run_url)"
  await_run "$run_id"

  if [ "$conclusion" = "success" ]; then
    # head_sha is reported rather than checked against the published commit. GITHUB_SHA is the
    # branch tip from before this run published, so comparing them would fail every time, and
    # comparing against the pushed commit would fail whenever someone else pushes in between. The
    # dispatch resolves the branch server-side after the push, so the deployment already builds a
    # commit that contains this publication.
    echo "Deployment $run_id succeeded from $head_sha; the site now serves the published branch."
    exit 0
  fi

  # A cancelled run means this deployment never ran, so it can never be reported as success. It is
  # retried rather than failed outright because the usual cause is benign: the deployment workflow
  # keeps only one pending run, so a push to the branch while this one is queued supersedes it.
  # Retrying converges on a real answer, and the deadline stops it from retrying forever.
  if [ "$conclusion" = "cancelled" ] && [ "$(date +%s)" -lt "$deadline" ]; then
    echo "Run $run_id was cancelled, most likely superseded by a newer deployment; dispatching again."
    continue
  fi

  fail "$WORKFLOW run $run_id finished as '$conclusion', so the published site still serves the previous snapshot. See $run_url"
done
