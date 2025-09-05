import { Router, Response } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '@/config/database';
import { config } from '@/config/env';
import { User } from '@/entities/User';
import { Simulation, SimulationStatus } from '@/entities/Simulation';
import { Category } from '@/entities/Category';
import { Persona } from '@/entities/Persona';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { Subscription } from '@/entities/Subscription';
import { SystemConfiguration, AIModelSettings, SystemPrompts } from '@/entities/SystemConfiguration';
import { SubscriptionStatus } from '@/types';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '@/middleware/auth';
import { AIService } from '@/services/ai';

const router: Router = Router();

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
      .leftJoin('session.simulation', 'simulation')
      .select('simulation.id', 'id')
      .addSelect('simulation.title', 'title')
      .addSelect('COUNT(session.id)', 'total_sessions')
      .addSelect(
        'SUM(CASE WHEN session.status = :completed THEN 1 ELSE 0 END)',
        'completed_sessions',
      )
      .setParameter('completed', SessionStatus.COMPLETED)
      .groupBy('simulation.id')
      .addGroupBy('simulation.title')
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
        { search: `%${search}%` },
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
      .leftJoinAndSelect('simulation.personas', 'personas');

    if (status) {
      queryBuilder.where('simulation.status = :status', { status });
    }

    if (category) {
      // Support both ID (UUID) and slug for category filtering
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(category as string);
      if (isUUID) {
        queryBuilder.andWhere('category.id = :category', { category });
      } else {
        queryBuilder.andWhere('category.slug = :categorySlug', { categorySlug: category });
      }
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
 * /api/admin/simulations:
 *   post:
 *     summary: Create a new simulation
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *               - scenario
 *               - difficulty
 *               - estimatedDurationMinutes
 *               - categoryId
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               scenario:
 *                 type: string
 *               objectives:
 *                 type: array
 *                 items:
 *                   type: string
 *               difficulty:
 *                 type: integer
 *                 enum: [1,2,3,4,5]
 *               estimatedDurationMinutes:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [draft, published, archived]
 *               isPublic:
 *                 type: boolean
 *               thumbnailUrl:
 *                 type: string
 *                 nullable: true
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               conversationGoals:
 *                 type: array
 *                 items:
 *                   type: object
 *               categoryId:
 *                 type: string
 *                 format: uuid
 *     responses:
 *       201:
 *         description: Simulation created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 simulation:
 *                   $ref: '#/components/schemas/Simulation'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       409:
 *         description: Conflict - slug already exists
 *       500:
 *         description: Server error
 */
// Create simulation
router.post('/simulations', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const categoryRepository = AppDataSource.getRepository(Category);

    const {
      title,
      description,
      scenario,
      objectives = [],
      difficulty,
      estimatedDurationMinutes,
      status = SimulationStatus.DRAFT,
      isPublic = true,
      thumbnailUrl,
      tags = [],
      conversationGoals,
      categoryId,
    } = req.body as any;

    // Basic validation
    if (!title || !description || !scenario || !difficulty || !estimatedDurationMinutes || !categoryId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Ensure category exists
    const category = await categoryRepository.findOne({ where: { id: categoryId } });
    if (!category) {
      return res.status(400).json({ error: 'Invalid categoryId' });
    }

    // Generate unique slug from title
    const baseSlug = String(title)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');

    let slug = baseSlug || `simulation-${Date.now()}`;
    let suffix = 1;
    // Check uniqueness
     
    while (true) {
      const exists = await simulationRepository.findOne({ where: { slug } });
      if (!exists) break;
      slug = `${baseSlug}-${suffix++}`;
    }

    const simulation = simulationRepository.create({
      title,
      slug,
      description,
      scenario,
      objectives: Array.isArray(objectives) ? objectives : [],
      difficulty,
      estimatedDurationMinutes,
      status,
      isPublic: !!isPublic,
      thumbnailUrl,
      tags: Array.isArray(tags) ? tags : [],
      conversationGoals: Array.isArray(conversationGoals) ? conversationGoals : undefined,
      category,
      personas: [],
    });

    await simulationRepository.save(simulation);

    const created = await simulationRepository.findOne({
      where: { id: simulation.id },
      relations: ['category', 'personas'],
    });

    res.status(201).json({ simulation: created });
  } catch (error) {
    console.error('Error creating simulation:', error);
    res.status(500).json({ error: 'Failed to create simulation' });
  }
});

