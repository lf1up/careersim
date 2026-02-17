# CareerSim - AI-Powered Career Skills Simulator

**CareerSim** is a direct-to-consumer (B2C) web application designed to help individuals master critical career skills through hyper-realistic, AI-powered simulations. Users can practice challenging professional situations -- from job interviews to difficult conversations -- in a safe, repeatable environment and receive immediate, data-driven feedback to accelerate their personal and professional growth.

The platform empowers users to build confidence and competence for career-defining moments. By leveraging a powerful generative AI engine, CareerSim provides dynamic, conversational practice with a diverse cast of AI personas, moving beyond rote memorization to foster genuine skill development.

## Architecture

CareerSim is a microservices-based application composed of the following services:

```
                        ┌──────────────┐
                        │   Frontend   │
                        │  React + TS  │
                        │  :3000       │
                        └──────┬───────┘
                               │
                        ┌──────▼───────┐
                        │   Backend    │
                        │  Express+TS  │
                        │  :8000       │
                        └──┬───┬───┬───┘
                           │   │   │
              ┌────────────┘   │   └────────────┐
              │                │                │
       ┌──────▼───────┐ ┌─────▼──────┐ ┌───────▼──────┐
       │ Transformers  │ │    RAG     │ │  PostgreSQL   │
       │  FastAPI      │ │  FastAPI   │ │  + Redis      │
       │  :8001        │ │  :8002     │ │  :5432/:6379  │
       └───────────────┘ └────────────┘ └──────────────┘
```

| Service | Stack | Description |
|:--------|:------|:------------|
| **frontend** | React 18, TypeScript, Tailwind CSS, Vite | SPA with simulation UI, analytics dashboard, admin panel |
| **backend** | Express.js, TypeScript, TypeORM, Socket.IO | REST API, JWT auth, Stripe billing, real-time messaging, LangGraph conversation engine |
| **transformers** | FastAPI, HuggingFace Transformers, PyTorch | Sentiment analysis, emotion classification, toxicity detection, zero-shot classification |
| **rag** | FastAPI, ChromaDB, Sentence-Transformers | Document storage and semantic retrieval for persona/simulation knowledge |
| **agent** | Python | Agent service for automated workflows |

## Project Structure

```
careersim/
├── frontend/                  # React SPA
├── backend/                   # Node.js API server
│   └── src/
│       ├── entities/          # TypeORM entities (User, Simulation, Session, etc.)
│       ├── routes/            # REST endpoints (auth, admin, simulations, sessions, etc.)
│       ├── services/
│       │   ├── ai.ts          # OpenAI integration
│       │   └── langgraph/     # LangGraph stateful conversation system
│       ├── middleware/        # Auth, error handling, logging
│       └── config/            # Database, env, Swagger
├── transformers/              # Python NLP microservice
├── rag/                       # Python RAG microservice
├── agent/                     # Python agent service
├── infrastructure/
│   ├── aws/                   # Terraform for ECS/Fargate, RDS, ElastiCache, ALB
│   ├── aws-transformers/      # Standalone Transformers deployment
│   └── k8s/                   # Kustomize manifests (dev + prod overlays)
├── docker-compose.local.yml   # Local development stack
├── PERSONAS.md                # AI persona definitions
└── LICENSE.md                 # MIT License
```

## Quick Start

### Prerequisites

- Node.js >= 22, pnpm >= 10
- Docker and Docker Compose
- An OpenAI-compatible API key

### Local Development with Docker Compose

1. **Clone the repository and configure the backend:**
   ```bash
   cp backend/.env.example backend/.env
   # Edit backend/.env with your API keys (OPENAI_API_KEY, etc.)
   ```

2. **Start all services:**
   ```bash
   docker compose -f docker-compose.local.yml up --build
   ```

   This starts PostgreSQL, Redis, backend (with auto-seeding), and frontend.

3. **Access the application:**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:8000
   - API Docs (Swagger): http://localhost:8000/api-docs

4. **Default admin account** (after seeding):
   - Email: `admin@careersim.com`
   - Password: `admin123!@#`

### Optional: Transformers & RAG Services

The transformers and RAG services can be run locally for advanced NLP features. Uncomment them in `docker-compose.local.yml` or run them standalone:

```bash
# Transformers (sentiment, emotion, toxicity analysis)
cd transformers && pip install -r requirements.txt && python main.py

# RAG (ChromaDB vector search)
cd rag && pip install -r requirements.txt && python main.py
```

