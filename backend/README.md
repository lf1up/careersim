# CareerSim Backend

> [!WARNING]
> **DEPRECATED — no longer maintained.**
>
> This Express-based backend has been superseded by [`api/`](../api) (Fastify + Drizzle + JWT + SSE streaming). New features, bug fixes, and deployments target `api/` only. This directory is kept **for reference while the cut-over finishes** and will be removed in a future clean-up.
>
> - **Replacement:** [`api/`](../api)
> - **Status:** commented out in `docker-compose.local.yml`; do not re-enable.
> - **Do not add new code here.** If you still need something from this codebase, port it into `api/`.

A comprehensive Node.js backend for the CareerSim AI-powered career skills simulator platform.

## 🏗️ Architecture Overview

The backend is built with:
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with TypeORM
- **Authentication**: JWT with bcrypt
- **AI Integration**: OpenAI GPT API (via OpenRouter), LangGraph/LangChain conversation engine
- **Real-time**: Socket.IO
- **NLP Analysis**: Transformers microservice integration (sentiment, emotion, toxicity)
- **Knowledge Retrieval**: RAG microservice integration (ChromaDB)
- **Admin Panel**: Built-in REST API
- **Caching**: Redis (optional)
- **Payment**: Stripe integration
- **API Documentation**: Swagger/OpenAPI

## 📁 Project Structure

```
src/
├── config/
│   ├── database.ts          # TypeORM configuration
│   ├── datasource.ts        # TypeORM DataSource for migrations
│   ├── env.ts               # Environment validation
│   └── swagger.ts           # Swagger/OpenAPI configuration
├── entities/
│   ├── User.ts              # User model with subscriptions
│   ├── Category.ts          # Simulation categories
│   ├── Persona.ts           # AI personas from PERSONAS.md
│   ├── Simulation.ts        # Career simulations
│   ├── SimulationSession.ts # User sessions
│   ├── SessionMessage.ts    # Conversation messages
│   ├── PerformanceAnalytics.ts # AI feedback
│   ├── Subscription.ts      # Payment subscriptions
│   ├── SystemConfiguration.ts # System-wide settings
│   └── index.ts             # Entity exports
├── middleware/
│   ├── auth.ts              # JWT authentication
│   ├── error.ts             # Error handling
│   └── logger.ts            # Request logging
├── routes/
│   ├── admin.ts             # Admin panel API
│   ├── analytics.ts         # Performance analytics
│   ├── auth.ts              # Authentication endpoints
│   ├── categories.ts        # Simulation categories
│   ├── personas.ts          # AI personas
│   ├── sessions.ts          # User sessions
│   ├── simulations.ts       # Simulation management
│   ├── subscriptions.ts     # Subscription/billing
│   └── users.ts             # User profile
├── services/
│   ├── ai.ts                # OpenAI integration
│   ├── evaluations.ts       # Performance evaluation engine
│   ├── rag.ts               # RAG microservice client
│   ├── realtime.ts          # Socket.IO real-time messaging
│   ├── transformers.ts      # Transformers microservice client
│   └── langgraph/           # LangGraph conversation engine (see langgraph/README.md)
├── tests/
│   ├── setupTests.ts        # Test configuration
│   └── simulation.conversation.spec.ts # Conversation integration tests
├── types/
│   └── index.ts             # Shared TypeScript types
├── utils/
│   ├── auth.ts              # Auth utilities
│   ├── secureRandom.ts      # Cryptographic random helpers
│   └── textSimilarity.ts    # Text comparison utilities
├── scripts/
│   └── seed.ts              # Database seeding
└── server.ts                # Main application entry point
```

## 🚀 Getting Started

### Prerequisites

- Node.js 22+ 
- PostgreSQL 17+
- Redis (optional)
- OpenAI API key
- Stripe account (for payments)
- Transformers microservice (for advanced NLP)

### Installation

1. **Clone and install dependencies**:
```bash
npm install
```

2. **Environment Setup**:
Copy the example environment file and configure it with your settings:
```bash
cp .env.example .env
```

The `.env` file should contain the following variables:

