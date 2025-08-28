FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CHROMA_PERSIST_DIR=/app/chroma

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=10s --retries=5 CMD ["python", "-c", "import sys,httpx; r=httpx.get('http://localhost:8002/', timeout=5.0); sys.exit(0 if r.status_code == 200 else 1)"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002", "--reload"]

