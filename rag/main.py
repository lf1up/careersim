#!/usr/bin/env python3
"""
FastAPI RAG Microservice using ChromaDB (local) for embeddings storage and retrieval.

Endpoints:
- POST /collections           : create or ensure a collection
- GET  /collections           : list collections
- DELETE /collections/{name}  : delete a collection
- POST /upsert                : upsert documents with optional metadatas and ids
- POST /query                 : semantic query over a collection (top_k, filters)
- POST /list                  : list documents by metadata filter (ids, docs, metadatas)
- POST /delete                : delete documents by ids or where clause
- GET  /health                : health check

Environment variables:
- AUTH_TOKEN          : bearer token (min 32 chars). If absent, a dev default is used
- AUTH_REQUIRED       : 'true' | 'false' (default true). In dev you can set false
- CHROMA_PERSIST_DIR  : directory for Chroma DB persistent storage (default ./chroma)
- EMBEDDING_MODEL     : sentence-transformers model (default all-MiniLM-L6-v2)
- API_HOST, API_PORT  : uvicorn host/port when running as __main__

Notes:
- Uses sentence-transformers for embedding and Chroma run in-process.
- This service is intentionally lightweight and runs fully offline.
"""

import os
import logging
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

# Chroma and embeddings
import chromadb
from chromadb.utils import embedding_functions
from chromadb.config import Settings


# Load environment
load_dotenv()

# Logging (let Uvicorn configure handlers; set module logger level only)
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logger = logging.getLogger(__name__)
logger.setLevel(getattr(logging, log_level, logging.INFO))


# Auth
AUTH_TOKEN = os.getenv("AUTH_TOKEN")
if not AUTH_TOKEN:
    AUTH_TOKEN = "default-dev-token-change-in-production-min-32-chars"
    logger.warning("⚠️ No AUTH_TOKEN found in environment. Using default token!")
    logger.warning("🔒 Please set AUTH_TOKEN in .env file for production!")
if len(AUTH_TOKEN) < 32:
    raise ValueError("⚠️ AUTH_TOKEN must be at least 32 characters long!")

security = HTTPBearer()


def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials.credentials != AUTH_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


def get_auth_dependency():
    auth_required = os.getenv("AUTH_REQUIRED", "true").lower() == "true"
    return Depends(verify_token) if auth_required else None


# Chroma configuration
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "/app/chroma")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

# Ensure persistence dir exists
os.makedirs(CHROMA_PERSIST_DIR, exist_ok=True)

# FastAPI app (define before startup hooks)
auth_required = os.getenv("AUTH_REQUIRED", "true").lower() == "true"
auth_status = (
    "🔒 Authentication Required"
    if auth_required
    else "🔓 Authentication Disabled (Development)"
)

DOCS_DESCRIPTION = f"""FastAPI service providing ChromaDB RAG access.

{auth_status}

## Authentication
All endpoints require Bearer token authentication (except /docs and /openapi.json).
Include the token in the Authorization header: `Authorization: Bearer YOUR_TOKEN`

## Embedding Models
- **{EMBEDDING_MODEL}**
"""

app = FastAPI(title="RAG Microservice (ChromaDB)", version="1.0.0", description=DOCS_DESCRIPTION)

# Initialize Chroma client and embedding function on app startup to avoid
# duplicate initialization when uvicorn --reload spawns a reloader process.
chroma_client = None
embedding_fn = None


def _init_embedding_function():
    return embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBEDDING_MODEL
    )


@app.on_event("startup")
def on_startup():
    global chroma_client, embedding_fn
    # Disable anonymized telemetry to reduce noisy logs and avoid posthog errors
    chroma_client = chromadb.PersistentClient(
        path=CHROMA_PERSIST_DIR,
        settings=Settings(anonymized_telemetry=False),
    )
    embedding_fn = _init_embedding_function()


# Schemas
class EnsureCollectionInput(BaseModel):
    name: str = Field(..., min_length=1)
    metadata: Optional[Dict[str, Any]] = None


class UpsertInput(BaseModel):
    collection: str = Field(..., min_length=1)
    documents: List[str] = Field(..., min_items=1)
    ids: Optional[List[str]] = None
    metadatas: Optional[List[Dict[str, Any]]] = None


class QueryInput(BaseModel):
    collection: str = Field(..., min_length=1)
    query: str = Field(..., min_length=1)
    top_k: int = Field(5, ge=1, le=100)
    where: Optional[Dict[str, Any]] = None


class DeleteInput(BaseModel):
    collection: str = Field(..., min_length=1)
    ids: Optional[List[str]] = None
    where: Optional[Dict[str, Any]] = None


class QueryResult(BaseModel):
    ids: List[str]
    documents: List[str]
    metadatas: List[Optional[Dict[str, Any]]]
    distances: Optional[List[float]] = None


class ListInput(BaseModel):
    collection: str = Field(..., min_length=1)
    where: Optional[Dict[str, Any]] = None
    limit: Optional[int] = Field(100, ge=1, le=1000)
    offset: Optional[int] = Field(0, ge=0)


class ListResult(BaseModel):
    ids: List[str]
    documents: List[str]
    metadatas: List[Optional[Dict[str, Any]]]


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_collection_or_404(name: str):
    if chroma_client is None or embedding_fn is None:
        raise HTTPException(status_code=503, detail="Service not ready")
    try:
        return chroma_client.get_collection(name=name, embedding_function=embedding_fn)
    except Exception:
        raise HTTPException(status_code=404, detail=f"Collection '{name}' not found")


