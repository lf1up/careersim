import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { AppDataSource } from '@/config/database';
import { User, UserRole, SubscriptionTier } from '@/entities/User';
import { AuthUtils } from '@/utils/auth';
import { CustomError } from '@/middleware/error';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';

const router = Router();
const userRepository = AppDataSource.getRepository(User);

// Validation middleware
const registerValidation = [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').custom((value) => {
    const validation = AuthUtils.validatePassword(value);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }
    return true;
  }),
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const forgotPasswordValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
];

const resetPasswordValidation = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').custom((value) => {
    const validation = AuthUtils.validatePassword(value);
    if (!validation.isValid) {
      throw new Error(validation.errors.join(', '));
    }
    return true;
  }),
];

// Register new user
router.post('/register', registerValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors.array(),
    });
  }

  const { firstName, lastName, email, password } = req.body;

  // Check if user already exists
  const existingUser = await userRepository.findOne({ where: { email } });
  if (existingUser) {
    return res.status(409).json({
      error: 'User already exists',
      code: 'USER_EXISTS',
    });
  }

  // Create new user
  const hashedPassword = await AuthUtils.hashPassword(password);
  const emailVerificationToken = AuthUtils.generateEmailVerificationToken();

  const user = userRepository.create({
    firstName,
    lastName,
    email,
    password: hashedPassword,
    emailVerificationToken,
    subscriptionTier: SubscriptionTier.FREEMIUM,
    role: UserRole.USER,
  });

  await userRepository.save(user);

  // Generate tokens
  const tokens = AuthUtils.generateTokenPair(user);

  // Remove sensitive data from response
  const { password: _, emailVerificationToken: __, ...userData } = user;

  res.status(201).json({
    message: 'User registered successfully',
    user: userData,
    tokens,
  });
});

// Login user
router.post('/login', loginValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors.array(),
    });
  }

  const { email, password } = req.body;

  // Find user
  const user = await userRepository.findOne({
    where: { email, isActive: true },
    relations: ['subscription'],
  });

  if (!user) {
    return res.status(401).json({
      error: 'Invalid credentials',
      code: 'INVALID_CREDENTIALS',
    });
  }

  // Verify password
  const isPasswordValid = await AuthUtils.comparePassword(password, user.password);
  if (!isPasswordValid) {
    return res.status(401).json({
      error: 'Invalid credentials',
      code: 'INVALID_CREDENTIALS',
    });
  }

  // Update last login
  user.lastLoginAt = new Date();
  await userRepository.save(user);

  // Generate tokens
  const tokens = AuthUtils.generateTokenPair(user);

  // Remove sensitive data from response
  const { password: _, ...userData } = user;

  res.json({
    message: 'Login successful',
    user: userData,
    tokens,
  });
});

// Refresh token
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({
      error: 'Refresh token is required',
      code: 'TOKEN_REQUIRED',
    });
  }

  try {
    // Verify refresh token
    const decoded = AuthUtils.verifyRefreshToken(refreshToken);
    
    // Find user
    const user = await userRepository.findOne({
      where: { id: decoded.userId, isActive: true },
      relations: ['subscription'],
    });

    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Generate new tokens
    const tokens = AuthUtils.generateTokenPair(user);

    res.json({
      message: 'Token refreshed successfully',
      tokens,
    });
  } catch (error) {
    return res.status(401).json({
      error: 'Invalid refresh token',
      code: 'INVALID_REFRESH_TOKEN',
    });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const { password: _, ...userData } = user;

  res.json({
    user: userData,
  });
});

// Forgot password
router.post('/forgot-password', forgotPasswordValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors.array(),
    });
  }

  const { email } = req.body;

  const user = await userRepository.findOne({ where: { email } });
  if (!user) {
    // Don't reveal if user exists or not
    return res.json({
      message: 'If user exists, password reset email has been sent',
    });
  }

  // Generate password reset token
  const { token, expires } = AuthUtils.generatePasswordResetData();
  user.passwordResetToken = token;
  user.passwordResetExpires = expires;

  await userRepository.save(user);

  // TODO: Send password reset email
  // await emailService.sendPasswordResetEmail(user.email, token);

  res.json({
    message: 'If user exists, password reset email has been sent',
  });
});

// Reset password
router.post('/reset-password', resetPasswordValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: errors.array(),
    });
  }

  const { token, password } = req.body;

  const user = await userRepository.findOne({
    where: {
      passwordResetToken: token,
    },
  });

  if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
    return res.status(400).json({
      error: 'Invalid or expired reset token',
      code: 'INVALID_RESET_TOKEN',
    });
  }

  // Update password
  user.password = await AuthUtils.hashPassword(password);
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  await userRepository.save(user);

  res.json({
    message: 'Password reset successfully',
  });
});

// Verify email
router.post('/verify-email', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      error: 'Verification token is required',
      code: 'TOKEN_REQUIRED',
    });
  }

  const user = await userRepository.findOne({
    where: { emailVerificationToken: token },
  });

  if (!user) {
    return res.status(400).json({
      error: 'Invalid verification token',
      code: 'INVALID_VERIFICATION_TOKEN',
    });
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;

  await userRepository.save(user);

  res.json({
    message: 'Email verified successfully',
  });
});

// Logout (mainly for clearing client-side tokens)
router.post('/logout', authenticateToken, async (req: AuthenticatedRequest, res) => {
  // In a more sophisticated setup, you might want to blacklist the token
  res.json({
    message: 'Logged out successfully',
  });
});

export default router; 