> The backend gracefully falls back to keyword-based analysis when these services are unavailable.

See each module's README for detailed setup instructions.

## Core Features

### Simulation Library
A gallery of career challenges presented as interactive cards, filterable by category, skill, and status.

### Live Simulation Interface
Real-time conversational UI powered by Socket.IO with AI personas that respond dynamically based on personality, hidden goals, and difficulty settings.

### LangGraph Conversation Engine
Stateful, multi-node graph architecture for managing AI conversations:
- Process user input, fetch RAG context, generate persona response, analyze quality
- Proactive messages (start, follow-up, inactivity nudges, backchannels)
- Goal evaluation with tool-based assessment and confidence scoring
- PostgreSQL-backed checkpointing for conversation replay and debugging
- LangSmith observability support

### NLP Analysis (Transformers Microservice)
- **Sentiment Analysis** -- Twitter RoBERTa-based (Positive / Neutral / Negative)
- **Emotion Classification** -- 7-class DistilRoBERTa (joy, anger, sadness, fear, surprise, disgust, neutral)
- **Toxicity Detection** -- DistilBERT-based content moderation
- **Zero-shot Classification** -- BART-Large MNLI for custom label classification

### RAG Knowledge Retrieval
Persona and simulation knowledge grounding via ChromaDB vector search with Sentence-Transformers embeddings.

### Performance Analytics ("The Debrief")
Post-simulation review with overall scores, transcript analysis, sentiment graphs, emotion tracking, communication metrics, and AI-generated feedback.

### Admin Panel
Dashboard with user growth metrics, simulation popularity, completion rates, user management, content management, and data export.

### Authentication
JWT-based auth with refresh tokens, email verification, password reset, and role-based access control.

## AI Personas

| Persona | Role | Personality | Simulation |
|:--------|:-----|:------------|:-----------|
| **Brenda Vance** | By-the-Book HR Manager | Formal, professional, risk-averse | The Behavioral Interview |
| **Alex Chen** | Passionate Tech Lead | Enthusiastic, detail-oriented | Tech & Cultural Fit |
| **David Miller** | The Skeptical Veteran | Data-driven, pragmatic, resistant to change | Pitching Your Idea |
| **Sarah Jenkins** | Overwhelmed Colleague | Stressed, sympathetic, boundary-challenged | Saying "No" to Extra Work |
| **Michael Reyes** | Disengaged High-Performer | Intelligent but bored and unmotivated | Re-engaging an Employee |
| **Chloe Davis** | Eager but Anxious Junior | Hardworking but lacks confidence | Delegating a Task |
| **Priya Patel** | Data Analyst Interviewer | Analytical, thorough | Data Analyst Interview |

See [PERSONAS.md](PERSONAS.md) for detailed persona definitions including hidden goals and success criteria.

## Infrastructure

### AWS (Terraform)
Production-ready ECS Fargate deployment with VPC, ALB, RDS PostgreSQL, ElastiCache Redis, EFS, Cloud Map service discovery, and optional GPU instances for transformers. See [infrastructure/aws/README.md](infrastructure/aws/README.md).

### Kubernetes (Kustomize)
Self-hosted deployment with dev and prod overlays, StatefulSets for databases, and GPU scheduling support. See [infrastructure/k8s/README.md](infrastructure/k8s/README.md).

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| Frontend | React 18, TypeScript, Tailwind CSS, Vite, React Router, Socket.IO Client |
| Backend | Node.js, Express.js, TypeScript, TypeORM, Socket.IO, LangGraph/LangChain |
| Databases | PostgreSQL 17, Redis 7, ChromaDB |
| AI/LLM | OpenAI GPT API (via OpenRouter), HuggingFace Transformers, Sentence-Transformers |
| Payments | Stripe |
| Infrastructure | Docker, Terraform (AWS), Kustomize (K8s) |
| Testing | Jest, DeepEval (conversation simulation), Playwright |

## Roadmap

- **Community Features** -- Public leaderboards and discussion forums
- **Certification Paths** -- Structured learning programs with shareable certificates
- **AI Persona Builder** -- User-created custom AI personas for specialized practice
- **Team/B2B Version** -- Enterprise offering with team analytics and management

---

## License

This project is licensed under the MIT License -- see the [LICENSE.md](LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))
