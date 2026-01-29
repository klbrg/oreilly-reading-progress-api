from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import subprocess
import json
from datetime import datetime
import os
from gitconfig import GIT_REPO_PATH, DATA_FILE

app = FastAPI()

# 💥 Simplest possible CORS setup — allow everything
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/update")
async def update_data(request: Request):
    data = await request.json()

    # Ensure data directory exists
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)

    # Write JSON to file
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

    # Commit locally (skip push)
    relative_path = os.path.relpath(DATA_FILE, GIT_REPO_PATH)
    try:
        print(data)
        subprocess.run(["git", "add", relative_path], cwd=GIT_REPO_PATH, check=True)
        book_title = data.get("title", "Unknown Book")
        commit_message = (
            f"Update progress for '{book_title}' - {datetime.now().isoformat()}"
        )
        subprocess.run(
            ["git", "commit", "-m", commit_message], cwd=GIT_REPO_PATH, check=True
        )
    except subprocess.CalledProcessError as e:
        return {"status": "error", "message": str(e)}

    return {"status": "ok", "data_written": data}
