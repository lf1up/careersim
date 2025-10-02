import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import { User } from '@/entities/User';
import { Category } from '@/entities/Category';
import { Persona } from '@/entities/Persona';
import { Simulation } from '@/entities/Simulation';
import { SimulationSession } from '@/entities/SimulationSession';
import { SessionMessage } from '@/entities/SessionMessage';
import { PerformanceAnalytics } from '@/entities/PerformanceAnalytics';
import { Subscription } from '@/entities/Subscription';
import { SystemConfiguration } from '@/entities/SystemConfiguration';

dotenv.config();

const dbSslEnv = (process.env.DB_SSL || '').toLowerCase();
const shouldUseSSL = dbSslEnv === 'true' || dbSslEnv === 'require' || process.env.NODE_ENV === 'production';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'careersim_user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_DATABASE || 'careersim_db',
  synchronize: process.env.DB_SYNCHRONIZE === 'true' || false,
  logging: process.env.DB_LOGGING === 'true' || false,
  entities: [
    User,
    Category,
    Persona,
    Simulation,
    SimulationSession,
    SessionMessage,
    PerformanceAnalytics,
    Subscription,
    SystemConfiguration,
  ],
  migrations: ['src/migrations/*.ts'],
  subscribers: ['src/subscribers/*.ts'],
  extra: {
    ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
  },
});

export const connectDatabase = async (): Promise<void> => {
  try {
    await AppDataSource.initialize();
    console.log('✅ Database connection established successfully');
  } catch (error) {
    console.error('❌ Error during database connection:', error);
    process.exit(1);
  }
};

export default AppDataSource; 