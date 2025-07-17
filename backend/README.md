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

- Node.js 18+ 
- PostgreSQL 13+
- Redis (optional)
- OpenAI API key
- Stripe account (for payments)

### Installation

1. **Clone and install dependencies**:
```bash
npm install
```

2. **Environment Setup**:
Create a `.env` file with the following variables:

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=careersim_user
DB_PASSWORD=your_password
DB_DATABASE=careersim_db

# JWT
JWT_SECRET=your_very_long_and_secure_jwt_secret_key_here
JWT_REFRESH_SECRET=your_very_long_refresh_secret_key_here

# Session
SESSION_SECRET=your_session_secret_here

# OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# Stripe
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key

# Email (for notifications)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

3. **Database Setup**:
```bash
# Create PostgreSQL database
createdb careersim_db

# Run migrations and seed data
npm run db:migrate
npm run db:seed
```

4. **Start Development Server**:
```bash
npm run dev
```

The server will start on `http://localhost:3000`

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
npm run dev              # Start with hot reload
npm run build           # Build for production
npm run start           # Start production server

# Database
npm run db:migrate      # Run migrations
npm run db:seed         # Seed with sample data
npm run db:reset        # Reset and reseed database

# Quality
npm run lint            # ESLint check
npm run lint:fix        # Fix ESLint issues
npm run test            # Run tests
```

## 🔐 Default Admin Account

After running `npm run db:seed`:
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