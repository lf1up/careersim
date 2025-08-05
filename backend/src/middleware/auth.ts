import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AppDataSource } from '@/config/database';
import { User } from '@/entities/User';
import { UserRole } from '@/types';
import { config } from '@/config/env';

export interface AuthenticatedRequest extends Request {
  user?: User;
  userId?: string;
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export const authenticateToken = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ 
        error: 'Access token required',
        code: 'TOKEN_MISSING',
      });
      return;
    }

    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
    
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: decoded.userId, isActive: true },
      relations: ['subscription'],
    });

    if (!user) {
      res.status(401).json({ 
        error: 'User not found or inactive',
        code: 'USER_NOT_FOUND',
      });
      return;
    }

    req.user = user;
    req.userId = user.id;
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ 
        error: 'Invalid token',
        code: 'TOKEN_INVALID',
      });
      return;
    }
    
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ 
        error: 'Token expired',
        code: 'TOKEN_EXPIRED',
      });
      return;
    }

    res.status(500).json({ 
      error: 'Authentication error',
      code: 'AUTH_ERROR',
    });
  }
};

export const optionalAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      next();
      return;
    }

    const decoded = jwt.verify(token, config.jwt.secret) as JWTPayload;
    
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: decoded.userId, isActive: true },
      relations: ['subscription'],
    });

    if (user) {
      req.user = user;
      req.userId = user.id;
    }

    next();
  } catch (error) {
    // For optional auth, we don't fail on token errors
    next();
  }
};

export const requireRole = (roles: UserRole | UserRole[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ 
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
      return;
    }

    next();
  };
};

export const requireAdmin = requireRole(UserRole.ADMIN);

export const requireSubscription = (requiredTiers?: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ 
        error: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    if (requiredTiers && !requiredTiers.includes(req.user.subscriptionTier)) {
      res.status(403).json({ 
        error: 'Subscription upgrade required',
        code: 'SUBSCRIPTION_REQUIRED',
        data: {
          currentTier: req.user.subscriptionTier,
          requiredTiers,
        },
      });
      return;
    }

    next();
  };
};

export const checkSimulationAccess = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void => {
  if (!req.user) {
    res.status(401).json({ 
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
    return;
  }

  if (!req.user.canAccessSimulation()) {
    res.status(403).json({ 
      error: 'Simulation limit reached',
      code: 'SIMULATION_LIMIT_REACHED',
      data: {
        monthlyUsed: req.user.monthlySimulationsUsed,
        tier: req.user.subscriptionTier,
      },
    });
    return;
  }

  next();
}; 