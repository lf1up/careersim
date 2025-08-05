import 'reflect-metadata';
// Configure Transformers.js WASM backend BEFORE any other imports
import '@/config/transformers';
import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import swaggerUi from 'swagger-ui-express';


import { connectDatabase } from '@/config/database';
import { config } from '@/config/env';
import { swaggerSpec } from '@/config/swagger';
import { errorHandler } from '@/middleware/error';
import { requestLogger } from '@/middleware/logger';

// Import routes
import authRoutes from '@/routes/auth';
import userRoutes from '@/routes/users';
import simulationRoutes from '@/routes/simulations';
import personaRoutes from '@/routes/personas';
import categoryRoutes from '@/routes/categories';
import sessionRoutes from '@/routes/sessions';
import analyticsRoutes from '@/routes/analytics';
import adminRoutes from '@/routes/admin';
import subscriptionRoutes from '@/routes/subscriptions';

const app: Express = express();
const server = createServer(app);

// Socket.IO setup for real-time communication
const io = new SocketIOServer(server, {
  cors: {
    origin: config.cors.allowedOrigins,
    methods: ['GET', 'POST'],
  },
});

// Trust proxy for rate limiting and security
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: config.cors.allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting (disabled in development)
if (!config.isDevelopment) {
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: {
      error: 'Too many requests from this IP',
      code: 'RATE_LIMIT_EXCEEDED',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  app.use('/api/', limiter);
  console.log('✅ Rate limiting enabled for production');
} else {
  console.log('🚫 Rate limiting disabled for development');
}

// Compression middleware
app.use(compression());

// Request logging
if (config.isDevelopment) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

app.use(requestLogger);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: config.env,
    version: process.env.npm_package_version || '1.0.0',
  });
});

// API Documentation
if (config.isDevelopment) {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'CareerSim API Documentation',
  }));
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/simulations', simulationRoutes);
app.use('/api/personas', personaRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Join user to their personal room for notifications
  socket.on('join-user-room', (userId) => {
    socket.join(`user-${userId}`);
  });

  // Join simulation session room
  socket.on('join-session', (sessionId) => {
    socket.join(`session-${sessionId}`);
    socket.to(`session-${sessionId}`).emit('user-joined', socket.id);
  });

  // Handle simulation messages
  socket.on('simulation-message', (data) => {
    const { sessionId, message } = data;
    socket.to(`session-${sessionId}`).emit('message-received', {
      sessionId,
      message,
      timestamp: new Date(),
    });
  });

  // Handle typing indicators
  socket.on('typing', (data) => {
    const { sessionId, isTyping } = data;
    socket.to(`session-${sessionId}`).emit('user-typing', {
      userId: socket.id,
      isTyping,
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// 404 handler
app.use('/*any', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    code: 'ROUTE_NOT_FOUND',
    path: req.originalUrl,
  });
});

// Global error handler
app.use(errorHandler);

// Start server
const startServer = async (): Promise<void> => {
  try {
    // Connect to database
    await connectDatabase();

    // Start server
    server.listen(config.port, () => {
      console.log(`🚀 Server running on port ${config.port}`);
      console.log(`📊 Environment: ${config.env}`);
      console.log(`💾 Database connected`);
      console.log(`🔗 Socket.IO enabled`);
      
      if (config.isDevelopment) {
        console.log(`📖 API Documentation: http://localhost:${config.port}/api/docs`);
        console.log(`🔍 Health Check: http://localhost:${config.port}/health`);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Process terminated');
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in production, just log the error
  if (config.isDevelopment) {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
startServer();

export { app, io }; 