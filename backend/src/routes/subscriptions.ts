import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { Subscription } from '@/entities/Subscription';
import { User, SubscriptionTier } from '@/entities/User';

const router: any = Router();

// All subscription routes require authentication
router.use(authenticateToken as any);

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