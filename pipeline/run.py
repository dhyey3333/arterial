"""Entry point for every stage. ARTERIAL_STAGE picks one, so one image serves every Condense transform.

  ARTERIAL_STAGE=validate   telemetry-raw   -> telemetry-valid, telemetry-rejected
  ARTERIAL_STAGE=window     telemetry-valid -> segment-metrics
"""

import os
import sys

STAGES = {
    "validate": "pipeline.validate",
    "window": "pipeline.window",
}


def main() -> None:
    stage = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ARTERIAL_STAGE", "")).strip()
    if stage not in STAGES:
        sys.exit(f"set ARTERIAL_STAGE to one of: {', '.join(STAGES)}")
    module = __import__(STAGES[stage], fromlist=["main"])
    module.main()


if __name__ == "__main__":
    main()
