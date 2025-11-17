// Ensure Jest types/globals are available for ESLint/TS

// Load environment variables from .env file for tests
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from backend directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export {};
