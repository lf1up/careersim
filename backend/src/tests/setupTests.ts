// Ensure Jest types/globals are available for ESLint/TS

// Load environment variables from .env file for tests
import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export {};
