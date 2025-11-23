// This file is specifically for TypeORM CLI usage
// It only exports the default DataSource as required by TypeORM CLI
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  Category,
  PerformanceAnalytics,
  Persona,
  SessionMessage,
  Simulation,
  SimulationSession,
  Subscription,
  SystemConfiguration,
  User,
} from '@/entities';

dotenv.config();

const dbSslEnv = (process.env.DB_SSL || '').toLowerCase();
const shouldUseSSL = dbSslEnv === 'true' || dbSslEnv === 'require' || process.env.NODE_ENV === 'production';

// Determine if we're running compiled (dist) or source (src) code
// Check if this file is in the dist directory to know we're running compiled code
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isCompiledCode = __dirname.includes('/dist/');
const srcPath = isCompiledCode ? 'dist' : 'src';
const fileExtension = isCompiledCode ? 'js' : 'ts';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'careersim_user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_DATABASE || 'careersim_db',
  synchronize: process.env.DB_SYNCHRONIZE === 'true' || process.env.NODE_ENV !== 'production',
  logging: process.env.DB_LOGGING === 'true' || false,
  entities: [
    Category,
    PerformanceAnalytics,
    Persona,
    SessionMessage,
    Simulation,
    SimulationSession,
    Subscription,
    SystemConfiguration,
    User,
  ],
  migrations: [`${srcPath}/migrations/*.${fileExtension}`],
  subscribers: [`${srcPath}/subscribers/*.${fileExtension}`],
  extra: {
    ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
  },
});

