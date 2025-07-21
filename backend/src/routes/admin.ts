import { Router, Request, Response, NextFunction } from 'express';
import { AppDataSource } from '@/config/database';
import { User } from '@/entities/User';
import { Simulation, SimulationStatus } from '@/entities/Simulation';
import { Persona } from '@/entities/Persona';
import { Category } from '@/entities/Category';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { Subscription } from '@/entities/Subscription';
import { UserRole, SubscriptionStatus } from '@/types';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '@/middleware/auth';

const router: any = Router();

// Apply authentication and admin role requirement to all routes
router.use(authenticateToken as any);
router.use(requireAdmin as any);

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Get admin dashboard statistics
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 overview:
 *                   type: object
 *                   properties:
 *                     totalUsers:
 *                       type: integer
 *                     activeUsers:
 *                       type: integer
 *                     totalSimulations:
 *                       type: integer
 *                     publishedSimulations:
 *                       type: integer
 *                     totalSessions:
 *                       type: integer
 *                     completedSessions:
 *                       type: integer
 *                     totalSubscriptions:
 *                       type: integer
 *                     activeSubscriptions:
 *                       type: integer
 *                 userGrowth:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       count:
 *                         type: integer
 *                 topSimulations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       title:
 *                         type: string
 *                       id:
 *                         type: string
 *                       total_sessions:
 *                         type: integer
 *                       completed_sessions:
 *                         type: integer
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
// Dashboard stats
router.get('/dashboard', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const subscriptionRepository = AppDataSource.getRepository(Subscription);

    const [
      totalUsers,
      activeUsers,
      totalSimulations,
      publishedSimulations,
      totalSessions,
      completedSessions,
      totalSubscriptions,
      activeSubscriptions,
    ] = await Promise.all([
      userRepository.count(),
      userRepository.count({ where: { isActive: true } }),
      simulationRepository.count(),
      simulationRepository.count({ where: { status: SimulationStatus.PUBLISHED } }),
      sessionRepository.count(),
      sessionRepository.count({ where: { status: SessionStatus.COMPLETED } }),
      subscriptionRepository.count(),
      subscriptionRepository.count({ where: { status: SubscriptionStatus.ACTIVE } }),
    ]);

    // User growth over time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentUsers = await userRepository
      .createQueryBuilder('user')
      .select('DATE(user.createdAt)', 'date')
      .addSelect('COUNT(*)', 'count')
      .where('user.createdAt > :thirtyDaysAgo', { thirtyDaysAgo })
      .groupBy('DATE(user.createdAt)')
      .orderBy('date', 'ASC')
      .getRawMany();

    // Session completion rates by simulation
    const simulationStats = await sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.simulation', 'simulation')
      .select([
        'simulation.title',
        'simulation.id',
        'COUNT(session.id) as total_sessions',
        'SUM(CASE WHEN session.status = :completed THEN 1 ELSE 0 END) as completed_sessions',
      ])
      .setParameter('completed', SessionStatus.COMPLETED)
      .groupBy('simulation.id')
      .orderBy('total_sessions', 'DESC')
      .limit(10)
      .getRawMany();

    res.json({
      overview: {
        totalUsers,
        activeUsers,
        totalSimulations,
        publishedSimulations,
        totalSessions,
        completedSessions,
        totalSubscriptions,
        activeSubscriptions,
      },
      userGrowth: recentUsers,
      topSimulations: simulationStats,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all users with filtering and pagination
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or email
 *       - in: query
 *         name: tier
 *         schema:
 *           type: string
 *           enum: [FREEMIUM, PRO, PREMIUM]
 *         description: Filter by subscription tier
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, inactive]
 *         description: Filter by user status
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     count:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
// User management
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, search, tier, status } = req.query;
    
    const queryBuilder = AppDataSource.getRepository(User)
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.subscription', 'subscription');

    if (search) {
      queryBuilder.where(
        '(user.firstName LIKE :search OR user.lastName LIKE :search OR user.email LIKE :search)',
        { search: `%${search}%` }
      );
    }

    if (tier) {
      queryBuilder.andWhere('user.subscriptionTier = :tier', { tier });
    }

    if (status) {
      queryBuilder.andWhere('user.isActive = :isActive', { isActive: status === 'active' });
    }

    const [users, total] = await queryBuilder
      .orderBy('user.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    res.json({
      users,
      pagination: {
        current: Number(page),
        total: Math.ceil(total / Number(limit)),
        count: total,
        limit: Number(limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}:
 *   get:
 *     summary: Get specific user details
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     responses:
 *       200:
 *         description: User details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 recentSessions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SimulationSession'
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalSessions:
 *                       type: integer
 *                     completedSessions:
 *                       type: integer
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Get specific user details
router.get('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const sessionRepository = AppDataSource.getRepository(SimulationSession);

    const user = await userRepository.findOne({
      where: { id: req.params.id },
      relations: ['subscription', 'simulationSessions'],
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // Get recent sessions with simulation details
    const recentSessions = await sessionRepository.find({
      where: { user: { id: user.id } },
      relations: ['simulation', 'analytics'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    res.json({
      user,
      recentSessions,
      stats: {
        totalSessions: user.simulationSessions?.length || 0,
        completedSessions: user.simulationSessions?.filter(s => s.isCompleted).length || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

/**
 * @swagger
 * /api/admin/users/{id}:
 *   patch:
 *     summary: Update user details
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: User ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [USER, ADMIN]
 *                 description: User role
 *               subscriptionTier:
 *                 type: string
 *                 enum: [FREEMIUM, PRO, PREMIUM]
 *                 description: Subscription tier
 *               isActive:
 *                 type: boolean
 *                 description: Whether user is active
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: User not found
 *       500:
 *         description: Server error
 */
// Update user
router.patch('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const { role, subscriptionTier, isActive } = req.body;

    const user = await userRepository.findOne({
      where: { id: req.params.id },
    });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    if (role !== undefined) user.role = role;
    if (subscriptionTier !== undefined) user.subscriptionTier = subscriptionTier;
    if (isActive !== undefined) user.isActive = isActive;

    await userRepository.save(user);

    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * @swagger
 * /api/admin/simulations:
 *   get:
 *     summary: Get all simulations for admin management
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [DRAFT, PUBLISHED, ARCHIVED]
 *         description: Filter by simulation status
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category ID
 *     responses:
 *       200:
 *         description: Simulations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 simulations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Simulation'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     current:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     count:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
// Simulation management
router.get('/simulations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, status, category } = req.query;
    
    const queryBuilder = AppDataSource.getRepository(Simulation)
      .createQueryBuilder('simulation')
      .leftJoinAndSelect('simulation.category', 'category')
      .leftJoinAndSelect('simulation.persona', 'persona');

    if (status) {
      queryBuilder.where('simulation.status = :status', { status });
    }

    if (category) {
      queryBuilder.andWhere('category.id = :category', { category });
    }

    const [simulations, total] = await queryBuilder
      .orderBy('simulation.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    res.json({
      simulations,
      pagination: {
        current: Number(page),
        total: Math.ceil(total / Number(limit)),
        count: total,
        limit: Number(limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch simulations' });
  }
});

/**
 * @swagger
 * /api/admin/analytics:
 *   get:
 *     summary: Get comprehensive analytics overview
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 userStats:
 *                   type: object
 *                   properties:
 *                     totalUsers:
 *                       type: integer
 *                     activeUsers:
 *                       type: integer
 *                     avgSimulationsPerUser:
 *                       type: number
 *                       format: float
 *                 sessionStats:
 *                   type: object
 *                   properties:
 *                     totalSessions:
 *                       type: integer
 *                     avgDuration:
 *                       type: number
 *                       format: float
 *                     avgScore:
 *                       type: number
 *                       format: float
 *                     completedSessions:
 *                       type: integer
 *                 popularSimulations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       title:
 *                         type: string
 *                       id:
 *                         type: string
 *                       sessionCount:
 *                         type: integer
 *                       avgScore:
 *                         type: number
 *                         format: float
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
// Analytics overview
router.get('/analytics', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const userRepository = AppDataSource.getRepository(User);

    console.log('Starting analytics fetch...');

    // Simple user count first
    const totalUsers = await userRepository.count();
    const activeUsers = await userRepository.count({ where: { isActive: true } });
    
    console.log('User counts:', { totalUsers, activeUsers });

    // Simple session count
    const totalSessions = await sessionRepository.count();
    const completedSessions = await sessionRepository.count({ 
      where: { status: SessionStatus.COMPLETED } 
    });

    console.log('Session counts:', { totalSessions, completedSessions });

    // Calculate averages safely
    let avgSimulationsPerUser = 0;
    let avgDuration = 0;
    let avgScore = 0;

    if (totalUsers > 0) {
      const users = await userRepository.find({ 
        select: ['monthlySimulationsUsed'] 
      });
      avgSimulationsPerUser = users.reduce((sum, user) => sum + user.monthlySimulationsUsed, 0) / totalUsers;
    }

    if (totalSessions > 0) {
      const sessions = await sessionRepository.find({ 
        select: ['durationSeconds', 'overallScore'] 
      });
      avgDuration = sessions.reduce((sum, session) => sum + session.durationSeconds, 0) / totalSessions;
      
      const sessionsWithScore = sessions.filter(s => s.overallScore !== null && s.overallScore !== undefined);
      if (sessionsWithScore.length > 0) {
        avgScore = sessionsWithScore.reduce((sum, session) => sum + (session.overallScore || 0), 0) / sessionsWithScore.length;
      }
    }

    console.log('Calculated averages:', { avgSimulationsPerUser, avgDuration, avgScore });

    // Get popular simulations - simplified
    const popularSimulations: any[] = [];

    res.json({
      userStats: {
        totalUsers,
        activeUsers,
        avgSimulationsPerUser: Number(avgSimulationsPerUser.toFixed(1)),
      },
      sessionStats: {
        totalSessions,
        avgDuration: Number(avgDuration.toFixed(0)),
        avgScore: Number(avgScore.toFixed(1)),
        completedSessions,
      },
      popularSimulations,
    });

    console.log('Analytics response sent successfully');
  } catch (error) {
    console.error('Analytics error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch analytics',
      details: error.message 
    });
  }
});

/**
 * @swagger
 * /api/admin/export/users:
 *   get:
 *     summary: Export user data for admin analysis
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User data exported successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   firstName:
 *                     type: string
 *                   lastName:
 *                     type: string
 *                   email:
 *                     type: string
 *                   role:
 *                     type: string
 *                   subscriptionTier:
 *                     type: string
 *                   isActive:
 *                     type: boolean
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
// Export data
router.get('/export/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userRepository = AppDataSource.getRepository(User);
    const users = await userRepository.find({
      relations: ['subscription'],
    });

    const csvData = users.map(user => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      subscriptionTier: user.subscriptionTier,
      isActive: user.isActive,
      createdAt: user.createdAt,
    }));

    res.json(csvData);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export users' });
  }
});

/**
 * @swagger
 * /api/admin/export/sessions:
 *   get:
 *     summary: Export session data for admin analysis
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Session data exported successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   status:
 *                     type: string
 *                   durationSeconds:
 *                     type: integer
 *                   overallScore:
 *                     type: number
 *                     format: float
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                   user:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       firstName:
 *                         type: string
 *                       lastName:
 *                         type: string
 *                       email:
 *                         type: string
 *                   simulation:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       title:
 *                         type: string
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
router.get('/export/sessions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const sessions = await sessionRepository.find({
      relations: ['user', 'simulation'],
      select: {
        id: true,
        status: true,
        durationSeconds: true,
        overallScore: true,
        createdAt: true,
        user: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
        simulation: {
          id: true,
          title: true,
        },
      },
    });

    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export sessions' });
  }
});

export default router; 