/**
 * @swagger
 * /api/admin/simulations/{id}:
 *   get:
 *     summary: Get specific simulation details for admin
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
 *         description: Simulation ID
 *     responses:
 *       200:
 *         description: Simulation details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 simulation:
 *                   $ref: '#/components/schemas/Simulation'
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalSessions:
 *                       type: integer
 *                     completedSessions:
 *                       type: integer
 *                     avgScore:
 *                       type: number
 *                       format: float
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
// Get specific simulation details
router.get('/simulations/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const sessionRepository = AppDataSource.getRepository(SimulationSession);

    const simulation = await simulationRepository.findOne({
      where: { id: req.params.id },
      relations: ['category', 'persona'],
    });

    if (!simulation) {
      return res.status(404).json({
        error: 'Simulation not found',
        code: 'SIMULATION_NOT_FOUND',
      });
    }

    // Get simulation statistics
    const totalSessions = await sessionRepository.count({
      where: { simulation: { id: simulation.id } },
    });

    const completedSessions = await sessionRepository.find({
      where: { 
        simulation: { id: simulation.id },
        status: SessionStatus.COMPLETED, 
      },
      select: ['overallScore'],
    });

    const avgScore = completedSessions.length > 0 
      ? completedSessions.reduce((sum, session) => sum + (session.overallScore || 0), 0) / completedSessions.length
      : 0;

    res.json({
      simulation,
      stats: {
        totalSessions,
        completedSessions: completedSessions.length,
        avgScore: Number(avgScore.toFixed(1)),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch simulation details' });
  }
});

/**
 * @swagger
 * /api/admin/simulations/{id}:
 *   patch:
 *     summary: Update simulation details
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
 *         description: Simulation ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 maxLength: 255
 *               slug:
 *                 type: string
 *                 maxLength: 255
 *               description:
 *                 type: string
 *               scenario:
 *                 type: string
 *               objectives:
 *                 type: array
 *                 items:
 *                   type: string
 *               difficulty:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               estimatedDurationMinutes:
 *                 type: integer
 *                 minimum: 1
 *               status:
 *                 type: string
 *                 enum: [DRAFT, PUBLISHED, ARCHIVED]
 *               isPublic:
 *                 type: boolean
 *               thumbnailUrl:
 *                 type: string
 *                 nullable: true
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *               conversationGoals:
 *                 type: array
 *                 nullable: true
 *                 items:
 *                   type: object
 *                   properties:
 *                     stepNumber:
 *                       type: integer
 *                     isOptional:
 *                       type: boolean
 *                     title:
 *                       type: string
 *                     description:
 *                       type: string
 *                     keyBehaviors:
 *                       type: array
 *                       items:
 *                         type: string
 *                     successIndicators:
 *                       type: array
 *                       items:
 *                         type: string
 *     responses:
 *       200:
 *         description: Simulation updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 simulation:
 *                   $ref: '#/components/schemas/Simulation'
 *       400:
 *         description: Bad request - validation errors
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Simulation not found
 *       409:
 *         description: Conflict - slug already exists
 *       500:
 *         description: Server error
 */
// Update simulation
router.patch('/simulations/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const {
      title,
      slug,
      description,
      scenario,
      objectives,
      difficulty,
      estimatedDurationMinutes,
      status,
      isPublic,
      thumbnailUrl,
      tags,
      conversationGoals,
    } = req.body;

    const simulation = await simulationRepository.findOne({
      where: { id: req.params.id },
      relations: ['category', 'persona'],
    });

    if (!simulation) {
      return res.status(404).json({
        error: 'Simulation not found',
        code: 'SIMULATION_NOT_FOUND',
      });
    }

    // Check if slug already exists (excluding current simulation)
    if (slug && slug !== simulation.slug) {
      const existingSimulation = await simulationRepository.findOne({
        where: { slug },
      });

      if (existingSimulation) {
        return res.status(409).json({
          error: 'Simulation with this slug already exists',
          code: 'SLUG_ALREADY_EXISTS',
        });
      }
    }

    // Update fields if provided
    if (title !== undefined) simulation.title = title;
    if (slug !== undefined) simulation.slug = slug;
    if (description !== undefined) simulation.description = description;
    if (scenario !== undefined) simulation.scenario = scenario;
    if (objectives !== undefined) simulation.objectives = objectives;
    if (difficulty !== undefined) simulation.difficulty = difficulty;
    if (estimatedDurationMinutes !== undefined) simulation.estimatedDurationMinutes = estimatedDurationMinutes;
    if (status !== undefined) simulation.status = status;
    if (isPublic !== undefined) simulation.isPublic = !!isPublic;
    if (thumbnailUrl !== undefined) simulation.thumbnailUrl = thumbnailUrl;
    if (Array.isArray(tags)) simulation.tags = tags;
    if (conversationGoals !== undefined) simulation.conversationGoals = conversationGoals;

    await simulationRepository.save(simulation);

    res.json({ simulation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update simulation' });
  }
});

