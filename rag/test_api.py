#!/usr/bin/env python3
import os
import asyncio
import httpx

BASE_URL = os.getenv("RAG_BASE_URL", "http://localhost:8002")
AUTH_TOKEN = os.getenv(
    "AUTH_TOKEN", "default-dev-token-change-in-production-min-32-chars"
)
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "true").lower() == "true"


def headers():
    return {"Authorization": f"Bearer {AUTH_TOKEN}"} if AUTH_REQUIRED else {}


async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Health
        r = await client.get(f"{BASE_URL}/health", headers=headers())
        r.raise_for_status()
        print("health:", r.json())

        # Ensure collection
        r = await client.post(
            f"{BASE_URL}/collections", json={"name": "docs"}, headers=headers()
        )
        r.raise_for_status()
        print("ensure collection:", r.json())

        # Upsert
        payload = {
            "collection": "docs",
            "documents": [
                "FastAPI is a modern, fast web framework for building APIs with Python.",
                "ChromaDB is an open-source embedding database for building AI apps.",
            ],
            "metadatas": [{"source": "wiki"}, {"source": "docs"}],
        }
        r = await client.post(f"{BASE_URL}/upsert", json=payload, headers=headers())
        r.raise_for_status()
        print("upsert:", r.json())

        # Query
        q = {"collection": "docs", "query": "What is ChromaDB?", "top_k": 2}
        r = await client.post(f"{BASE_URL}/query", json=q, headers=headers())
        r.raise_for_status()
        print("query:", r.json())


if __name__ == "__main__":
    asyncio.run(main())
