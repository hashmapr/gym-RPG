#!/usr/bin/env python3
"""Sprint 8a stub — ml_v1 training pipeline.

Trains the first gradient-boosting model over ml_features and writes a
candidate artifact + metrics. It does NOT activate anything: the artifact
must pass the backtest gate (>5% MAE improvement over deterministic
baselines on BOTH sparse and rich strata) before a human pins it via the
registry. Workflow: manual dispatch only (see .github/workflows/ml-train.yml).

Usage:
    python ml/train.py --features ml_features.csv --out ml/artifacts/
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

GATE_MIN_IMPROVEMENT_PCT = 5.0


def main() -> int:
    parser = argparse.ArgumentParser(description="ml_v1 training (stub)")
    parser.add_argument("--features", required=True, help="ml_features CSV export")
    parser.add_argument("--out", default="ml/artifacts/", help="artifact output dir")
    args = parser.parse_args()

    features_path = Path(args.features)
    if not features_path.exists():
        print(f"features file not found: {features_path}", file=sys.stderr)
        return 1

    # 8a: pipeline shape only — no training libraries are wired yet.
    # 8b will: load features -> walk-forward split (12w/2w/1d) -> train ->
    # evaluate vs baselines -> emit artifact + metrics.json.
    stub_metrics = {
        "status": "stub",
        "gate_min_improvement_pct": GATE_MIN_IMPROVEMENT_PCT,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "note": "No model trained in 8a. mlPassesGate stays FALSE until 8b.",
    }

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "metrics.json").write_text(json.dumps(stub_metrics, indent=2) + "\n")
    print(json.dumps(stub_metrics, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())