# RAG (ChromaDB) Microservice

A FastAPI-based microservice that serves a local ChromaDB vector store for text embeddings: create/list/delete collections, upsert documents with embeddings, and run semantic queries.

## 🚀 Features

### Capabilities

1. **Collections Management** (`/collections`)
   - Create or ensure a collection exists
   - List existing collections
   - Delete collections by name

2. **Document Upsert** (`/upsert`)
   - Store documents (with optional metadata and IDs)
   - Automatically embeds text using Sentence-Transformers

3. **Semantic Query** (`/query`)
   - Retrieve most similar documents by cosine similarity
   - Optional `where` filters on metadata

4. **List Documents** (`/list`)
   - List documents in a collection with optional `where` filters
   - Pagination via `limit` and `offset`

5. **Delete Documents** (`/delete`)
   - Delete by IDs or metadata filter

## 📋 Requirements

- Python 3.11+
- FastAPI
- chromadb
- sentence-transformers
- See `requirements.txt` for full list

## 🔒 Authentication

The service uses **Bearer token authentication** for security:

- **All API endpoints require authentication** (except `/docs` and `/openapi.json`)
- **Minimum token length**: 32 characters
- **Header format**: `Authorization: Bearer YOUR_TOKEN`
- **Environment variable**: `AUTH_TOKEN` in `.env`

### Setup Authentication

1. **Create environment file** (if present):
   ```bash
   cp .env.example .env
   ```

2. **Set your secure token** in `.env`:
   ```bash
   AUTH_TOKEN=your-super-secure-auth-token-min-32-chars-long-change-this-in-production
   ```

3. **Optional: Disable for development**:
   ```bash
   AUTH_REQUIRED=false  # Only for development!
   ```

## 🛠️ Installation

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the service
python main.py
# OR
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

## 🔧 Usage

The service will be available at `http://localhost:8002`

### API Documentation

- **Interactive docs**: `http://localhost:8002/docs`
- **OpenAPI schema**: `http://localhost:8002/openapi.json`

### Endpoints

#### Health Check
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8002/health
```

#### Create or Ensure Collection
```bash
curl -X POST "http://localhost:8002/collections" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "name": "my_collection",
    "metadata": {"source": "docs"}
  }'
```

#### List Collections
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8002/collections
```

#### Delete Collection
```bash
curl -X DELETE "http://localhost:8002/collections/my_collection" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### Upsert Documents
```bash
curl -X POST "http://localhost:8002/upsert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "collection": "my_collection",
    "documents": [
      "FastAPI is a modern, fast web framework for building APIs with Python.",
      "Chroma is a database for storing and querying text embeddings."
    ],
    "ids": ["doc_1", "doc_2"],
    "metadatas": [
      {"title": "FastAPI"},
      {"title": "Chroma"}
    ]
  }'
```

#### Query Collection
```bash
curl -X POST "http://localhost:8002/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "collection": "my_collection",
    "query": "What is Chroma?",
    "top_k": 3,
    "where": {"title": "Chroma"}
  }'
```

#### List Documents
```bash
curl -X POST "http://localhost:8002/list" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "collection": "my_collection",
    "where": {"title": "Chroma"},
    "limit": 10,
    "offset": 0
  }'
```

#### Delete Documents
```bash
curl -X POST "http://localhost:8002/delete" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "collection": "my_collection",
    "ids": ["doc_1"]
  }'
```

## 📊 Response Format

### Query Result
```json
{
  "ids": ["doc_2"],
  "documents": [
    "Chroma is a database for storing and querying text embeddings."
  ],
  "metadatas": [
    {"title": "Chroma"}
  ],
  "distances": [0.1023]
}
```

### Upsert Response
```json
{
  "upserted": 2,
  "collection": "my_collection"
}
```

### List Result
```json
{
  "ids": ["doc_1", "doc_2"],
  "documents": [
    "FastAPI is a modern, fast web framework for building APIs with Python.",
    "Chroma is a database for storing and querying text embeddings."
  ],
  "metadatas": [
    {"title": "FastAPI"},
    {"title": "Chroma"}
  ]
}
```

### Collections List
```json
[
  {"name": "my_collection", "metadata": {"source": "docs"}}
]
```

## 🚀 Performance Notes

- **First Request**: May take longer due to model loading
- **Subsequent Requests**: Much faster as the model is cached in memory
- **Memory Usage**: Depends on embedding model; default is lightweight
- **Tips**: Batch upserts and use `where` filters for larger datasets

---

## License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
