import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { User } from '@/entities/User';

const router: any = Router();

// Get current user profile
router.get('/profile', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { password: _, ...userProfile } = user;
    res.json({ user: userProfile });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// Update user profile
router.patch('/profile', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const { firstName, lastName } = req.body;
    
    const user = await userRepository.findOne({ where: { id: req.user!.id } });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;

    await userRepository.save(user);
    
    const { password: _, ...userProfile } = user;
    res.json({ user: userProfile });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

export default router; 