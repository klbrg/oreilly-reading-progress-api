# git_config.py
import os

# Absolute path to your local Git repository.
# Override with the OREILLY_REPO_PATH env var; otherwise pick the first
# candidate that exists so the same code works across machines (e.g. macOS
# keeps it under Projects/Personal, this Linux box under Projects).
_CANDIDATES = [
    os.path.join("~", "Projects", "Personal", "oreilly-reading-progress"),
    os.path.join("~", "Projects", "oreilly-reading-progress"),
]


def _resolve_repo_path():
    override = os.environ.get("OREILLY_REPO_PATH")
    if override:
        return os.path.expanduser(override)
    for candidate in _CANDIDATES:
        expanded = os.path.expanduser(candidate)
        if os.path.isdir(expanded):
            return expanded
    # Fall back to the first candidate if none exist yet.
    return os.path.expanduser(_CANDIDATES[0])


GIT_REPO_PATH = _resolve_repo_path()

# Data file path (inside repo/data/)
DATA_FILE = os.path.join(GIT_REPO_PATH, "data.json")
