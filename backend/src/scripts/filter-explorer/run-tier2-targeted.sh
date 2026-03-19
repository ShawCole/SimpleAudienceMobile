#!/bin/bash
# Tier 2 Targeted Sweeps — 5 high-cardinality filters × 4 diverse anchors
# Estimated: ~2,856 API calls, ~4 hours total
#
# Filters: businessProfile.industry (141), attributes.occupation_group (26),
#          attributes.occupation_type (305), attributes.ethnic_code (162),
#          attributes.language_code (80)
#
# Anchors: healthcare, smb-b2b, multicultural-urban, consumer-elder

set -e
cd "$(dirname "$0")/../../../.."

BATCH="businessProfile.industry,attributes.occupation_group,attributes.occupation_type,attributes.ethnic_code,attributes.language_code"
CMD="npx tsx backend/src/scripts/filter-explorer/calibration-sweep.ts"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     TIER 2 TARGETED SWEEPS — 4 ANCHORS × 5 FILTERS     ║"
echo "║     ~2,856 API calls · ~4 hours estimated               ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Start time: $(date)"
echo ""

# Run 1: healthcare (NAICS 621111, 74k anchor)
echo "════════════════════════════════════════════════════════════"
echo "  RUN 1/4: healthcare  ·  ~714 calls  ·  $(date +%H:%M:%S)"
echo "════════════════════════════════════════════════════════════"
$CMD --profile healthcare --targeted-batch "$BATCH"
echo ""
echo "  Run 1 complete at $(date +%H:%M:%S)"
echo ""

# Run 2: smb-b2b (sales + 1-10 emp + <$1M rev, 26k anchor)
echo "════════════════════════════════════════════════════════════"
echo "  RUN 2/4: smb-b2b  ·  ~714 calls  ·  $(date +%H:%M:%S)"
echo "════════════════════════════════════════════════════════════"
$CMD --profile smb-b2b --targeted-batch "$BATCH"
echo ""
echo "  Run 2 complete at $(date +%H:%M:%S)"
echo ""

# Run 3: multicultural-urban (female Spanish bachelor's, 10k anchor)
echo "════════════════════════════════════════════════════════════"
echo "  RUN 3/4: multicultural-urban  ·  ~714 calls  ·  $(date +%H:%M:%S)"
echo "════════════════════════════════════════════════════════════"
$CMD --profile multicultural-urban --targeted-batch "$BATCH"
echo ""
echo "  Run 3 complete at $(date +%H:%M:%S)"
echo ""

# Run 4: consumer-elder (age 56-80 married homeowner, 230k anchor)
echo "════════════════════════════════════════════════════════════"
echo "  RUN 4/4: consumer-elder  ·  ~714 calls  ·  $(date +%H:%M:%S)"
echo "════════════════════════════════════════════════════════════"
$CMD --profile consumer-elder --targeted-batch "$BATCH"
echo ""
echo "  Run 4 complete at $(date +%H:%M:%S)"
echo ""

echo "╔══════════════════════════════════════════════════════════╗"
echo "║     ALL 4 RUNS COMPLETE                                  ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo "End time: $(date)"
