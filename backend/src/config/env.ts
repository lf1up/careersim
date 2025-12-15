import dotenv from 'dotenv';
import { z } from 'zod';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from the backend directory
// Skip loading .env in production when using Kubernetes ConfigMaps/Secrets
if (process.env.NODE_ENV !== 'production' || process.env.LOAD_DOTENV === 'true') {
  dotenv.config({ path: path.join(__dirname, '../../../.env') });
}

// Helper to coerce string env vars to boolean
const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .default(defaultValue.toString())
    .transform((val) => val === 'true' || val === '1');

// Helper to coerce string env vars to number
const numberFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .default(defaultValue.toString())
    .transform((val) => Number(val));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: numberFromString(8000),
    
    // Database
    DB_HOST: z.string().default('localhost'),
    DB_PORT: numberFromString(5432),
    DB_USERNAME: z.string(),
    DB_PASSWORD: z.string(),
    DB_DATABASE: z.string(),
    DB_SYNCHRONIZE: booleanFromString(false),
    DB_LOGGING: booleanFromString(false),
    
    // JWT
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default('7d'),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
    
    // Session
    SESSION_SECRET: z.string().min(32),
    
    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: numberFromString(6379),
    REDIS_PASSWORD: z.string().default(''),
    
    // Email
    SMTP_HOST: z.string(),
    SMTP_PORT: numberFromString(587),
    SMTP_SECURE: booleanFromString(false),
    SMTP_USER: z.string(),
    SMTP_PASS: z.string(),
    
    // AI Services
    OPENAI_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),
    OPENAI_API_KEY: z.string(),
    OPENAI_MODEL: z.string().default('openai/gpt-5.2'),
    OPENAI_PROVIDER: z.string().default('openai'),
    OPENAI_MAX_TOKENS: numberFromString(200000),
    OPENAI_TEMPERATURE: numberFromString(0.8).refine((val) => val >= 0 && val <= 2, {
      message: 'OPENAI_TEMPERATURE must be between 0 and 2',
    }),
    OPENAI_TOP_P: numberFromString(1.0).refine((val) => val >= 0 && val <= 1, {
      message: 'OPENAI_TOP_P must be between 0 and 1',
    }),
    OPENAI_FREQUENCY_PENALTY: numberFromString(0).refine((val) => val >= -2 && val <= 2, {
      message: 'OPENAI_FREQUENCY_PENALTY must be between -2 and 2',
    }),
    OPENAI_PRESENCE_PENALTY: numberFromString(0).refine((val) => val >= -2 && val <= 2, {
      message: 'OPENAI_PRESENCE_PENALTY must be between -2 and 2',
    }),
    // Optional task-specific overrides
    OPENAI_EVAL_MODEL: z.string().default('google/gemini-2.5-flash'),
    OPENAI_EVAL_PROVIDER: z.string().default('google'),
    OPENAI_EVAL_MAX_TOKENS: z.string().optional().transform((val) => (val ? Number(val) : undefined)),
    OPENAI_EVAL_TEMPERATURE: z
      .string()
      .optional()
      .default('0.3')
      .transform((val) => Number(val))
      .refine((val) => val >= 0 && val <= 2, {
        message: 'OPENAI_EVAL_TEMPERATURE must be between 0 and 2',
      }),
    OPENAI_EVAL_TOP_P: z.string().optional().transform((val) => (val ? Number(val) : undefined)),
    OPENAI_EVAL_FREQUENCY_PENALTY: numberFromString(0.3).refine((val) => val >= -2 && val <= 2, {
      message: 'OPENAI_EVAL_FREQUENCY_PENALTY must be between -2 and 2',
    }),
    OPENAI_EVAL_PRESENCE_PENALTY: numberFromString(0.3).refine((val) => val >= -2 && val <= 2, {
      message: 'OPENAI_EVAL_PRESENCE_PENALTY must be between -2 and 2',
    }),
    
    // Transformers Microservice
    TRANSFORMERS_API_URL: z.string().default('http://localhost:8001'),
    TRANSFORMERS_API_KEY: z.string(),

    // RAG Microservice
    RAG_API_URL: z.string().default('http://localhost:8002'),
    RAG_API_KEY: z.string(),

    // LangGraph Configuration
    LANGGRAPH_DEPLOYMENT_URL: z.string().optional(),
    LANGGRAPH_API_KEY: z.string().optional(),
    LANGCHAIN_TRACING_V2: booleanFromString(false),
    LANGCHAIN_PROJECT: z.string().default('careersim-dev'),
    LANGCHAIN_API_KEY: z.string().optional(),
    USE_LANGGRAPH: booleanFromString(true),
    GRAPH_ASSISTANT_ID: z.string().optional(),

    // Stripe
    STRIPE_SECRET_KEY: z.string(),
    STRIPE_WEBHOOK_SECRET: z.string(),
    STRIPE_PUBLISHABLE_KEY: z.string(),
    
    // File Upload
    MAX_FILE_SIZE: numberFromString(10485760), // 10MB
    UPLOAD_PATH: z.string().default('./uploads'),
    
    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: numberFromString(600000), // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: numberFromString(200),
    
    // CORS
    ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  })
  .passthrough();