/**
 * @swagger
 * /api/admin/simulations/{id}:
 *   delete:
 *     summary: Delete a simulation
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
 *         description: Simulation ID
 *     responses:
 *       200:
 *         description: Simulation deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Simulation deleted successfully"
 *       400:
 *         description: Bad request - simulation has associated sessions
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
// Delete simulation
router.delete('/simulations/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const sessionRepository = AppDataSource.getRepository(SimulationSession);

    const simulation = await simulationRepository.findOne({
      where: { id: req.params.id },
    });

    if (!simulation) {
      return res.status(404).json({
        error: 'Simulation not found',
        code: 'SIMULATION_NOT_FOUND',
      });
    }

    // Check if simulation has associated sessions
    const sessionsCount = await sessionRepository.count({
      where: { simulation: { id: simulation.id } },
    });

    if (sessionsCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete simulation with associated sessions',
        code: 'SIMULATION_HAS_SESSIONS',
        sessionsCount,
      });
    }

    await simulationRepository.remove(simulation);

    res.json({
      message: 'Simulation deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete simulation' });
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

    // User counts
    const totalUsers = await userRepository.count();
    const activeUsers = await userRepository.count({ where: { isActive: true } });

    // Session counts
    const totalSessions = await sessionRepository.count();
    const completedSessions = await sessionRepository.count({ where: { status: SessionStatus.COMPLETED } });

    // Averages
    let avgSimulationsPerUser = 0;
    let avgDuration = 0;
    let avgScore = 0;

    if (totalUsers > 0) {
      const users = await userRepository.find({ select: ['monthlySimulationsUsed'] });
      avgSimulationsPerUser = users.reduce((sum, user) => sum + (user.monthlySimulationsUsed || 0), 0) / totalUsers;
    }

    if (totalSessions > 0) {
      const sessions = await sessionRepository.find({ select: ['durationSeconds', 'overallScore'] });
      avgDuration = sessions.reduce((sum, session) => sum + (session.durationSeconds || 0), 0) / totalSessions;
      const sessionsWithScore = sessions.filter(s => s.overallScore !== null && s.overallScore !== undefined);
      if (sessionsWithScore.length > 0) {
        avgScore = sessionsWithScore.reduce((sum, session) => sum + (session.overallScore || 0), 0) / sessionsWithScore.length;
      }
    }

    // Popular simulations: top 10 by session count with avg score
    const popularRaw = await sessionRepository
      .createQueryBuilder('session')
      .leftJoin('session.simulation', 'simulation')
      .select('simulation.id', 'id')
      .addSelect('simulation.title', 'title')
      .addSelect('COUNT(session.id)', 'sessionCount')
      .addSelect('AVG(session.overallScore)', 'avgScore')
      .groupBy('simulation.id')
      .orderBy('"sessionCount"', 'DESC')
      .limit(10)
      .getRawMany();

    const popularSimulations = popularRaw.map((row: any) => ({
      id: row.id,
      title: row.title,
      sessionCount: Number(row.sessionCount) || 0,
      avgScore: Number(parseFloat(row.avgScore as string || '0').toFixed(1)),
    }));

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
  } catch (error) {
    console.error('Analytics error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to fetch analytics',
      details: error.message, 
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
 *     parameters:
 *       - in: query
 *         name: includeMessages
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include full conversation logs per session
 *       - in: query
 *         name: includeAnalytics
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include performance analytics when available
 *       - in: query
 *         name: includeGoals
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include simulation conversation goals and session goal progress
 *     responses:
 *       200:
 *         description: Session data exported successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
router.get('/export/sessions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const includeMessages = String(req.query.includeMessages ?? 'true') === 'true';
    const includeAnalytics = String(req.query.includeAnalytics ?? 'true') === 'true';
    const includeGoals = String(req.query.includeGoals ?? 'true') === 'true';

    const sessionRepository = AppDataSource.getRepository(SimulationSession);

    // Load base relations
    const query = sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.user', 'user')
      .leftJoinAndSelect('session.simulation', 'simulation');

    if (includeMessages) {
      query.leftJoinAndSelect('session.messages', 'messages').orderBy('messages.sequenceNumber', 'ASC');
    }
    if (includeAnalytics) {
      query.leftJoinAndSelect('session.analytics', 'analytics');
    }

    // For JSON columns that are not selected by default in some drivers
    if (includeGoals) {
      query.addSelect('session.goalProgress');
    }

    const sessions = await query.getMany();

    const result = sessions.map((s) => {
      const base: any = {
        id: s.id,
        status: s.status,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationSeconds: s.durationSeconds,
        messageCount: s.messageCount,
        overallScore: s.overallScore ?? null,
        scores: s.scores ?? null,
        userGoals: s.userGoals ?? null,
        sessionMetadata: s.sessionMetadata ?? null,
        userFeedback: s.userFeedback ?? null,
        userRating: s.userRating ?? null,
        completionData: s.completionData ?? null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        user: s.user
          ? {
            id: s.user.id,
            firstName: s.user.firstName,
            lastName: s.user.lastName,
            email: s.user.email,
          }
          : null,
        simulation: s.simulation
          ? {
            id: s.simulation.id,
            title: s.simulation.title,
            slug: s.simulation.slug,
            difficulty: s.simulation.difficulty,
            status: s.simulation.status,
            tags: s.simulation.tags,
            conversationGoals: includeGoals ? (s.simulation.conversationGoals || []) : undefined,
          }
          : null,
      };

      if (includeGoals) {
        (base as any).goalProgress = s.goalProgress ?? [];
      }
      if (includeAnalytics) {
        (base as any).analytics = s.analytics || null;
      }
      if (includeMessages) {
        (base as any).messages = (s.messages || []).map((m) => ({
          id: m.id,
          sessionId: m.sessionId,
          sequenceNumber: m.sequenceNumber,
          type: m.type,
          content: m.content,
          inputMethod: m.inputMethod ?? null,
          metadata: m.metadata ?? null,
          timestamp: m.timestamp ?? null,
          isHighlighted: m.isHighlighted,
          highlightReason: m.highlightReason ?? null,
          analysisData: m.analysisData ?? null,
          isFromUser: m.isFromUser,
          isFromAI: m.isFromAI,
          wordCount: m.wordCount,
          hasEmotionalTone: m.hasEmotionalTone,
          createdAt: m.createdAt,
        }));
      }

      return base;
    });

    res.json(result);
  } catch (error) {
    console.error('Failed to export sessions:', error);
    res.status(500).json({ error: 'Failed to export sessions' });
  }
});

/**
 * @swagger
 * /api/admin/personas:
 *   get:
 *     summary: Get all personas for admin management
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
 *         name: category
 *         schema:
 *           type: string
 *           enum: [job_seeking, workplace_communication, leadership]
 *         description: Filter by persona category
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name or role
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *     responses:
 *       200:
 *         description: Personas retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 personas:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Persona'
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
// Persona management
router.get('/personas', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, category, search, active } = req.query;
    
    const queryBuilder = AppDataSource.getRepository(Persona)
      .createQueryBuilder('persona')
      .leftJoinAndSelect('persona.simulations', 'simulations');

    if (category) {
      queryBuilder.where('persona.category = :category', { category });
    }

    if (search) {
      const searchCondition = category ? 'AND' : 'WHERE';
      queryBuilder[searchCondition.toLowerCase()](
        '(persona.name LIKE :search OR persona.role LIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (active !== undefined) {
      const activeCondition = category || search ? 'AND' : 'WHERE';
      queryBuilder[activeCondition.toLowerCase()]('persona.isActive = :active', { active: active === 'true' });
    }

    const [personas, total] = await queryBuilder
      .orderBy('persona.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    res.json({
      personas,
      pagination: {
        current: Number(page),
        total: Math.ceil(total / Number(limit)),
        count: total,
        limit: Number(limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch personas' });
  }
});

/**
 * @swagger
 * /api/admin/personas/{id}:
 *   get:
 *     summary: Get specific persona details for admin
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
 *         description: Persona ID
 *     responses:
 *       200:
 *         description: Persona details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 persona:
 *                   $ref: '#/components/schemas/Persona'
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalSimulations:
 *                       type: integer
 *                     totalSessions:
 *                       type: integer
 *                     avgScore:
 *                       type: number
 *                       format: float
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Persona not found
 *       500:
 *         description: Server error
 */
