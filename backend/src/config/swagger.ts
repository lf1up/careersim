import swaggerJSDoc from 'swagger-jsdoc';
import { config } from './env';

const options: swaggerJSDoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CareerSim API',
      version: '1.0.0',
      description: 'Backend API for CareerSim - AI-Powered Career Skills Simulator',
      contact: {
        name: 'CareerSim Team',
        email: 'support@careersim.com',
      },
      license: {
        name: 'See LICENSE.md',
      },
    },
    servers: [
      {
        url: config.isDevelopment ? `http://localhost:${config.port}` : 'https://api.careersim.com',
        description: config.isDevelopment ? 'Development server' : 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token in the format: your-jwt-token-here (without "Bearer " prefix)',
        },
      },
    },
    // Removed global security - let individual routes specify their security requirements
  },
  apis: [
    './src/routes/*.ts', // Include all route files
    './src/entities/*.ts', // Include entity files for schemas
  ],
};

export const swaggerSpec = swaggerJSDoc(options); 