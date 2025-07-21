# CareerSim Backend

A comprehensive Node.js backend for the CareerSim AI-powered career skills simulator platform.

## 🏗️ Architecture Overview

The backend is built with:
- **Framework**: Express.js with TypeScript
- **Database**: PostgreSQL with TypeORM
- **Authentication**: JWT with bcrypt
- **AI Integration**: OpenAI GPT API
- **Real-time**: Socket.IO
- **Admin Panel**: Built-in REST API
- **Caching**: Redis (optional)
- **Payment**: Stripe integration

## 📁 Project Structure

```
src/
├── config/
│   ├── database.ts        # TypeORM configuration
│   └── env.ts             # Environment validation
├── entities/
│   ├── User.ts           # User model with subscriptions
│   ├── Category.ts       # Simulation categories
│   ├── Persona.ts        # AI personas from PERSONAS.md
│   ├── Simulation.ts     # Career simulations
│   ├── SimulationSession.ts  # User sessions
│   ├── SessionMessage.ts     # Conversation messages
│   ├── PerformanceAnalytics.ts  # AI feedback
│   └── Subscription.ts       # Payment subscriptions
├── middleware/
│   ├── auth.ts           # JWT authentication
│   ├── error.ts          # Error handling
│   └── logger.ts         # Request logging
├── routes/
│   ├── auth.ts           # Authentication endpoints
│   ├── admin.ts          # Admin panel API
│   └── [other routes]    # Additional API routes
├── services/
│   └── ai.ts             # OpenAI integration
├── utils/
│   └── auth.ts           # Auth utilities
├── scripts/
│   └── seed.ts           # Database seeding
└── server.ts             # Main application
```

## 🚀 Getting Started

### Prerequisites

- Node.js 22+ 
- PostgreSQL 17+
- Redis (optional)
- OpenAI API key
- Stripe account (for payments)

### Installation

1. **Clone and install dependencies**:
```bash
npm install
```

2. **Environment Setup**:
Create a `.env` file in the backend directory with the following variables:

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
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4-turbo-preview
OPENAI_MAX_TOKENS=2000

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
- Subscription tier management (Freemium/Pro/Premium)

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
- Usage limits for freemium users

### 🤖 AI Integration
- OpenAI GPT integration for realistic persona conversations
- Dynamic system prompts based on persona characteristics
- Sentiment analysis and emotional tone detection
- Performance feedback generation
- Communication pattern analysis

### 📊 Admin Panel
- Dashboard with key metrics and analytics
- User management (view, edit, export)
- Simulation content management
- Performance analytics and insights
- Data export functionality

### 💳 Subscription Management
- Three-tier system (Freemium/Pro/Premium)
- Stripe payment integration ready
- Usage tracking and limits
- Subscription lifecycle management

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Refresh tokens
- `GET /api/auth/me` - Get current user
- `POST /api/auth/forgot-password` - Password reset
- `POST /api/auth/reset-password` - Reset password

### Admin Panel
- `GET /api/admin/dashboard` - Dashboard stats
- `GET /api/admin/users` - User management
- `GET /api/admin/simulations` - Simulation management
- `GET /api/admin/analytics` - Analytics overview
- `GET /api/admin/export/*` - Data export

### Core Features
- `GET /api/simulations` - List simulations
- `POST /api/sessions` - Start simulation
- `POST /api/sessions/:id/messages` - Send message
- `GET /api/analytics/:sessionId` - Performance analytics

## 🎯 Key Features

### 1. **Realistic AI Personas**
Each persona has:
- Detailed personality and motivations
- Hidden goals that users must discover
- Dynamic conversation styles
- Difficulty-based behavior patterns

### 2. **Performance Analytics**
- Real-time sentiment analysis
- Communication pattern tracking
- AI-generated feedback
- Progress tracking over time

### 3. **Subscription System**
- **Freemium**: 3 simulations/month
- **Pro**: Unlimited simulations + advanced analytics
- **Premium**: All features + certification paths

### 4. **Admin Dashboard**
- User growth metrics
- Popular simulations tracking
- Completion rate analysis
- Revenue and subscription analytics

## 🛠️ Development Commands

```bash
# Development
pnpm run dev              # Start with hot reload
pnpm run build           # Build for production
pnpm run start           # Start production server

# Database
pnpm run db:migrate      # Run migrations
pnpm run db:seed         # Seed with sample data
pnpm run db:reset        # Reset and reseed database

# Quality
pnpm run lint            # ESLint check
pnpm run lint:fix        # Fix ESLint issues
pnpm run test            # Run tests
```

## 🔐 Default Admin Account

After running `pnpm run db:seed`:
- **Email**: `admin@careersim.com`
- **Password**: `admin123!@#`

## 📊 Database Schema

The system includes 8 main entities:
1. **Users** - Authentication and subscription management
2. **Categories** - Simulation organization
3. **Personas** - AI character definitions
4. **Simulations** - Career skill scenarios
5. **SimulationSessions** - User practice sessions
6. **SessionMessages** - Conversation history
7. **PerformanceAnalytics** - AI-generated feedback
8. **Subscriptions** - Payment and tier management

## 🚀 Deployment

The backend is production-ready with:
- Environment-based configuration
- Error handling and logging
- Security middleware (Helmet, CORS, Rate limiting)
- Graceful shutdown handling
- Health check endpoint (`/health`)

## 🎓 Next Steps

To extend this backend:
1. Add remaining simulation routes
2. Implement email service for notifications
3. Add more sophisticated AI analytics
4. Integrate with frontend application
5. Set up monitoring and alerting
6. Configure CI/CD pipeline

The backend provides a solid foundation for the CareerSim platform with all core features implemented and ready for integration with a frontend application. 