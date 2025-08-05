# Transformer Models Microservice

A FastAPI-based microservice that serves four different Hugging Face transformer models for text classification tasks.

## 🚀 Features

### Supported Models

1. **Sentiment Analysis** (`/sentiment`)
   - Model: [cardiffnlp/twitter-roberta-base-sentiment-latest](https://huggingface.co/cardiffnlp/twitter-roberta-base-sentiment-latest)
   - Purpose: Twitter-trained sentiment analysis
   - Labels: Negative, Neutral, Positive

2. **Toxicity Detection** (`/toxicity`)
   - Model: [martin-ha/toxic-comment-model](https://huggingface.co/martin-ha/toxic-comment-model)
   - Purpose: Detect toxic/harmful comments
   - Labels: Non-toxic, Toxic

3. **Emotion Classification** (`/emotion`)
   - Model: [j-hartmann/emotion-english-distilroberta-base](https://huggingface.co/j-hartmann/emotion-english-distilroberta-base)
   - Purpose: Classify emotions in text
   - Labels: anger, disgust, fear, joy, neutral, sadness, surprise

4. **Zero-shot Sequence Classification** (`/sequence`)
   - Model: [facebook/bart-large-mnli](https://huggingface.co/facebook/bart-large-mnli)
   - Purpose: Classify text with custom labels
   - Labels: User-defined candidate labels

## 📋 Requirements

- Python 3.11+
- FastAPI
- Transformers
- PyTorch
- See `requirements.txt` for full list

## 🔒 Authentication

The service uses **Bearer token authentication** for security:

- **All API endpoints require authentication** (except `/docs` and `/openapi.json`)
- **Minimum token length**: 32 characters
- **Header format**: `Authorization: Bearer YOUR_TOKEN`
- **Environment variable**: `AUTH_TOKEN` in `.env` file

### Setup Authentication

1. **Copy environment example**:
   ```bash
   cp env.example .env
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

### Option 1: Local Development

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the service
python main.py
# OR
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Option 2: Docker (Production - Pre-cached Models)

```bash
# 1. Create .env file with your configuration
cp env.example .env
# Edit .env and set your AUTH_TOKEN

# 2. Build and run with Docker Compose
docker-compose up --build

# Or build manually (requires manual environment setup)
docker build -t transformers-api .
docker run --env-file .env -p 8000:8000 transformers-api
```

### Option 3: Docker (Development - Fast Build)

```bash
# 1. Setup environment
cp env.example .env
# AUTH_REQUIRED will be automatically set to false for dev service

# 2. Development mode with live reloading
docker-compose --profile dev up transformers-api-dev --build

# Models downloaded on first run, cached in volume for subsequent runs
```

## 🐳 Docker Environment Configuration

Docker Compose automatically loads environment variables from the `.env` file:

- **Production service** (`transformers-api`): Uses all variables from `.env`
- **Development service** (`transformers-api-dev`): Loads `.env` but overrides `AUTH_REQUIRED=false`
- **Path mapping**: Docker overrides cache paths to use container paths

### Environment Loading Priority
1. `.env` file variables (loaded by `env_file`) - Base configuration
2. `environment` section overrides - Docker-specific paths and settings
3. Container defaults (if not specified)

### Why Some Variables Are Overridden
- **Cache paths**: `.env` uses `./models_cache` (local), Docker needs `/app/models_cache` (container)
- **Development mode**: `AUTH_REQUIRED=false` for dev service only
- **Docker settings**: `PYTHONUNBUFFERED=1` for proper logging

## 🚀 Model Caching System

The service includes an intelligent caching system that dramatically improves startup times:

### Production Docker Image
- **Multi-stage build** pre-downloads all models during image build
- **~4-6GB image** but instant startup after first build
- Models embedded in image - no internet required for startup

### Development Setup
- **Lightweight build** for faster iteration
- **Volume-based caching** - models downloaded once, reused across container restarts
- **Live reloading** for code changes

### Cache Benefits
- **First run**: 3-5 minutes (downloading models)
- **Subsequent runs**: 10-30 seconds (using cache)
- **95% faster** startup times after initial setup

## 🔧 Usage

The service will be available at `http://localhost:8000`

### API Documentation

- **Interactive docs**: `http://localhost:8000/docs`
- **OpenAPI schema**: `http://localhost:8000/openapi.json`

### Endpoints

#### Health Check
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/health
```

#### Sentiment Analysis
```bash
curl -X POST "http://localhost:8000/sentiment" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"text": "I love this new feature!"}'
```

#### Toxicity Detection
```bash
curl -X POST "http://localhost:8000/toxicity" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"text": "This is a normal comment"}'
```

#### Emotion Classification
```bash
curl -X POST "http://localhost:8000/emotion" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"text": "I am so excited about this!"}'
```

#### Zero-shot Classification
```bash
curl -X POST "http://localhost:8000/sequence" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "text": "This movie was absolutely fantastic!",
    "candidate_labels": ["positive review", "negative review", "neutral review"]
  }'
