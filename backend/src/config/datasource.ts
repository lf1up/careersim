// This file is specifically for TypeORM CLI usage
// It only exports the default DataSource as required by TypeORM CLI
import { DataSource } from 'typeorm';
import dotenv from 'dotenv';

dotenv.config();

const dbSslEnv = (process.env.DB_SSL || '').toLowerCase();
const shouldUseSSL = dbSslEnv === 'true' || dbSslEnv === 'require' || process.env.NODE_ENV === 'production';

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'careersim_user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_DATABASE || 'careersim_db',
  synchronize: process.env.DB_SYNCHRONIZE === 'true' || process.env.NODE_ENV !== 'production',
  logging: process.env.DB_LOGGING === 'true' || false,
  entities: ['src/entities/*.ts'],
  migrations: ['src/migrations/*.ts'],
  subscribers: ['src/subscribers/*.ts'],
  extra: {
    ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
  },
});

