import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { AppDataSource } from '@/config/database';
import { User } from '@/entities/User';
import { UserRole, SubscriptionTier } from '@/types';
import { AuthUtils } from '@/utils/auth';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';

const router: Router = Router();
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

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *             properties:
 *               firstName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 minLength: 2
 *                 maxLength: 50
 *                 example: "Doe"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe@example.com"
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: "SecurePass123!"
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "User registered successfully"
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         description: Validation error or user already exists
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "User with this email already exists"
 *                 code:
 *                   type: string
 *                   example: "USER_EXISTS"
 *       500:
 *         description: Server error
 */
// Register new user
router.post('/register', registerValidation, async (req: Request, res: Response) => {
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
  const { password: _password, emailVerificationToken: _emailVerificationToken, ...userData } = user;

  res.status(201).json({
    message: 'User registered successfully',
    user: userData,
    tokens,
  });
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "john.doe@example.com"
 *               password:
 *                 type: string
 *                 example: "SecurePass123!"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Login successful"
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 tokens:
 *                   type: object
 *                   properties:
 *                     accessToken:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                     refreshToken:
 *                       type: string
 *                       example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       400:
 *         description: Validation error
 *       401:
 *         description: Invalid credentials
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Login user
router.post('/login', loginValidation, async (req: Request, res: Response) => {
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
  const { password: _password2, ...userData } = user;

  res.json({
    message: 'Login successful',
    user: userData,
    tokens,
  });
});

// Refresh token
router.post('/refresh', async (req: Request, res: Response) => {
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

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Server error
 */
// Get current user
router.get('/me', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { password: _password3, ...userData } = user;

  res.json({
    user: userData,
  });
});

// Forgot password
router.post('/forgot-password', forgotPasswordValidation, async (req: Request, res: Response) => {
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
router.post('/reset-password', resetPasswordValidation, async (req: Request, res: Response) => {
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
router.post('/verify-email', async (req: Request, res: Response) => {
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

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Logout user (mainly for clearing client-side tokens)
 *     tags: [Authentication]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Logged out successfully"
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Server error
 */
// Logout (mainly for clearing client-side tokens)
router.post('/logout', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  // In a more sophisticated setup, you might want to blacklist the token
  res.json({
    message: 'Logged out successfully',
  });
});

export default router; 