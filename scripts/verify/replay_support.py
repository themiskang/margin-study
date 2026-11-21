"""Resolve saved replay inputs and keep runner reports outside the input tree."""

import errno
import json
import os
import runpy
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = Path(os.environ.get("MARGINSTUDY_EVIDENCE_DIR", ROOT / "evidence"))


def replay_report(name):
    directory = os.environ.get("MARGINSTUDY_REPLAY_REPORT_DIR", EVIDENCE / "native-max-l4")
    return Path(directory) / name


def report_reference(target):
    return os.path.relpath(target, ROOT)


def required_matches(directory, pattern):
    matches = list(directory.glob(pattern))
    if not matches:
        raise FileNotFoundError(errno.ENOENT, os.strerror(errno.ENOENT), directory / pattern)
    return matches


if __name__ == "__main__":
    try:
        runpy.run_path(sys.argv[1], run_name="__main__")
    except FileNotFoundError as error:
        try:
            missing = Path(error.filename).relative_to(EVIDENCE)
        except (TypeError, ValueError):
            raise error from None
        print(json.dumps({"missingPrivateFixture": missing.as_posix()}))
        sys.exit(77)
