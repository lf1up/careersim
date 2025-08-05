import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { User } from '@/entities/User';

const router: Router = Router();

/**
 * @swagger
 * /api/users/profile:
 *   get:
 *     summary: Get current user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
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
// Get current user profile
router.get('/profile', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userProfile } = user;
    res.json({ user: userProfile });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

/**
 * @swagger
 * /api/users/profile:
 *   patch:
 *     summary: Update user profile
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *                 maxLength: 255
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 maxLength: 255
 *                 example: "Doe"
 *               bio:
 *                 type: string
 *                 example: "Updated bio"
 *               jobTitle:
 *                 type: string
 *                 maxLength: 100
 *                 example: "Senior Software Engineer"
 *               company:
 *                 type: string
 *                 maxLength: 100
 *                 example: "Tech Corp"
 *               industry:
 *                 type: string
 *                 maxLength: 50
 *                 example: "Technology"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Profile updated successfully"
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Update user profile
router.patch('/profile', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const { firstName, lastName, bio, jobTitle, company, industry, profileImageUrl } = req.body;
    
    const user = await userRepository.findOne({ where: { id: req.user!.id } });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update profile fields if provided
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (bio !== undefined) user.bio = bio;
    if (jobTitle !== undefined) user.jobTitle = jobTitle;
    if (company !== undefined) user.company = company;
    if (industry !== undefined) user.industry = industry;
    if (profileImageUrl !== undefined) user.profileImageUrl = profileImageUrl;

    await userRepository.save(user);
    
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _, ...userProfile } = user;
    res.json({ 
      message: 'Profile updated successfully',
      user: userProfile, 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user profile' });
  }
});

export default router; 