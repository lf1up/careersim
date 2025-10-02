import dotenv from 'dotenv';
import Joi from 'joi';
import path from 'path';

// Load .env file from the backend directory
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  
  // Database
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().default(false),
  DB_LOGGING: Joi.boolean().default(false),
  
  // JWT
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  
  // Session
  SESSION_SECRET: Joi.string().min(32).required(),
  
  // Redis
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  
  // Email
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),
  
  // AI Services
  OPENAI_BASE_URL: Joi.string().default('https://api.openai.com/v1'),
  OPENAI_API_KEY: Joi.string().required(),
  OPENAI_MODEL: Joi.string().default('gpt-5'),
  OPENAI_PROVIDER: Joi.string().default('openai'),
  OPENAI_MAX_TOKENS: Joi.number().default(2000),
  OPENAI_TEMPERATURE: Joi.number().min(0).max(2).default(0.8),
  OPENAI_TOP_P: Joi.number().min(0).max(1).default(1.0),
  OPENAI_FREQUENCY_PENALTY: Joi.number().min(-2).max(2).default(0.3),
  OPENAI_PRESENCE_PENALTY: Joi.number().min(-2).max(2).default(0.3),
  // Optional task-specific overrides
  OPENAI_EVAL_MODEL: Joi.string().optional(),
  OPENAI_EVAL_PROVIDER: Joi.string().optional(),
  OPENAI_EVAL_MAX_TOKENS: Joi.number().optional(),
  OPENAI_EVAL_TEMPERATURE: Joi.number().min(0).max(2).default(0.3),
  OPENAI_EVAL_TOP_P: Joi.number().min(0).max(1).optional(),
  OPENAI_EVAL_FREQUENCY_PENALTY: Joi.number().min(-2).max(2).optional(),
  OPENAI_EVAL_PRESENCE_PENALTY: Joi.number().min(-2).max(2).optional(),
  
  // Transformers Microservice
  TRANSFORMERS_API_URL: Joi.string().default('http://localhost:8001'),
  TRANSFORMERS_API_KEY: Joi.string().required(),

  // RAG Microservice
  RAG_API_URL: Joi.string().default('http://localhost:8002'),
  RAG_API_KEY: Joi.string().required(),

  // Stripe
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),
  STRIPE_PUBLISHABLE_KEY: Joi.string().required(),
  
  // File Upload
  MAX_FILE_SIZE: Joi.number().default(10485760), // 10MB
  UPLOAD_PATH: Joi.string().default('./uploads'),
  
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),
  
  // CORS
  ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000,http://localhost:3001'),
}).unknown();

const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

export const config = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  isDevelopment: envVars.NODE_ENV === 'development',
  isProduction: envVars.NODE_ENV === 'production',
  isTest: envVars.NODE_ENV === 'test',
  
  database: {
    host: envVars.DB_HOST,
    port: envVars.DB_PORT,
    username: envVars.DB_USERNAME,
    password: envVars.DB_PASSWORD,
    database: envVars.DB_DATABASE,
    synchronize: envVars.DB_SYNCHRONIZE,
    logging: envVars.DB_LOGGING,
  },
  
  jwt: {
    secret: envVars.JWT_SECRET,
    expiresIn: envVars.JWT_EXPIRES_IN,
    refreshSecret: envVars.JWT_REFRESH_SECRET,
    refreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
  },
  
  session: {
    secret: envVars.SESSION_SECRET,
  },
  
  redis: {
    host: envVars.REDIS_HOST,
    port: envVars.REDIS_PORT,
    password: envVars.REDIS_PASSWORD || undefined,
  },
  
  email: {
    host: envVars.SMTP_HOST,
    port: envVars.SMTP_PORT,
    secure: envVars.SMTP_SECURE,
    user: envVars.SMTP_USER,
    pass: envVars.SMTP_PASS,
  },
  
  ai: {
    openai: {
      baseUrl: envVars.OPENAI_BASE_URL,
      apiKey: envVars.OPENAI_API_KEY,
      model: envVars.OPENAI_MODEL,
      provider: envVars.OPENAI_PROVIDER,
      maxTokens: envVars.OPENAI_MAX_TOKENS,
      temperature: envVars.OPENAI_TEMPERATURE,
      topP: envVars.OPENAI_TOP_P,
      frequencyPenalty: envVars.OPENAI_FREQUENCY_PENALTY,
      presencePenalty: envVars.OPENAI_PRESENCE_PENALTY,
      evalProfile: {
        model: envVars.OPENAI_EVAL_MODEL || envVars.OPENAI_MODEL,
        provider: envVars.OPENAI_EVAL_PROVIDER || envVars.OPENAI_PROVIDER,
        maxTokens: envVars.OPENAI_EVAL_MAX_TOKENS || envVars.OPENAI_MAX_TOKENS,
        temperature: envVars.OPENAI_EVAL_TEMPERATURE || envVars.OPENAI_TEMPERATURE,
        topP: envVars.OPENAI_EVAL_TOP_P || envVars.OPENAI_TOP_P,
        frequencyPenalty: envVars.OPENAI_EVAL_FREQUENCY_PENALTY || envVars.OPENAI_FREQUENCY_PENALTY,
        presencePenalty: envVars.OPENAI_EVAL_PRESENCE_PENALTY || envVars.OPENAI_PRESENCE_PENALTY,
      },
    },
    transformers: {
      apiUrl: envVars.TRANSFORMERS_API_URL,
      apiKey: envVars.TRANSFORMERS_API_KEY,
    },
    rag: {
      apiUrl: envVars.RAG_API_URL,
      apiKey: envVars.RAG_API_KEY,
    },
  },
  
  stripe: {
    secretKey: envVars.STRIPE_SECRET_KEY,
    webhookSecret: envVars.STRIPE_WEBHOOK_SECRET,
    publishableKey: envVars.STRIPE_PUBLISHABLE_KEY,
  },
  
  upload: {
    maxFileSize: envVars.MAX_FILE_SIZE,
    uploadPath: envVars.UPLOAD_PATH,
  },
  
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
  },
  
  cors: {
    allowedOrigins: envVars.ALLOWED_ORIGINS.split(','),
  },
}; 