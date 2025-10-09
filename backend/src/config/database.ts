import { DataSource } from 'typeorm';
import dotenv from 'dotenv';

dotenv.config();

const dbSslEnv = (process.env.DB_SSL || '').toLowerCase();
const shouldUseSSL = dbSslEnv === 'true' || dbSslEnv === 'require' || process.env.NODE_ENV === 'production';

// Determine if we're running compiled (production) or source (development)
const isProduction = process.env.NODE_ENV === 'production';
const srcPath = isProduction ? 'dist' : 'src';
const fileExtension = isProduction ? 'js' : 'ts';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'careersim_user',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_DATABASE || 'careersim_db',
  synchronize: process.env.DB_SYNCHRONIZE === 'true' || process.env.NODE_ENV !== 'production',
  logging: process.env.DB_LOGGING === 'true' || false,
  entities: [`${srcPath}/entities/*.${fileExtension}`],
  migrations: [`${srcPath}/migrations/*.${fileExtension}`],
  subscribers: [`${srcPath}/subscribers/*.${fileExtension}`],
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

// Export as default for TypeORM CLI
export default AppDataSource; 