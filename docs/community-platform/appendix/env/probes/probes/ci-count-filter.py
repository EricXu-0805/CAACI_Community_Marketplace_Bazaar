import re
import sys

for line in sys.stdin:
    if any(ref in line for ref in ("lfhvgprf" + "phyfvhidegum", "wslzeqhip" + "vibeflmxznh")):
        print("STOP: prohibited project reference detected in CI log", flush=True)
        sys.exit(3)
    if re.search(r"# (tests|pass|fail|skipped) [0-9]+|[0-9]+ (passed|failed|skipped|flaky)", line):
        print(line.rstrip(), flush=True)