@app.get("/", response_model=dict)
def root():
    return {
        "service": "RAG Microservice (ChromaDB)",
        "version": "1.0.0",
        "endpoints": [
            "GET /health",
            "GET /collections",
            "POST /collections",
            "DELETE /collections/{name}",
            "POST /upsert",
            "POST /query",
            "POST /delete",
        ],
        "persistence": CHROMA_PERSIST_DIR,
        "embedding_model": EMBEDDING_MODEL,
    }


@app.get("/health", response_model=dict)
def health(token: str = get_auth_dependency()):
    try:
        # list collections to verify db access
        names = [c.name for c in chroma_client.list_collections()]
        return {
            "status": "healthy",
            "collections": names,
            "persistence": CHROMA_PERSIST_DIR,
            "embedding_model": EMBEDDING_MODEL,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Health check failed: {exc}")


@app.get("/collections", response_model=List[dict])
def list_collections(token: str = get_auth_dependency()):
    cols = []
    for c in chroma_client.list_collections():
        cols.append({"name": c.name, "metadata": getattr(c, "metadata", None)})
    return cols


@app.post("/collections", response_model=dict)
def ensure_collection(
    input_data: EnsureCollectionInput, token: str = get_auth_dependency()
):
    try:
        # Only pass metadata when it is provided and non-empty; some Chroma versions
        # reject an explicitly empty metadata dict
        kwargs = {
            "name": input_data.name,
            "embedding_function": embedding_fn,
        }
        if input_data.metadata and isinstance(input_data.metadata, dict) and len(input_data.metadata) > 0:
            kwargs["metadata"] = input_data.metadata

        col = chroma_client.get_or_create_collection(**kwargs)
        return {"name": col.name, "metadata": getattr(col, "metadata", None)}
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to create collection: {exc}"
        )


@app.delete("/collections/{name}", response_model=dict)
def delete_collection(name: str, token: str = get_auth_dependency()):
    try:
        chroma_client.delete_collection(name)
        return {"deleted": True, "name": name}
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to delete collection: {exc}"
        )


@app.post("/upsert", response_model=dict)
def upsert_documents(input_data: UpsertInput, token: str = get_auth_dependency()):
    if input_data.ids and len(input_data.ids) != len(input_data.documents):
        raise HTTPException(
            status_code=400, detail="Length of ids must match documents"
        )
    if input_data.metadatas and len(input_data.metadatas) != len(input_data.documents):
        raise HTTPException(
            status_code=400, detail="Length of metadatas must match documents"
        )

    col = get_collection_or_404(input_data.collection)
    ids = input_data.ids or [f"doc_{i}" for i in range(len(input_data.documents))]

    try:
        col.upsert(
            documents=input_data.documents, ids=ids, metadatas=input_data.metadatas
        )
        return {"upserted": len(ids), "collection": input_data.collection}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Upsert failed: {exc}")


@app.post("/query", response_model=QueryResult)
def query(input_data: QueryInput, token: str = get_auth_dependency()):
    col = get_collection_or_404(input_data.collection)
    try:
        result = col.query(
            query_texts=[input_data.query],
            n_results=input_data.top_k,
            where=input_data.where,
        )
        # result fields are lists of lists
        ids = result.get("ids", [[]])[0]
        documents = result.get("documents", [[]])[0]
        metadatas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])
        distances = distances[0] if distances else None
        return QueryResult(
            ids=ids, documents=documents, metadatas=metadatas, distances=distances
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Query failed: {exc}")


@app.post("/list", response_model=ListResult)
def list_documents(input_data: ListInput, token: str = get_auth_dependency()):
    col = get_collection_or_404(input_data.collection)
    try:
        # Normalize simple equality filters to operator form expected by some backends
        where = None
        if input_data.where:
            where = {}
            for k, v in input_data.where.items():
                if isinstance(v, dict):
                    where[k] = v
                else:
                    where[k] = {"$eq": v}

        result = col.get(
            where=where,
            limit=input_data.limit,
            offset=input_data.offset,
            include=["documents", "metadatas"],
        )
        ids = result.get("ids", [])
        documents = result.get("documents", [])
        metadatas = result.get("metadatas", [])
        return ListResult(ids=ids, documents=documents, metadatas=metadatas)
    except Exception as exc:
        logger.exception("List failed")
        raise HTTPException(status_code=500, detail=f"List failed: {exc}")


@app.post("/delete", response_model=dict)
def delete_documents(input_data: DeleteInput, token: str = get_auth_dependency()):
    col = get_collection_or_404(input_data.collection)
    if not input_data.ids and not input_data.where:
        raise HTTPException(
            status_code=400, detail="Provide ids or where clause to delete"
        )
    try:
        col.delete(ids=input_data.ids, where=input_data.where)
        return {"deleted": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}")


if __name__ == "__main__":
    import uvicorn

    api_host = os.getenv("API_HOST", "0.0.0.0")
    api_port = int(os.getenv("API_PORT", "8002"))
    api_reload = os.getenv("API_RELOAD", "false").lower() == "true"
    uvicorn.run("main:app", host=api_host, port=api_port, reload=api_reload)