// Get specific persona details
router.get('/personas/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const personaRepository = AppDataSource.getRepository(Persona);
    const sessionRepository = AppDataSource.getRepository(SimulationSession);

    const persona = await personaRepository.findOne({
      where: { id: req.params.id },
      relations: ['simulations'],
    });

    if (!persona) {
      return res.status(404).json({
        error: 'Persona not found',
        code: 'PERSONA_NOT_FOUND',
      });
    }

    // Get persona statistics
    const totalSessions = await sessionRepository
      .createQueryBuilder('session')
      .leftJoin('session.simulation', 'simulation')
      .leftJoin('simulation.personas', 'persona')
      .where('persona.id = :personaId', { personaId: persona.id })
      .getCount();

    const completedSessions = await sessionRepository
      .createQueryBuilder('session')
      .leftJoin('session.simulation', 'simulation')
      .leftJoin('simulation.personas', 'persona')
      .where('persona.id = :personaId', { personaId: persona.id })
      .andWhere('session.status = :status', { status: SessionStatus.COMPLETED })
      .select(['session.overallScore'])
      .getMany();

    const avgScore = completedSessions.length > 0 
      ? completedSessions.reduce((sum, session) => sum + (session.overallScore || 0), 0) / completedSessions.length
      : 0;

    res.json({
      persona,
      stats: {
        totalSimulations: persona.simulations?.length || 0,
        totalSessions,
        avgScore: Number(avgScore.toFixed(1)),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch persona details' });
  }
});

/**
 * @swagger
 * /api/admin/personas:
 *   post:
 *     summary: Create a new persona
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - slug
 *               - role
 *               - personality
 *               - primaryGoal
 *               - hiddenMotivation
 *               - category
 *               - difficultyLevel
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 255
 *                 example: "Sarah Johnson"
 *               slug:
 *                 type: string
 *                 maxLength: 255
 *                 example: "sarah-johnson-hr-manager"
 *               role:
 *                 type: string
 *                 maxLength: 255
 *                 example: "Senior HR Manager"
 *               personality:
 *                 type: string
 *                 example: "Professional, direct, and results-oriented"
 *               primaryGoal:
 *                 type: string
 *                 example: "Find the best candidate for senior positions"
 *               hiddenMotivation:
 *                 type: string
 *                 example: "Under pressure to fill positions quickly"
 *               category:
 *                 type: string
 *                 enum: [job_seeking, workplace_communication, leadership]
 *                 example: "job_seeking"
 *               difficultyLevel:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *                 example: 3
 *               avatarUrl:
 *                 type: string
 *                 nullable: true
 *                 maxLength: 255
 *                 example: "https://example.com/avatars/sarah.jpg"
 *               backgroundStory:
 *                 type: string
 *                 nullable: true
 *                 example: "Sarah has been in HR for 10 years"
 *               conversationStyle:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   tone:
 *                     type: string
 *                     example: "professional"
 *                   formality:
 *                     type: string
 *                     example: "formal"
 *                   pace:
 *                     type: string
 *                     example: "fast"
 *                   emotionalRange:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["focused", "impatient"]
 *                   commonPhrases:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["Let's get to the point"]
 *               triggerWords:
 *                 type: array
 *                 nullable: true
 *                 items:
 *                   type: string
 *                 example: ["inexperienced", "unclear"]
 *               responsePatterns:
 *                 type: object
 *                 nullable: true
 *                 properties:
 *                   positive:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["Excellent point"]
 *                   negative:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["I'm not convinced"]
 *                   neutral:
 *                     type: array
 *                     items:
 *                       type: string
 *                     example: ["Tell me more"]
 *               isActive:
 *                 type: boolean
 *                 default: true
 *                 example: true
 *     responses:
 *       201:
 *         description: Persona created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 persona:
 *                   $ref: '#/components/schemas/Persona'
 *       400:
 *         description: Bad request - validation errors
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       409:
 *         description: Conflict - slug already exists
 *       500:
 *         description: Server error
 */
// Create new persona
router.post('/personas', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const personaRepository = AppDataSource.getRepository(Persona);
    const {
      name,
      slug,
      role,
      personality,
      primaryGoal,
      hiddenMotivation,
      category,
      difficultyLevel,
      avatarUrl,
      backgroundStory,
      conversationStyle,
      triggerWords,
      responsePatterns,
      isActive = true,
    } = req.body;

    // Check if slug already exists
    const existingPersona = await personaRepository.findOne({
      where: { slug },
    });

    if (existingPersona) {
      return res.status(409).json({
        error: 'Persona with this slug already exists',
        code: 'SLUG_ALREADY_EXISTS',
      });
    }

    const persona = personaRepository.create({
      name,
      slug,
      role,
      personality,
      primaryGoal,
      hiddenMotivation,
      category,
      difficultyLevel,
      avatarUrl,
      backgroundStory,
      conversationStyle,
      triggerWords,
      responsePatterns,
      isActive,
    });

    await personaRepository.save(persona);

    res.status(201).json({ persona });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create persona' });
  }
});

