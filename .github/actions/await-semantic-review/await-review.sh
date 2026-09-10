#!/usr/bin/env bash
set -euo pipefail

fail() { echo "::error::$1"; exit 1; }
[[ "$PUBLICATION_RUN_ID" =~ ^[1-9][0-9]*$ ]] || fail "Invalid publication run id."
[[ "$TIMEOUT_MINUTES" =~ ^[1-9][0-9]*$ ]] || fail "Invalid review timeout."
[ "$TIMEOUT_MINUTES" -le 60 ] || fail "Review timeout exceeds 60 minutes."
[ -n "$BRANCH" ] || fail "Default branch is required."
deadline=$(( $(date +%s) + TIMEOUT_MINUTES * 60 ))
workflow="review-ai-insights.lock.yml"

# API response identity, never a latest-run search or a timestamp heuristic.
response=$(gh api -X POST \
  "repos/$GITHUB_REPOSITORY/actions/workflows/$workflow/dispatches" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  -f "ref=$BRANCH" -f "inputs[publication-run-id]=$PUBLICATION_RUN_ID") ||
  fail "Could not dispatch independent semantic review."
run_id=$(printf '%s' "$response" | jq -er '.workflow_run_id | select(type == "number" and . > 0 and . == floor)') ||
  fail "Review dispatch did not report an exact run id."
[[ "$run_id" =~ ^[1-9][0-9]*$ ]] || fail "Invalid dispatched review run id."
[ "$run_id" != "$PUBLICATION_RUN_ID" ] || fail "Review must be an independent run."
provenance_attempts=0

while :; do
  if state=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" 2>/dev/null); then
    # REST run responses omit workflow inputs. The trusted workflow's run-name binds that input;
    # combined with the dispatch-returned ID this rejects a run for any other publication.
    if ! printf '%s' "$state" | jq -e \
      --arg id "$run_id" --arg branch "$BRANCH" --arg repo "$GITHUB_REPOSITORY" \
      --arg title "Semantic review publication $PUBLICATION_RUN_ID" \
      '(.id | tostring) == $id and .head_branch == $branch and
       .head_repository.full_name == $repo and .repository.full_name == $repo and
       .path == ".github/workflows/review-ai-insights.lock.yml" and
       .event == "workflow_dispatch" and .display_title == $title' >/dev/null; then
      provenance_attempts=$((provenance_attempts + 1))
      # Dispatch metadata may not be fully populated yet. Never accept a run until all
      # bindings match, and limit this grace period independently of the review deadline.
      if [ "$provenance_attempts" -ge 3 ] ||
        ! printf '%s' "$state" | jq -e '.status == "queued" or .status == "in_progress" or .status == "requested" or .status == "pending"' >/dev/null ||
        [ "$(date +%s)" -ge "$deadline" ]; then
        printf '%s' "$state" | jq -c \
          --arg id "$run_id" --arg branch "$BRANCH" --arg repo "$GITHUB_REPOSITORY" \
          --arg title "Semantic review publication $PUBLICATION_RUN_ID" \
          '{id:((.id|tostring)==$id),branch:(.head_branch==$branch),
            source:(.head_repository.full_name==$repo),repository:(.repository.full_name==$repo),
            path:(.path==".github/workflows/review-ai-insights.lock.yml"),
            event:(.event=="workflow_dispatch"),title:(.display_title==$title)}' || true
        fail "Independent review provenance mismatch."
      fi
      echo "Dispatched review metadata not yet bound; retrying exact run $run_id."
      sleep "${POLL_SECONDS:-20}"
      continue
    fi
    status=$(printf '%s' "$state" | jq -er '.status')
    if [ "$status" = completed ]; then
      conclusion=$(printf '%s' "$state" | jq -er '.conclusion')
      [ "$conclusion" = success ] || fail "Independent review did not succeed ($conclusion)."
      echo "run-id=$run_id" >> "$GITHUB_OUTPUT"
      exit 0
    fi
  else
    echo "Review run metadata unavailable; retrying within the deadline."
  fi
  [ "$(date +%s)" -lt "$deadline" ] ||
    fail "Independent review did not finish within $TIMEOUT_MINUTES minutes."
  sleep "${POLL_SECONDS:-20}"
done
