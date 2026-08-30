"""Helper script to set up demo state for UI catch-up testing.

Marks chapters 1 and 2 completed for the reader on the demo novel,
sets listening_progress on chapter 3 backdated by 6 days.
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
NOVEL_ID = "6a93d8608399b4da7b381c13"
CH1 = "6a93d8608399b4da7b381c15"
CH2 = "6a93d8608399b4da7b381c16"
CH3 = "6a93d8608399b4da7b381c17"


async def main(reset=False):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    user = await db.users.find_one({"email": "reader@lightlisten.app"})
    if not user:
        print("Reader not found")
        return
    uid = user["_id"]
    nid = ObjectId(NOVEL_ID)

    # Clean first
    await db.chapter_completions.delete_many({"user_id": uid, "novel_id": nid})
    await db.audio_bookmarks.delete_many({"user_id": uid, "novel_id": nid})
    await db.listening_progress.delete_many({"user_id": uid, "novel_id": nid})

    if reset:
        print("Reset done")
        return

    # Mark ch1+ch2 completed
    now = datetime.now(timezone.utc)
    for cid in [CH1, CH2]:
        await db.chapter_completions.insert_one({
            "user_id": uid, "novel_id": nid, "chapter_id": ObjectId(cid),
            "completed_at": now,
        })
    # Progress on ch3, backdated 6 days
    six_days_ago = now - timedelta(days=6)
    await db.listening_progress.insert_one({
        "user_id": uid, "novel_id": nid, "chapter_id": ObjectId(CH3),
        "position_seconds": 12.0,
        "updated_at": six_days_ago,
        "created_at": six_days_ago,
    })
    print("Setup done: ch1+ch2 completed, progress on ch3 backdated 6d")

if __name__ == "__main__":
    import sys
    asyncio.run(main(reset="--reset" in sys.argv))