/**
 * @swagger
 * /api/admin/personas/{id}:
 *   patch:
 *     summary: Update persona details
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
 *         description: Persona ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 maxLength: 255
 *               slug:
 *                 type: string
 *                 maxLength: 255
 *               role:
 *                 type: string
 *                 maxLength: 255
 *               personality:
 *                 type: string
 *               primaryGoal:
 *                 type: string
 *               hiddenMotivation:
 *                 type: string
 *               category:
 *                 type: string
 *                 enum: [job_seeking, workplace_communication, leadership]
 *               difficultyLevel:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 5
 *               avatarUrl:
 *                 type: string
 *                 nullable: true
 *                 maxLength: 255
 *               backgroundStory:
 *                 type: string
 *                 nullable: true
 *               conversationStyle:
 *                 type: object
 *                 nullable: true
 *               triggerWords:
 *                 type: array
 *                 nullable: true
 *                 items:
 *                   type: string
 *               responsePatterns:
 *                 type: object
 *                 nullable: true
 *               isActive:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Persona updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 persona:
 *                   $ref: '#/components/schemas/Persona'
 *       400:
 *         description: Bad request - validation errors
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Persona not found
 *       409:
 *         description: Conflict - slug already exists
 *       500:
 *         description: Server error
 */
// Update persona
router.patch('/personas/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const personaRepository = AppDataSource.getRepository(Persona);
    const {
      name,
      slug,
      role,
      personality,
      primaryGoal,
      hiddenMotivation,
      category,
      difficultyLevel,
      avatarUrl,
      backgroundStory,
      conversationStyle,
      triggerWords,
      responsePatterns,
      isActive,
    } = req.body;

    const persona = await personaRepository.findOne({
      where: { id: req.params.id },
    });

    if (!persona) {
      return res.status(404).json({
        error: 'Persona not found',
        code: 'PERSONA_NOT_FOUND',
      });
    }

    // Check if slug already exists (excluding current persona)
    if (slug && slug !== persona.slug) {
      const existingPersona = await personaRepository.findOne({
        where: { slug },
      });

      if (existingPersona) {
        return res.status(409).json({
          error: 'Persona with this slug already exists',
          code: 'SLUG_ALREADY_EXISTS',
        });
      }
    }

    // Update fields if provided
    if (name !== undefined) persona.name = name;
    if (slug !== undefined) persona.slug = slug;
    if (role !== undefined) persona.role = role;
    if (personality !== undefined) persona.personality = personality;
    if (primaryGoal !== undefined) persona.primaryGoal = primaryGoal;
    if (hiddenMotivation !== undefined) persona.hiddenMotivation = hiddenMotivation;
    if (category !== undefined) persona.category = category;
    if (difficultyLevel !== undefined) persona.difficultyLevel = difficultyLevel;
    if (avatarUrl !== undefined) persona.avatarUrl = avatarUrl;
    if (backgroundStory !== undefined) persona.backgroundStory = backgroundStory;
    if (conversationStyle !== undefined) persona.conversationStyle = conversationStyle;
    if (triggerWords !== undefined) persona.triggerWords = triggerWords;
    if (responsePatterns !== undefined) persona.responsePatterns = responsePatterns;
    if (isActive !== undefined) persona.isActive = isActive;

    await personaRepository.save(persona);

    res.json({ persona });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update persona' });
  }
});

/**
 * @swagger
 * /api/admin/personas/{id}:
 *   delete:
 *     summary: Delete a persona
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
 *         description: Persona ID
 *     responses:
 *       200:
 *         description: Persona deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Persona deleted successfully"
 *       400:
 *         description: Bad request - persona has associated simulations
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Persona not found
 *       500:
 *         description: Server error
 */
// Delete persona
router.delete('/personas/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const personaRepository = AppDataSource.getRepository(Persona);
    const simulationRepository = AppDataSource.getRepository(Simulation);

    const persona = await personaRepository.findOne({
      where: { id: req.params.id },
    });

    if (!persona) {
      return res.status(404).json({
        error: 'Persona not found',
        code: 'PERSONA_NOT_FOUND',
      });
    }

    // Check if persona has associated simulations
    const simulationsCount = await simulationRepository
      .createQueryBuilder('simulation')
      .leftJoin('simulation.personas', 'persona')
      .where('persona.id = :personaId', { personaId: persona.id })
      .getCount();

    if (simulationsCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete persona with associated simulations',
        code: 'PERSONA_HAS_SIMULATIONS',
        simulationsCount,
      });
    }

    await personaRepository.remove(persona);

    res.json({
      message: 'Persona deleted successfully',
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete persona' });
  }
});

