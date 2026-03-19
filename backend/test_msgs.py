import asyncio
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.message import Message
import sys
# Set console encoding to utf-8 for windows
sys.stdout.reconfigure(encoding='utf-8')

async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Message).order_by(Message.created_at.desc()).limit(20))
        lines = []
        for row in result.scalars().all():
            sender = row.sender or {}
            cnv = row.conversation_id
            sid = row.session_id
            name = sender.get("name")
            content = row.content[:20].replace('\n', ' ')
            print(f"session:{sid} | conv:{cnv} | name:{name} | msg:{content}")

asyncio.run(main())
