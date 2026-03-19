import asyncio
import os
from sqlalchemy import text
from app.db.session import engine

async def migrate():
    async with engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN file_url VARCHAR;"))
            print("Successfully added file_url column to documents table.")
        except Exception as e:
            if "already exists" in str(e):
                print("Column file_url already exists.")
            else:
                print(f"Error migrating: {e}")

if __name__ == "__main__":
    asyncio.run(migrate())