/**
 * @swagger
 * /api/admin/simulations/{id}/personas:
 *   get:
 *     summary: Get personas attached to a simulation
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
 *         description: Simulation ID
 *     responses:
 *       200:
 *         description: Personas retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 personas:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Persona'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
// Get personas for a simulation
router.get('/simulations/:id/personas', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationRepository = AppDataSource.getRepository(Simulation);

    const simulation = await simulationRepository.findOne({
      where: { id: req.params.id },
      relations: ['personas'],
    });

    if (!simulation) {
      return res.status(404).json({
        error: 'Simulation not found',
        code: 'SIMULATION_NOT_FOUND',
      });
    }

    res.json({ personas: simulation.personas });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch simulation personas' });
  }
});

/**
 * @swagger
 * /api/admin/simulations/{id}/personas:
 *   put:
 *     summary: Update personas attached to a simulation
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
 *         description: Simulation ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - personaIds
 *             properties:
 *               personaIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: uuid
 *                 description: Array of persona IDs to attach to the simulation
 *                 example: ["123e4567-e89b-12d3-a456-426614174000", "456e7890-e89b-12d3-a456-426614174001"]
 *     responses:
 *       200:
 *         description: Simulation personas updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Simulation personas updated successfully"
 *                 personas:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Persona'
 *       400:
 *         description: Bad request - validation errors
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
// Update personas for a simulation
router.put('/simulations/:id/personas', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const personaRepository = AppDataSource.getRepository(Persona);
    const { personaIds } = req.body;

    if (!Array.isArray(personaIds)) {
      return res.status(400).json({
        error: 'personaIds must be an array',
        code: 'INVALID_PERSONA_IDS',
      });
    }

    const simulation = await simulationRepository.findOne({
      where: { id: req.params.id },
      relations: ['personas'],
    });

    if (!simulation) {
      return res.status(404).json({
        error: 'Simulation not found',
        code: 'SIMULATION_NOT_FOUND',
      });
    }

    // Get the personas to attach
    let personas: Persona[] = [];
    if (personaIds.length > 0) {
      personas = await personaRepository.find({
        where: {
          id: In(personaIds),
        },
      });

      // Check if all requested personas exist
      if (personas.length !== personaIds.length) {
        const foundIds = personas.map(p => p.id);
        const missingIds = personaIds.filter(id => !foundIds.includes(id));
        return res.status(400).json({
          error: 'Some personas were not found',
          code: 'PERSONAS_NOT_FOUND',
          missingIds,
        });
      }
    }

    // Update the simulation's personas
    simulation.personas = personas;
    await simulationRepository.save(simulation);

    res.json({
      message: 'Simulation personas updated successfully',
      personas: simulation.personas,
    });
  } catch (error) {
    console.error('Error updating simulation personas:', error);
    res.status(500).json({ error: 'Failed to update simulation personas' });
  }
});

/**
 * @swagger
 * /api/admin/simulations/{id}/personas/{personaId}:
 *   post:
 *     summary: Add a persona to a simulation
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
 *         description: Simulation ID
 *       - in: path
 *         name: personaId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Persona ID
 *     responses:
 *       200:
 *         description: Persona added to simulation successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Persona added to simulation successfully"
 *                 personas:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Persona'
 *       400:
 *         description: Bad request - persona already attached
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Simulation or persona not found
 *       500:
 *         description: Server error
 */
// Add persona to simulation
router.post('/simulations/:id/personas/:personaId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const personaRepository = AppDataSource.getRepository(Persona);

    const [simulation, persona] = await Promise.all([
      simulationRepository.findOne({
        where: { id: req.params.id },
        relations: ['personas'],
      }),
      personaRepository.findOne({
        where: { id: req.params.personaId },
      }),
    ]);

    if (!simulation) {
      return res.status(404).json({
        error: 'Simulation not found',
        code: 'SIMULATION_NOT_FOUND',
      });
    }

    if (!persona) {
      return res.status(404).json({
        error: 'Persona not found',
        code: 'PERSONA_NOT_FOUND',
      });
    }

    // Check if persona is already attached
    const isAlreadyAttached = simulation.personas.some(p => p.id === persona.id);
    if (isAlreadyAttached) {
      return res.status(400).json({
        error: 'Persona is already attached to this simulation',
        code: 'PERSONA_ALREADY_ATTACHED',
      });
    }

    // Add persona to simulation
    simulation.personas.push(persona);
    await simulationRepository.save(simulation);

    res.json({
      message: 'Persona added to simulation successfully',
      personas: simulation.personas,
    });
  } catch (error) {
    console.error('Error adding persona to simulation:', error);
    res.status(500).json({ error: 'Failed to add persona to simulation' });
  }
});

/**
 * @swagger
 * /api/admin/simulations/{id}/personas/{personaId}:
 *   delete:
 *     summary: Remove a persona from a simulation
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
 *         description: Simulation ID
 *       - in: path
 *         name: personaId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Persona ID
 *     responses:
 *       200:
 *         description: Persona removed from simulation successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Persona removed from simulation successfully"
 *                 personas:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Persona'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       404:
 *         description: Simulation or persona not found
 *       500:
 *         description: Server error
 */
// Remove persona from simulation
router.delete('/simulations/:id/personas/:personaId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationRepository = AppDataSource.getRepository(Simulation);

    const simulation = await simulationRepository.findOne({
      where: { id: req.params.id },
      relations: ['personas'],
    });

    if (!simulation) {
      return res.status(404).json({
        error: 'Simulation not found',
        code: 'SIMULATION_NOT_FOUND',
      });
    }

    // Remove persona from simulation
    simulation.personas = simulation.personas.filter(p => p.id !== req.params.personaId);
    await simulationRepository.save(simulation);

    res.json({
      message: 'Persona removed from simulation successfully',
      personas: simulation.personas,
    });
  } catch (error) {
    console.error('Error removing persona from simulation:', error);
    res.status(500).json({ error: 'Failed to remove persona from simulation' });
  }
});

