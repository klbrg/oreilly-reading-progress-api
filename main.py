from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import subprocess
import json
from datetime import datetime
from typing import Dict, Any, List, Optional
import os
from gitconfig import GIT_REPO_PATH, DATA_FILE


class ProgressEntry(BaseModel):
    index: int
    date: str
    url: str
    title: str


class StoragePayload(BaseModel):
    storage: Dict[str, ProgressEntry]


class StorageUpdate(BaseModel):
    storage: Dict[str, ProgressEntry]


class PlaylistBook(BaseModel):
    id: str
    title: str
    cover: Optional[str] = None
    url: str
    item_id: Optional[str] = None


class Playlist(BaseModel):
    id: str
    title: str
    url: str
    last_opened: Optional[str] = None
    books: List[PlaylistBook]


class StatusResponse(BaseModel):
    status: str
    message: Optional[str] = None


class DataResponse(StatusResponse):
    data: Optional[Dict[str, Any]] = None


class WriteResponse(StatusResponse):
    data_written: Optional[Dict[str, Any]] = None

app = FastAPI()

# 💥 Simplest possible CORS setup — allow everything
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# Push the progress repo in batches rather than on every commit: whenever 100
# commits have piled up, or at least every 5 minutes — whichever comes first.
PUSH_INTERVAL_SECONDS = 5 * 60
PUSH_COMMIT_THRESHOLD = 100
_commits_since_push = 0
_push_lock = asyncio.Lock()


async def _git_push():
    """Push pending commits to the remote, resetting the pending counter.

    On failure the counter is left intact so the next trigger retries.
    """
    global _commits_since_push
    async with _push_lock:
        if _commits_since_push == 0:
            return
        try:
            subprocess.run(["git", "push"], cwd=GIT_REPO_PATH, check=True)
            _commits_since_push = 0
        except subprocess.CalledProcessError as e:
            print(f"git push failed: {e}")


async def _commit_progress(commit_message: str):
    """Stage and commit the data file, pushing once the threshold is reached."""
    global _commits_since_push
    relative_path = os.path.relpath(DATA_FILE, GIT_REPO_PATH)
    subprocess.run(["git", "add", relative_path], cwd=GIT_REPO_PATH, check=True)
    subprocess.run(["git", "commit", "-m", commit_message], cwd=GIT_REPO_PATH, check=True)
    _commits_since_push += 1
    if _commits_since_push >= PUSH_COMMIT_THRESHOLD:
        await _git_push()


async def _periodic_push():
    while True:
        await asyncio.sleep(PUSH_INTERVAL_SECONDS)
        await _git_push()


@app.on_event("startup")
async def _start_push_loop():
    asyncio.create_task(_periodic_push())


@app.get("/data", response_model=DataResponse)
async def get_data():
    if not os.path.exists(DATA_FILE):
        return {"status": "error", "message": "No data file found"}
    with open(DATA_FILE) as f:
        data = json.load(f)
    return {"status": "ok", "data": data}


@app.put("/update", response_model=WriteResponse)
async def update_key(body: StorageUpdate):
    if not os.path.exists(DATA_FILE):
        return {"status": "error", "message": "No data file found"}

    with open(DATA_FILE) as f:
        data = json.load(f)

    entries = body.model_dump()["storage"]
    for key, value in entries.items():
        if "storage" in data and key in data["storage"]:
            data["storage"][key].update(value)
        elif "storage" in data:
            data["storage"][key] = value
        else:
            data[key] = value

    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

    first_entry = next(iter(entries.values()))
    title = first_entry.get("title", "unknown")
    index = first_entry.get("index", "?")
    commit_message = f"chore(progress): {title} — section {index}"

    try:
        await _commit_progress(commit_message)
    except subprocess.CalledProcessError as e:
        return {"status": "error", "message": str(e)}

    return {"status": "ok", "data_written": data}


@app.delete("/playlists/{playlist_id}", response_model=StatusResponse)
async def delete_playlist(playlist_id: str):
    if not os.path.exists(DATA_FILE):
        return {"status": "ok"}
    with open(DATA_FILE) as f:
        data = json.load(f)
    if "playlists" in data and playlist_id in data["playlists"]:
        del data["playlists"][playlist_id]
        with open(DATA_FILE, "w") as f:
            json.dump(data, f, indent=2)
    return {"status": "ok"}


@app.put("/playlists/{playlist_id}", response_model=WriteResponse)
async def upsert_playlist(playlist_id: str, body: Playlist):
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)

    if os.path.exists(DATA_FILE):
        with open(DATA_FILE) as f:
            data = json.load(f)
    else:
        data = {}

    data.setdefault("playlists", {})
    data["playlists"][playlist_id] = body.model_dump()

    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

    return {"status": "ok", "data_written": data["playlists"][playlist_id]}


@app.post("/update", response_model=WriteResponse)
async def update_data(body: StoragePayload):
    # Ensure data directory exists
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)

    data = body.model_dump()

    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

    entries = data.get("storage", {})
    first_entry = next(iter(entries.values()), {})
    title = first_entry.get("title", "unknown")
    index = first_entry.get("index", "?")
    commit_message = f"chore(progress): {title} — section {index}"

    try:
        await _commit_progress(commit_message)
    except subprocess.CalledProcessError as e:
        return {"status": "error", "message": str(e)}

    return {"status": "ok", "data_written": data}
