import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { Subscription } from '@/entities/Subscription';
import { User } from '@/entities/User';
import { SubscriptionTier } from '@/types';

const router: any = Router();

// All subscription routes require authentication
router.use(authenticateToken as any);

/**
 * @swagger
 * /api/subscriptions/current:
 *   get:
 *     summary: Get current user's subscription details
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 subscription:
 *                   $ref: '#/components/schemas/Subscription'
 *                 tier:
 *                   type: string
 *                   enum: [FREEMIUM, PRO, PREMIUM]
 *                   description: Current subscription tier
 *                 isActive:
 *                   type: boolean
 *                   description: Whether the subscription is active
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Server error
 */
// Get current user's subscription
router.get('/current', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscriptionRepository = AppDataSource.getRepository(Subscription);
    const subscription = await subscriptionRepository.findOne({
      where: { user: { id: req.user!.id } },
      relations: ['user'],
    });

    res.json({ 
      subscription,
      tier: req.user!.subscriptionTier,
      isActive: subscription?.isActive || false,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

/**
 * @swagger
 * /api/subscriptions/plans:
 *   get:
 *     summary: Get available subscription plans
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription plans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 plans:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       tier:
 *                         type: string
 *                         enum: [FREEMIUM, PRO, PREMIUM]
 *                       name:
 *                         type: string
 *                         example: "Pro"
 *                       price:
 *                         type: number
 *                         example: 29.99
 *                       features:
 *                         type: array
 *                         items:
 *                           type: string
 *                         example: ["50 simulations per month", "Advanced AI feedback"]
 *                       simulationLimit:
 *                         type: integer
 *                         example: 50
 *                         description: Monthly simulation limit (-1 for unlimited)
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Server error
 */
// Get subscription plans (public info)
router.get('/plans', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const plans = [
      {
        tier: SubscriptionTier.FREEMIUM,
        name: 'Free',
        price: 0,
        features: [
          '3 simulations per month',
          'Basic feedback',
          'Community support',
        ],
        simulationLimit: 3,
      },
      {
        tier: SubscriptionTier.PRO,
        name: 'Pro',
        price: 29.99,
        features: [
          '50 simulations per month',
          'Advanced AI feedback',
          'Detailed analytics',
          'Priority support',
        ],
        simulationLimit: 50,
      },
      {
        tier: SubscriptionTier.PREMIUM,
        name: 'Enterprise',
        price: 99.99,
        features: [
          'Unlimited simulations',
          'Custom scenarios',
          'Team management',
          'API access',
          'Dedicated support',
        ],
        simulationLimit: -1, // unlimited
      },
    ];

    res.json({ plans });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
});

/**
 * @swagger
 * /api/subscriptions/upgrade:
 *   post:
 *     summary: Upgrade subscription to a new tier
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tier
 *               - paymentToken
 *             properties:
 *               tier:
 *                 type: string
 *                 enum: [FREEMIUM, PRO, PREMIUM]
 *                 description: Target subscription tier
 *               paymentToken:
 *                 type: string
 *                 description: Payment token from payment provider
 *                 example: "tok_1234567890"
 *     responses:
 *       200:
 *         description: Subscription upgraded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Subscription updated successfully"
 *                 newTier:
 *                   type: string
 *                   example: "PRO"
 *       400:
 *         description: Invalid subscription tier or payment error
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Update subscription (placeholder for payment integration)
router.post('/upgrade', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tier, paymentToken } = req.body;
    
    if (!Object.values(SubscriptionTier).includes(tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    // TODO: Integrate with payment provider (Stripe, PayPal, etc.)
    // For now, just update the user's tier
    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({ where: { id: req.user!.id } });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.subscriptionTier = tier;
    await userRepository.save(user);

    res.json({ 
      message: 'Subscription updated successfully',
      newTier: tier 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

export default router; 