/**
 * @swagger
 * /api/admin/system/config:
 *   get:
 *     summary: Get all system configurations
 *     tags: [Admin System]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System configurations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 configurations:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SystemConfiguration'
 *                 aiSettings:
 *                   type: object
 *                   description: Current AI model settings
 *                 systemPrompts:
 *                   type: object
 *                   description: Current system prompts
 *                 rateLimitSettings:
 *                   type: object
 *                   description: Current rate limiting settings
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
// Get system configurations
router.get('/system/config', requireAdmin as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configRepository = AppDataSource.getRepository(SystemConfiguration);
    
    const configurations = await configRepository.find({
      where: { isActive: true },
      order: { configKey: 'ASC' },
    });

    // Get specific configurations by key
    const aiConfig = configurations.find(c => c.configKey === SystemConfiguration.CONFIG_KEYS.AI_MODEL_SETTINGS);
    const promptsConfig = configurations.find(c => c.configKey === SystemConfiguration.CONFIG_KEYS.SYSTEM_PROMPTS);
    const rateLimitConfig = configurations.find(c => c.configKey === SystemConfiguration.CONFIG_KEYS.RATE_LIMIT_SETTINGS);

    // Merge with defaults to ensure all fields are present (for backward compatibility)
    const defaultAISettings = SystemConfiguration.getDefaultAISettings();
    const aiSettings = aiConfig?.aiModelSettings 
      ? { ...defaultAISettings, ...aiConfig.aiModelSettings }
      : defaultAISettings;

    // Get actual effective rate limiting status (disabled in development regardless of setting)
    const configuredRateLimit = rateLimitConfig?.rateLimitSettings || SystemConfiguration.getDefaultRateLimitSettings();
    const effectiveRateLimit = {
      ...configuredRateLimit,
      enabled: configuredRateLimit.enabled && !config.isDevelopment, // Force disabled in development
      configuredEnabled: configuredRateLimit.enabled, // Store the original setting
      isDevelopmentOverride: config.isDevelopment, // Let frontend know if dev mode is overriding
    };

    res.json({
      configurations,
      aiSettings,
      systemPrompts: promptsConfig?.systemPrompts || SystemConfiguration.getDefaultSystemPrompts(),
      rateLimitSettings: effectiveRateLimit,
    });
  } catch (error) {
    console.error('Error fetching system configurations:', error);
    res.status(500).json({ error: 'Failed to fetch system configurations' });
  }
});

/**
 * @swagger
 * /api/admin/system/config/ai:
 *   put:
 *     summary: Update AI model settings
 *     tags: [Admin System]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *               - maxTokens
 *               - temperature
 *               - frequencyPenalty
 *               - presencePenalty
 *               - topP
 *             properties:
 *               model:
 *                 type: string
 *                 example: "gpt-4-turbo-preview"
 *               maxTokens:
 *                 type: integer
 *                 minimum: 100
 *                 maximum: 4000
 *                 example: 2000
 *               temperature:
 *                 type: number
 *                 format: float
 *                 minimum: 0
 *                 maximum: 2
 *                 example: 0.8
 *               frequencyPenalty:
 *                 type: number
 *                 format: float
 *                 minimum: -2
 *                 maximum: 2
 *                 example: 0.3
 *               presencePenalty:
 *                 type: number
 *                 format: float
 *                 minimum: -2
 *                 maximum: 2
 *                 example: 0.3
 *               topP:
 *                 type: number
 *                 format: float
 *                 minimum: 0
 *                 maximum: 1
 *                 example: 1.0
 *     responses:
 *       200:
 *         description: AI settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "AI settings updated successfully"
 *                 configuration:
 *                   $ref: '#/components/schemas/SystemConfiguration'
 *       400:
 *         description: Bad request - validation errors
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
// Update AI model settings
router.put('/system/config/ai', requireAdmin as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configRepository = AppDataSource.getRepository(SystemConfiguration);
    const { model, maxTokens, temperature, frequencyPenalty, presencePenalty, topP } = req.body;

    // Validation
    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'Valid model name is required' });
    }
    if (!maxTokens || maxTokens < 100 || maxTokens > 4000) {
      return res.status(400).json({ error: 'Max tokens must be between 100 and 4000' });
    }
    if (temperature < 0 || temperature > 2) {
      return res.status(400).json({ error: 'Temperature must be between 0 and 2' });
    }
    if (frequencyPenalty < -2 || frequencyPenalty > 2) {
      return res.status(400).json({ error: 'Frequency penalty must be between -2 and 2' });
    }
    if (presencePenalty < -2 || presencePenalty > 2) {
      return res.status(400).json({ error: 'Presence penalty must be between -2 and 2' });
    }
    if (topP < 0 || topP > 1) {
      return res.status(400).json({ error: 'Top P must be between 0 and 1' });
    }

    let config = await configRepository.findOne({
      where: { configKey: SystemConfiguration.CONFIG_KEYS.AI_MODEL_SETTINGS },
    });

    const preservedProfiles = config?.aiModelSettings?.profiles;
    const newSettings: AIModelSettings = {
      model,
      maxTokens,
      temperature,
      frequencyPenalty,
      presencePenalty,
      topP,
      profiles: preservedProfiles,
    };

    if (config) {
      config.aiModelSettings = newSettings;
      config.updatedAt = new Date();
    } else {
      config = configRepository.create({
        configKey: SystemConfiguration.CONFIG_KEYS.AI_MODEL_SETTINGS,
        aiModelSettings: newSettings,
        description: 'AI model configuration settings',
        isActive: true,
      });
    }

    await configRepository.save(config);

    // Clear AI service cache so new settings take effect immediately
    AIService.clearGlobalConfigCache();

    res.json({
      message: 'AI settings updated successfully',
      configuration: config,
    });
  } catch (error) {
    console.error('Error updating AI settings:', error);
    res.status(500).json({ error: 'Failed to update AI settings' });
  }
});

/**
 * @swagger
 * /api/admin/system/config/ai/profiles:
 *   put:
 *     summary: Update AI profile overrides (generation, goalEvaluation, performanceAnalysis)
 *     tags: [Admin System]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               profiles:
 *                 type: object
 *                 properties:
 *                   generation:
 *                     type: object
 *                     description: Overrides for persona response generation
 *                   goalEvaluation:
 *                     type: object
 *                     description: Overrides for goal evaluation via LLM
 *                   performanceAnalysis:
 *                     type: object
 *                     description: Overrides for performance analysis
 *                   evaluations:
 *                     type: object
 *                     description: Generic overrides used by the evaluations service
 *     responses:
 *       200:
 *         description: AI profile overrides updated successfully
 *       400:
 *         description: Bad request - validation errors
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
router.put('/system/config/ai/profiles', requireAdmin as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configRepository = AppDataSource.getRepository(SystemConfiguration);
    const { profiles } = req.body as { profiles?: AIModelSettings['profiles'] };

    if (!profiles || typeof profiles !== 'object') {
      return res.status(400).json({ error: 'profiles object is required' });
    }

    let configRow = await configRepository.findOne({
      where: { configKey: SystemConfiguration.CONFIG_KEYS.AI_MODEL_SETTINGS },
    });

    if (!configRow) {
      configRow = configRepository.create({
        configKey: SystemConfiguration.CONFIG_KEYS.AI_MODEL_SETTINGS,
        aiModelSettings: SystemConfiguration.getDefaultAISettings(),
        description: 'AI model configuration settings',
        isActive: true,
      });
    }

    const current = configRow.aiModelSettings || SystemConfiguration.getDefaultAISettings();

    // Normalize incoming profiles to supported keys only
    const incoming: any = profiles as any;
    const generationUpdates = incoming.generation || {};
    // Merge any alias keys into the single supported 'evaluation' profile
    const evaluationUpdates = {
      ...(incoming.evaluation || {}),
      ...(incoming.goalEvaluation || {}),
      ...(incoming.performanceAnalysis || {}),
      ...(incoming.evaluations || {}),
    };

    configRow.aiModelSettings = {
      ...current,
      profiles: {
        generation: { ...(current.profiles?.generation || {}), ...generationUpdates },
        evaluation: { ...(current.profiles?.evaluation || {}), ...evaluationUpdates },
      },
    };

    await configRepository.save(configRow);

    // Clear AI service cache so new settings take effect immediately
    AIService.clearGlobalConfigCache();

    res.json({
      message: 'AI profile overrides updated successfully',
      configuration: configRow,
    });
  } catch (error) {
    console.error('Error updating AI profile overrides:', error);
    res.status(500).json({ error: 'Failed to update AI profile overrides' });
  }
});

/**
 * @swagger
 * /api/admin/system/config/prompts:
 *   put:
 *     summary: Update system prompts
 *     tags: [Admin System]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - baseSystemPrompt
 *               - performanceAnalysisPrompt
 *             properties:
 *               baseSystemPrompt:
 *                 type: string
 *                 description: Core prompt template for persona interactions
 *                 example: "You are {persona.name}, {persona.role}..."
 *               performanceAnalysisPrompt:
 *                 type: string
 *                 description: Prompt for generating user performance feedback
 *                 example: "Analyze this user's performance..."
 *     responses:
 *       200:
 *         description: System prompts updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "System prompts updated successfully"
 *                 configuration:
 *                   $ref: '#/components/schemas/SystemConfiguration'
 *       400:
 *         description: Bad request - validation errors
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       403:
 *         description: Forbidden - admin access required
 *       500:
 *         description: Server error
 */
