# Authentication Guide

## 🔒 Token-Based Authentication

The Transformer Models Microservice uses Bearer token authentication to secure all API endpoints.

## 🚀 Quick Setup

1. **Create environment file**:
   ```bash
   cp env.example .env
   ```

2. **Generate secure token** (minimum 32 characters):
   ```bash
   # Example secure tokens:
   AUTH_TOKEN=sk-prod-2024-secure-random-string-min-32-chars-long-here
   AUTH_TOKEN=bearer_token_production_change_this_to_random_secure_value
   ```

3. **Set in .env file**:
   ```env
   AUTH_TOKEN=your-super-secure-auth-token-min-32-chars-long-change-this-in-production
   AUTH_REQUIRED=true
   ```

## 🔧 Usage Examples

### cURL Examples

```bash
# Health check
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:8000/health

# Sentiment analysis
curl -X POST "http://localhost:8000/sentiment" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -d '{"text": "I love this feature!"}'
```

### Python Examples

```python
import requests

# Set your token
TOKEN = "your-auth-token-here"
headers = {"Authorization": f"Bearer {TOKEN}"}

# Make request
response = requests.post(
    "http://localhost:8000/sentiment",
    json={"text": "This is amazing!"},
    headers=headers
)

print(response.json())
```

### JavaScript/Fetch Example

```javascript
const TOKEN = 'your-auth-token-here';

const response = await fetch('http://localhost:8000/sentiment', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${TOKEN}`
  },
  body: JSON.stringify({
    text: 'This is fantastic!'
  })
});

const result = await response.json();
console.log(result);
```

## 🛡️ Security Features

### Protected Endpoints
- ✅ `/health` - Health check
- ✅ `/sentiment` - Sentiment analysis
- ✅ `/toxicity` - Toxicity detection  
- ✅ `/emotion` - Emotion classification
- ✅ `/sequence` - Zero-shot classification
- ✅ `/` - Root endpoint

### Unprotected Endpoints
- 🔓 `/docs` - API documentation
- 🔓 `/openapi.json` - OpenAPI schema

### Token Requirements
- **Minimum length**: 32 characters
- **Format**: Any string (alphanumeric + special chars)
- **Storage**: Environment variable (`AUTH_TOKEN`)
- **Header**: `Authorization: Bearer TOKEN`

## 🔄 Development Mode

For development, you can disable authentication:

```env
AUTH_REQUIRED=false
```

**⚠️ Warning**: Only use this in development! Never disable authentication in production.

## ❌ Error Responses

### Invalid Token (401)
```json
{
  "detail": "Invalid authentication token"
}
```

### Missing Token (401)
```json
{
  "detail": "Not authenticated"
}
```

## 🔐 Token Generation

### Secure Random Tokens

```bash
# Generate secure 32+ character token
python3 -c "import secrets; print('sk-' + secrets.token_urlsafe(32))"

# Or using openssl
openssl rand -base64 32

# Or using uuidgen
echo "api-$(uuidgen)-$(date +%s)"
```

### Token Format Examples
```
# API key style
sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz

# Bearer token style  
bearer_token_2024_secure_min_32_characters_long_example

# UUID style
api-550e8400-e29b-41d4-a716-446655440000-1703123456
```

## 🐳 Docker Environment Setup

Docker Compose automatically loads the `.env` file, making setup simple:

### Quick Docker Start
```bash
# 1. Setup environment
cp env.example .env
# Edit .env and set your AUTH_TOKEN

# 2. Start with Docker Compose
docker-compose up --build
# The .env file is automatically loaded!
```

### Development Mode
```bash
# Development service with auth disabled
docker-compose --profile dev up transformers-api-dev --build
# AUTH_REQUIRED is automatically set to false for dev
```

### Manual Docker Run
```bash
# If not using docker-compose
docker run --env-file .env -p 8000:8000 transformers-api
```

## 🚀 Production Best Practices

1. **Use secrets management**: AWS Secrets Manager, Azure Key Vault, etc.
2. **Rotate tokens regularly**: Update AUTH_TOKEN periodically
3. **Monitor access**: Log authentication attempts
4. **Use HTTPS**: Never send tokens over HTTP
5. **Restrict CORS**: Configure allowed origins properly
6. **Token length**: Use 40+ characters for production

## 🐛 Troubleshooting

### Common Issues

**"Invalid authentication token"**
- Check token matches exactly in .env file
- Ensure no extra spaces or newlines
- Verify token is at least 32 characters

**"Not authenticated"**  
- Include `Authorization` header
- Use `Bearer ` prefix (note the space)
- Check token is being loaded from .env

**Token not loading**
- Verify .env file exists in working directory
- Check AUTH_TOKEN is set correctly
- Restart service after changing .env

### Debug Commands

```bash
# Check if .env file exists
ls -la .env

# Check token length
python3 -c "import os; from dotenv import load_dotenv; load_dotenv(); print(f'Token length: {len(os.getenv(\"AUTH_TOKEN\", \"\"))}')"

# Test authentication
curl -v -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8000/health
```