```env
# Server
NODE_ENV=development
PORT=8000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=careersim
DB_PASSWORD=careersim_password
DB_DATABASE=careersim
DB_SYNCHRONIZE=true
DB_LOGGING=false

# JWT - Generate your own secure keys in production
JWT_SECRET=your-super-secret-jwt-key-change-in-production-32chars
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-super-secret-refresh-key-change-in-production-32chars
JWT_REFRESH_EXPIRES_IN=30d

# Session
SESSION_SECRET=your-super-secret-session-key-change-in-production-32chars

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Email (configure with your SMTP provider)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@example.com
SMTP_PASS=your-email-password

# AI Services (add your OpenAI API key)
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o-mini
OPENAI_PROVIDER=openai
OPENAI_MAX_TOKENS=2000
# Optional parameters (AI response evaluations)
OPENAI_EVAL_MODEL=google/gemini-2.5-flash
OPENAI_EVAL_PROVIDER=google
OPENAI_EVAL_MAX_TOKENS=2000
OPENAI_EVAL_TEMPERATURE=0.3
OPENAI_EVAL_TOP_P=1.0
OPENAI_EVAL_FREQUENCY_PENALTY=0.3
OPENAI_EVAL_PRESENCE_PENALTY=0.3

# Stripe (add your Stripe keys)
STRIPE_SECRET_KEY=your-stripe-secret-key
STRIPE_WEBHOOK_SECRET=your-stripe-webhook-secret
STRIPE_PUBLISHABLE_KEY=your-stripe-publishable-key

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_PATH=./uploads

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001

# Transformers Microservice (local NLP models)
TRANSFORMERS_API_URL=http://localhost:8001
TRANSFORMERS_API_KEY=your-super-secret-session-key-change-in-production-32chars

# RAG Microservice
RAG_API_URL=http://localhost:8002
RAG_API_KEY=your-super-secret-session-key-change-in-production-32chars

# LANGCHAIN
USE_LANGGRAPH=true               # Set true when ready
LANGCHAIN_TRACING_V2=false       # Set true for debugging
LANGCHAIN_PROJECT=careersim-dev

# LangGraph Standalone Server (for testing)
LANGGRAPH_SERVER_PORT=8123
LANGGRAPH_SERVER_URL=http://localhost:8123

# DeepEval / Confident AI (for conversation simulator tests - optional)
CONFIDENT_API_KEY=your-confident-ai-api-key-here
```

> **Note**: All these environment variables are validated by the backend on startup. Make sure to update the placeholder values with your actual API keys and credentials.

3. **Database Setup**:
```bash
# Create PostgreSQL database
createdb careersim_db

# Run migrations and seed data
pnpm run db:migrate
pnpm run db:seed
```

4. **Start Development Server**:
```bash
pnpm run dev
```

The server will start on `http://localhost:8000`

## 🐳 Docker Development

For Docker-based development using docker-compose:

1. **Create the `.env` file** in the backend directory (as shown above)

2. **Start the full stack** from the project root:
```bash
docker-compose up --build
```

The docker-compose setup will:
- Read environment variables from `backend/.env`
- Override Docker-specific settings automatically (`DB_HOST=postgres`, `REDIS_HOST=redis`)
- Start PostgreSQL, Redis, backend, and frontend services
- Handle database seeding automatically
- Enable hot reload for development

3. **Services will be available at**:
- Backend API: `http://localhost:8000`
- Frontend: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

> **Note**: The .env file uses `localhost` for `DB_HOST` and `REDIS_HOST` for local development, but Docker Compose automatically overrides these to use the Docker service names (`postgres` and `redis`).

## 🎭 Features Implemented

### 🔐 Authentication System
- User registration/login with email verification
- JWT-based authentication with refresh tokens
- Password reset functionality
- Role-based access control (User/Admin)

### 👥 AI Personas
All personas from `PERSONAS.md` are implemented:

**Job Seeking & Interviewing:**
- Brenda Vance (By-the-Book HR Manager)
- Alex Chen (Passionate Tech Lead)

**Workplace Communication:**
- David Miller (Skeptical Veteran)
- Sarah Jenkins (Overwhelmed Colleague)

**Leadership & Management:**
- Michael Reyes (Disengaged High-Performer)
- Chloe Davis (Eager but Anxious Junior)

### 🎯 Simulation System
- 6 complete simulations matching the personas
- Difficulty levels (Beginner → Expert)
- Real-time AI conversations via Socket.IO
- Performance tracking and analytics

### 🤖 AI Integration
- OpenAI GPT integration for realistic persona conversations
- Dynamic system prompts based on persona characteristics
- Advanced sentiment analysis and emotional tone detection via transformers microservice
- Performance feedback generation
- Communication pattern analysis
- Local transformer models for enhanced NLP processing

### 📊 Admin Panel
- Dashboard with key metrics and analytics
- User management (view, edit, export)
- Simulation content management
- Performance analytics and insights
- Data export functionality

## 🔧 API Endpoints

### Authentication (`/api/auth`)
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh access tokens
- `GET /api/auth/me` - Get current authenticated user
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token
- `POST /api/auth/verify-email` - Verify email address
- `POST /api/auth/logout` - Logout user (clear tokens)

### Admin Panel (`/api/admin`)
**Dashboard & Analytics:**
- `GET /api/admin/dashboard` - Get admin dashboard statistics
- `GET /api/admin/analytics` - Get comprehensive analytics overview

**User Management:**
- `GET /api/admin/users` - Get all users with filtering and pagination
- `GET /api/admin/users/{id}` - Get specific user details
- `PATCH /api/admin/users/{id}` - Update user details (role, tier, status)