// Update system prompts
router.put('/system/config/prompts', requireAdmin as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const configRepository = AppDataSource.getRepository(SystemConfiguration);
    const { baseSystemPrompt, performanceAnalysisPrompt, styleGuidelines } = req.body;

    // Validation
    if (!baseSystemPrompt || typeof baseSystemPrompt !== 'string' || baseSystemPrompt.trim().length === 0) {
      return res.status(400).json({ error: 'Base system prompt is required' });
    }
    if (!performanceAnalysisPrompt || typeof performanceAnalysisPrompt !== 'string' || performanceAnalysisPrompt.trim().length === 0) {
      return res.status(400).json({ error: 'Performance analysis prompt is required' });
    }

    let config = await configRepository.findOne({
      where: { configKey: SystemConfiguration.CONFIG_KEYS.SYSTEM_PROMPTS },
    });

    const newPrompts: SystemPrompts = {
      baseSystemPrompt: baseSystemPrompt.trim(),
      performanceAnalysisPrompt: performanceAnalysisPrompt.trim(),
      styleGuidelines: typeof styleGuidelines === 'string' && styleGuidelines.trim().length > 0
        ? styleGuidelines.trim()
        : SystemConfiguration.getDefaultSystemPrompts().styleGuidelines,
    };

    if (config) {
      config.systemPrompts = newPrompts;
      config.updatedAt = new Date();
    } else {
      config = configRepository.create({
        configKey: SystemConfiguration.CONFIG_KEYS.SYSTEM_PROMPTS,
        systemPrompts: newPrompts,
        description: 'System prompt templates for AI interactions',
        isActive: true,
      });
    }

    await configRepository.save(config);

    // Clear AI service cache so new prompts take effect immediately
    AIService.clearGlobalConfigCache();

    res.json({
      message: 'System prompts updated successfully',
      configuration: config,
    });
  } catch (error) {
    console.error('Error updating system prompts:', error);
    res.status(500).json({ error: 'Failed to update system prompts' });
  }
});



export default router; 