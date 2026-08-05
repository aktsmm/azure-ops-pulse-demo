#!/usr/bin/env bash
# Waits for a dispatched analysis run and reports it only once it has succeeded.
#
# An analysis dispatched with GITHUB_TOKEN never emits a workflow_run event when it finishes, because
# GitHub only lets that token create runs through workflow_dispatch and repository_dispatch. Anything
# listening for that event therefore never starts, so the run has to be waited for explicitly and its
# id handed to the publisher. Without this the analysis produces a validated candidate that nothing
# ever reads, while the collection reports success.
#
# Environment:
#   GH_TOKEN            token used to read the run
#   GITHUB_REPOSITORY   owner/repo the run belongs to
#   RUN_ID              analysis run to wait for
#   TIMEOUT_MINUTES     how long to keep waiting before giving up and failing
#   GITHUB_OUTPUT       file the confirmed run id is written to
#   POLL_SECONDS        optional gap between run reads; only lowered by the scenario tests
set -euo pipefail

poll_seconds="${POLL_SECONDS:-30}"
server="${GITHUB_SERVER_URL:-https://github.com}"
run_url="$server/$GITHUB_REPOSITORY/actions/runs/$RUN_ID"
deadline=$(( $(date +%s) + TIMEOUT_MINUTES * 60 ))

# Every failure says that the snapshot itself is fine, because the collection has already published
# and deployed it by this point and only the insights are missing.
fail() {
  echo "::error::$1 The snapshot itself is published and deployed. See $run_url"
  exit 1
}

case "$RUN_ID" in
  '' | *[!0-9]*)
    fail "'$RUN_ID' is not an analysis run id, so no insights could be published."
    ;;
esac

echo "Waiting for AI analysis run $RUN_ID ($run_url)"

# Waiting this long means many API calls, so transient read failures are retried rather than aborting.
# The deadline still bounds the wait, and anything that keeps failing ends as a timeout error rather
# than a silent success.
conclusion=""
while :; do
  if state=$(gh run view "$RUN_ID" --json status,conclusion \
    --jq '.status + " " + (.conclusion // "-")' 2>/dev/null); then
    read -r status conclusion <<<"$state"
    if [ "$status" = "completed" ]; then break; fi
  else
    echo "Could not read run $RUN_ID this time; retrying."
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    fail "The AI analysis did not finish within $TIMEOUT_MINUTES minutes, so its insights were not published."
  fi
  sleep "$poll_seconds"
done

# Success is asserted positively so no other conclusion can ever be handed on as publishable.
if [ "$conclusion" != "success" ]; then
  fail "The AI analysis finished as '$conclusion', so no insights were published."
fi

echo "Analysis run $RUN_ID succeeded; its validated candidate can be published."
echo "run-id=$RUN_ID" >>"$GITHUB_OUTPUT"
