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
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

## 🔧 Usage

The service will be available at `http://localhost:8001`

### API Documentation

- **Interactive docs**: `http://localhost:8001/docs`
- **OpenAPI schema**: `http://localhost:8001/openapi.json`

### Endpoints

#### Health Check
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8001/health
```

#### Sentiment Analysis
```bash
curl -X POST "http://localhost:8001/sentiment" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"text": "I love this new feature!"}'
```

#### Toxicity Detection
```bash
curl -X POST "http://localhost:8001/toxicity" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"text": "This is a normal comment"}'
```

#### Emotion Classification
```bash
curl -X POST "http://localhost:8001/emotion" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"text": "I am so excited about this!"}'
```

#### Zero-shot Classification
```bash
curl -X POST "http://localhost:8001/sequence" \
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

---

## License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