const result = envSchema.safeParse(process.env);

if (!result.success) {
  throw new Error(`Config validation error: ${result.error.message}`);
}

const envVars = result.data;

export const config: {
  env: 'development' | 'production' | 'test';
  port: number;
  isDevelopment: boolean;
  isProduction: boolean;
  isTest: boolean;
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    synchronize: boolean;
    logging: boolean;
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  session: {
    secret: string;
  };
  redis: {
    host: string;
    port: number;
    password: string | undefined;
  };
  email: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  ai: {
    openai: {
      baseUrl: string;
      apiKey: string;
      model: string;
      provider: string;
      maxTokens: number;
      temperature: number;
      topP: number;
      frequencyPenalty: number;
      presencePenalty: number;
      evalProfile: {
        model: string;
        provider: string;
        maxTokens: number;
        temperature: number;
        topP: number;
        frequencyPenalty: number;
        presencePenalty: number;
      };
    };
    transformers: {
      apiUrl: string;
      apiKey: string;
    };
    rag: {
      apiUrl: string;
      apiKey: string;
    };
  };
  langgraph: {
    deploymentUrl: string | undefined;
    apiKey: string | undefined;
    tracingEnabled: boolean;
    project: string;
    langchainApiKey: string | undefined;
    useLangGraph: boolean;
    assistantId: string | undefined;
  };
  stripe: {
    secretKey: string;
    webhookSecret: string;
    publishableKey: string;
  };
  upload: {
    maxFileSize: number;
    uploadPath: string;
  };
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
  cors: {
    allowedOrigins: string[];
  };
} = {
  env: envVars.NODE_ENV,
  port: envVars.PORT as number,
  isDevelopment: envVars.NODE_ENV === 'development',
  isProduction: envVars.NODE_ENV === 'production',
  isTest: envVars.NODE_ENV === 'test',
  
  database: {
    host: envVars.DB_HOST,
    port: envVars.DB_PORT as number,
    username: envVars.DB_USERNAME,
    password: envVars.DB_PASSWORD,
    database: envVars.DB_DATABASE,
    synchronize: envVars.DB_SYNCHRONIZE as boolean,
    logging: envVars.DB_LOGGING as boolean,
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
    port: envVars.REDIS_PORT as number,
    password: envVars.REDIS_PASSWORD || undefined,
  },
  
  email: {
    host: envVars.SMTP_HOST,
    port: envVars.SMTP_PORT as number,
    secure: envVars.SMTP_SECURE as boolean,
    user: envVars.SMTP_USER,
    pass: envVars.SMTP_PASS,
  },
  
  ai: {
    openai: {
      baseUrl: envVars.OPENAI_BASE_URL,
      apiKey: envVars.OPENAI_API_KEY,
      model: envVars.OPENAI_MODEL,
      provider: envVars.OPENAI_PROVIDER,
      maxTokens: envVars.OPENAI_MAX_TOKENS as number,
      temperature: envVars.OPENAI_TEMPERATURE as number,
      topP: envVars.OPENAI_TOP_P as number,
      frequencyPenalty: envVars.OPENAI_FREQUENCY_PENALTY as number,
      presencePenalty: envVars.OPENAI_PRESENCE_PENALTY as number,
      evalProfile: {
        model: envVars.OPENAI_EVAL_MODEL,
        provider: envVars.OPENAI_EVAL_PROVIDER,
        maxTokens: (envVars.OPENAI_EVAL_MAX_TOKENS as number | undefined) || (envVars.OPENAI_MAX_TOKENS as number),
        temperature: envVars.OPENAI_EVAL_TEMPERATURE as number,
        topP: (envVars.OPENAI_EVAL_TOP_P as number | undefined) || (envVars.OPENAI_TOP_P as number),
        frequencyPenalty: envVars.OPENAI_EVAL_FREQUENCY_PENALTY as number,
        presencePenalty: envVars.OPENAI_EVAL_PRESENCE_PENALTY as number,
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
  
  langgraph: {
    deploymentUrl: envVars.LANGGRAPH_DEPLOYMENT_URL,
    apiKey: envVars.LANGGRAPH_API_KEY,
    tracingEnabled: envVars.LANGCHAIN_TRACING_V2 as boolean,
    project: envVars.LANGCHAIN_PROJECT,
    langchainApiKey: envVars.LANGCHAIN_API_KEY,
    useLangGraph: envVars.USE_LANGGRAPH as boolean,
    assistantId: envVars.GRAPH_ASSISTANT_ID,
  },
  
  stripe: {
    secretKey: envVars.STRIPE_SECRET_KEY,
    webhookSecret: envVars.STRIPE_WEBHOOK_SECRET,
    publishableKey: envVars.STRIPE_PUBLISHABLE_KEY,
  },
  
  upload: {
    maxFileSize: envVars.MAX_FILE_SIZE as number,
    uploadPath: envVars.UPLOAD_PATH,
  },
  
  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS as number,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS as number,
  },
  
  cors: {
    allowedOrigins: envVars.ALLOWED_ORIGINS.split(','),
  },
}; 