**Simulation Management:**
- `GET /api/admin/simulations` - Get all simulations for admin management
- `GET /api/admin/simulations/{id}` - Get specific simulation details
- `PATCH /api/admin/simulations/{id}` - Update simulation details
- `DELETE /api/admin/simulations/{id}` - Delete a simulation

**Persona Management:**
- `GET /api/admin/personas` - Get all personas for admin management
- `GET /api/admin/personas/{id}` - Get specific persona details
- `POST /api/admin/personas` - Create a new persona
- `PATCH /api/admin/personas/{id}` - Update persona details
- `DELETE /api/admin/personas/{id}` - Delete a persona

**Simulation-Persona Associations:**
- `GET /api/admin/simulations/{id}/personas` - Get personas attached to a simulation
- `PUT /api/admin/simulations/{id}/personas` - Update personas attached to a simulation
- `POST /api/admin/simulations/{id}/personas/{personaId}` - Add a persona to a simulation
- `DELETE /api/admin/simulations/{id}/personas/{personaId}` - Remove a persona from a simulation

**System Configuration:**
- `GET /api/admin/system/config` - Get all system configurations
- `PUT /api/admin/system/config/ai` - Update AI model settings
- `PUT /api/admin/system/config/prompts` - Update system prompts

**Data Export:**
- `GET /api/admin/export/users` - Export user data for analysis
- `GET /api/admin/export/sessions` - Export session data for analysis

### Simulations (`/api/simulations`)
- `GET /api/simulations` - Get all published simulations with pagination and filtering
- `GET /api/simulations/{idOrSlug}` - Get simulation by ID or slug
- `GET /api/simulations/{id}/sessions` - Get sessions for a specific simulation
- `POST /api/simulations/{id}/start-session` - Start a new session for a simulation
- `GET /api/simulations/{id}/stats` - Get user's statistics for a specific simulation

**Session Messages:**
- `GET /api/simulations/{id}/sessions/{sessionId}/messages` - Get messages for a session
- `POST /api/simulations/{id}/sessions/{sessionId}/messages` - Add a new message to a session
- `PATCH /api/simulations/{id}/sessions/{sessionId}/messages/{messageId}/highlight` - Highlight/unhighlight a message

### Sessions (`/api/sessions`)
- `GET /api/sessions` - Get user's simulation sessions with filtering and pagination
- `POST /api/sessions` - Start a new simulation session
- `GET /api/sessions/{id}` - Get specific session details with messages
- `PATCH /api/sessions/{id}/status` - Update a session's status
- `PATCH /api/sessions/{id}/complete` - Mark a session as completed

### Analytics (`/api/analytics`)
- `GET /api/analytics/performance` - Get user's performance analytics overview
- `GET /api/analytics/session/{sessionId}` - Get analytics for a specific session

### Categories (`/api/categories`)
- `GET /api/categories` - Get all simulation categories
- `GET /api/categories/{id}` - Get category by ID with associated simulations

### Personas (`/api/personas`)
- `GET /api/personas` - Get all active personas
- `GET /api/personas/{id}` - Get persona by ID with associated simulations

### User Profile (`/api/users`)
- `GET /api/users/profile` - Get current user profile
- `PATCH /api/users/profile` - Update user profile information

## 🎯 Key Features

### 1. **Realistic AI Personas**
Each persona has:
- Detailed personality and motivations
- Hidden goals that users must discover
- Dynamic conversation styles
- Difficulty-based behavior patterns

### 2. **Performance Analytics**
- Real-time sentiment analysis using transformer models
- Emotion detection and toxicity screening
- Communication pattern tracking
- AI-generated feedback
- Progress tracking over time

### 3. **Admin Dashboard**
- User growth metrics
- Popular simulations tracking
- Completion rate analysis
- Revenue and subscription analytics

## 🛠️ Development Commands

