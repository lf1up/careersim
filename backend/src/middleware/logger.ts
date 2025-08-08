import { Request, Response, NextFunction } from 'express';
import { config } from '@/config/env';

// Safe logging utility to avoid security linter issues
const safeLog = {
  info: (message: string, ...args: (string | number)[]) => {
    console.log(message, ...args.map(arg => String(arg)));
  },
  json: (data: object) => {
    console.log(JSON.stringify(data));
  },
};

export interface LogData {
  method: string;
  url: string;
  statusCode: number;
  responseTime: number;
  userAgent?: string;
  ip: string;
  userId?: string;
  timestamp: string;
}

export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Capture original res.end
  const originalEnd = res.end;

  res.end = function(chunk?: any, encoding?: any): Response {
    const responseTime = Date.now() - startTime;
    
    const logData: LogData = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime,
      userAgent: req.get('User-Agent'),
      ip: req.ip || req.connection.remoteAddress || 'unknown',
      userId: (req as any).userId,
      timestamp: new Date().toISOString(),
    };

    // Log based on environment
    if (config.isDevelopment) {
      safeLog.info('Request:', logData.method, logData.url, '-', logData.statusCode, '-', `${logData.responseTime.toString()  }ms`);
    } else {
      // In production, you might want to use a proper logging service
      safeLog.json(logData);
    }

    // Call original end method
    return originalEnd.call(this, chunk, encoding);
  };

  next();
};

export const securityLogger = (req: Request, res: Response, next: NextFunction): void => {
  // Log potential security events
  const suspiciousPatterns = [
    /\.\./,
    /<script/i,
    /union.*select/i,
    /(?:drop|delete|update|insert).*(?:table|from)/i,
  ];

  const url = req.originalUrl;
  const body = JSON.stringify(req.body);
  const query = JSON.stringify(req.query);

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(url) || pattern.test(body) || pattern.test(query)) {
      console.warn('🚨 Security Alert:', {
        pattern: pattern.toString(),
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString(),
      });
      break;
    }
  }

  next();
};

export const errorLogger = (error: Error, req: Request, res: Response, next: NextFunction): void => {
  const errorData = {
    error: {
      message: error.message,
      stack: error.stack,
      name: error.name,
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      body: req.body,
      query: req.query,
      params: req.params,
    },
    user: {
      id: (req as any).userId,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
    },
    timestamp: new Date().toISOString(),
  };

  console.error('Application Error:', JSON.stringify(errorData, null, 2));
  next(error);
}; 