```

## 📊 Response Format

### Simple Classification (Toxicity)
```json
{
  "label": "Non-toxic",
  "confidence": 0.9876,
  "processing_time_ms": 45.32
}
```

### Detailed Classification (Sentiment, Emotion, Sequence)
```json
{
  "predictions": [
    {"label": "Positive", "confidence": 0.8542},
    {"label": "Neutral", "confidence": 0.1234},
    {"label": "Negative", "confidence": 0.0224}
  ],
  "top_prediction": {
    "label": "Positive",
    "confidence": 0.8542,
    "processing_time_ms": 67.89
  },
  "processing_time_ms": 67.89
}
```

## 🚀 Performance Notes

- **First Request**: May take longer due to model loading
- **Subsequent Requests**: Much faster as models are cached in memory
- **Memory Usage**: ~4-6GB RAM for all models loaded
- **GPU Support**: Uncomment CUDA dependencies in requirements.txt for GPU acceleration

## 🔍 Model Details

### Sentiment Analysis
- Trained on ~124M tweets
- Preprocessing: Converts @mentions to @user and URLs to http
- Best for: Social media content, informal text

### Toxicity Detection
- Fine-tuned DistilBERT
- 94% accuracy on test set
- Note: May have bias for certain identity groups (see model documentation)

### Emotion Classification
- DistilRoBERTa-base fine-tuned on 6 datasets
- Predicts Ekman's 6 basic emotions + neutral
- 66% accuracy vs 14% random baseline

### Zero-shot Classification
- BART-Large fine-tuned on MNLI
- No training required for new labels
- Flexible for various classification tasks

## 🐳 Docker Configuration

The service includes:
- Multi-stage production builds
- Health checks
- Non-root user security
- Volume mounting for development

## 🛡️ Security & Production

### Authentication Security
- **Token-based authentication** protects all API endpoints
- **Minimum 32-character tokens** enforce strong security
- **Environment variable storage** keeps tokens secure
- **Bearer token format** follows industry standards

(see [AUTHENTICATION.md](AUTHENTICATION.md) for more details)

### Production Deployment Checklist
- ✅ Set strong `AUTH_TOKEN` (min 32 chars)
- ✅ Configure CORS origins appropriately  
- ✅ Use HTTPS in production
- ✅ Enable monitoring and logging
- ✅ Consider rate limiting for public APIs
- ✅ Monitor memory usage (~4-6GB required)
- ✅ Use secrets management for AUTH_TOKEN

### Security Features
- **All endpoints protected** except documentation
- **Invalid token rejection** with 401 responses
- **Development mode** can disable auth (AUTH_REQUIRED=false)
- **Token validation** on every request

## 📈 Monitoring

Health check endpoint provides:
- Service status
- Loaded models status
- Basic health information

## 📄 License

This project uses models with various licenses. Check individual model pages for details:
- Twitter RoBERTa: Check model card
- Toxic Comment Model: Check model card
- Emotion Model: Check model card
- BART MNLI: Check model card

## 🔗 References

- [Hugging Face Transformers](https://huggingface.co/transformers/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Model Cards on Hugging Face](https://huggingface.co/models)