```bash
# Development
pnpm run dev                  # Start with hot reload (nodemon)
pnpm run build                # Build for production (tsc + tsc-alias)
pnpm run build:bundle         # Bundle with esbuild (single file)
pnpm run start                # Start production server
pnpm run start:bundle         # Start bundled production server

# Database
pnpm run db:migrate           # Run TypeORM migrations
pnpm run db:migrate:revert    # Revert last migration
pnpm run db:generate          # Generate migration from entity changes
pnpm run db:seed              # Seed with sample data
pnpm run db:seed:force        # Drop schema, migrate, and seed
pnpm run db:reset             # Revert, migrate, and seed

# Quality
pnpm run lint                 # ESLint check
pnpm run lint:fix             # Fix ESLint issues
pnpm run lint:unused          # Find unused exports (ts-prune)
pnpm run security             # Security-focused lint rules
pnpm run security:fix         # Fix security issues

# Testing
pnpm run test                 # Run Jest test suite

# LangGraph
pnpm run langgraph:server     # Start standalone LangGraph server (:8123)
pnpm run langgraph:dev        # Start with hot reload (nodemon)
pnpm run langgraph:test       # Run standalone server tests
pnpm run langgraph:test:deepeval  # Run DeepEval conversation tests

# Simulation E2E Tests
pnpm run test:sim:all         # Run all 7 simulation tests
pnpm run test:sim:behavioral  # Behavioral Interview (Brenda Vance)
pnpm run test:sim:data-analyst # Data Analyst Interview (Priya Patel)
pnpm run test:sim:tech-fit    # Tech & Cultural Fit (Alex Chen)
pnpm run test:sim:pitching    # Pitching Your Idea (David Miller)
pnpm run test:sim:saying-no   # Saying "No" (Sarah Jenkins)
pnpm run test:sim:reengaging  # Re-engaging Employee (Michael Reyes)
pnpm run test:sim:delegating  # Delegating a Task (Chloe Davis)

# LangGraph Debug Scripts
pnpm run debug:graph:validate   # Validate graph structure
pnpm run debug:graph:compile    # Verify graph compilation
pnpm run debug:graph:invoke     # Test invocation with sample data
pnpm run debug:graph:stream     # Test streaming execution
pnpm run debug:graph:proactive  # Test proactive messages
pnpm run debug:graph:visualize  # Generate graph visualization
pnpm run debug:graph:all        # Run all debug scripts
```

## 🔐 Default Admin Account

After running `pnpm run db:seed`:
- **Email**: `admin@careersim.com`
- **Password**: `admin123!@#`

## 📊 Database Schema

The system includes 9 main entities:
1. **Users** - Authentication and subscription management
2. **Categories** - Simulation organization
3. **Personas** - AI character definitions
4. **Simulations** - Career skill scenarios
5. **SimulationSessions** - User practice sessions
6. **SessionMessages** - Conversation history
7. **PerformanceAnalytics** - AI-generated feedback
8. **Subscriptions** - Payment and tier management
9. **SystemConfiguration** - Platform-wide settings (AI models, prompts, etc.)

## 🤖 Transformers Microservice Integration

The backend integrates with a local transformers microservice for advanced NLP processing:

### Features
- **Sentiment Analysis**: Twitter RoBERTa-based sentiment detection (Positive/Neutral/Negative)
- **Emotion Classification**: Multi-class emotion detection (joy, anger, sadness, fear, surprise, disgust, neutral)
- **Toxicity Detection**: Automatic content moderation and toxicity screening
- **Zero-shot Classification**: Custom label classification for specialized use cases

### Configuration
The microservice requires two environment variables:
- `TRANSFORMERS_API_URL`: URL of the transformers microservice (default: `http://localhost:8001`)
- `TRANSFORMERS_API_KEY`: Authentication token for the microservice

### Fallback Behavior
If the transformers microservice is unavailable, the backend automatically falls back to:
- Keyword-based sentiment analysis
- Rule-based emotion detection
- Simple toxicity screening

This ensures the application remains functional even when advanced NLP features are temporarily unavailable.

### Starting the Transformers Service
To start the transformers microservice:
```bash
# From the project root (if the rag service is enabled in docker-compose.yml)
docker compose up transformers --build
```

The service will be available at `http://localhost:8001` with API documentation at `http://localhost:8001/docs`.

## 📚 RAG Microservice Integration

The backend integrates with a local RAG (Retrieval-Augmented Generation) microservice backed by ChromaDB for storing and retrieving knowledge snippets per Persona and per Simulation.

### Features
- Document storage and semantic retrieval with persistent ChromaDB
- Separate collections for persona and simulation knowledge: `persona_docs`, `simulation_docs`
- FastAPI endpoints: `GET /health`, `GET/POST/DELETE /collections`, `POST /upsert`, `POST /query`, `POST /delete`
- Bearer token authentication (can be disabled in development)

### Configuration
The microservice requires two environment variables:
  - `RAG_API_URL`: (default: `http://localhost:8002`)
  - `RAG_API_KEY`: (Bearer token used by the backend when calling the service)

### Fallback Behavior
If the RAG microservice is unavailable, the backend automatically skips RAG context retrieval. Conversations still proceed using LLM responses without RAG grounding.

### Starting the RAG Service
To start the RAG microservice:

```bash
# From the project root (if the rag service is enabled in docker-compose.yml)
docker compose up rag --build
```

The service will be available at `http://localhost:8002` with API documentation at `http://localhost:8002/docs`.

---

## License

This project is licensed under the MIT License -- see the [LICENSE.md](../LICENSE.md) file for details.

## Author

Pavel Vdovenko ([reactivecake@gmail.com](mailto:reactivecake@gmail.com))