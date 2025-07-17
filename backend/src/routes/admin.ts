import { Router, Request, Response, NextFunction } from 'express';
import { AppDataSource } from '@/config/database';
import { User, UserRole } from '@/entities/User';
import { Simulation, SimulationStatus } from '@/entities/Simulation';
import { Persona } from '@/entities/Persona';
import { Category } from '@/entities/Category';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { Subscription, SubscriptionStatus } from '@/entities/Subscription';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '@/middleware/auth';

const router: any = Router();

// Apply authentication and admin role requirement to all routes
router.use(authenticateToken as any);
router.use(requireAdmin as any);

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

// Analytics overview
router.get('/analytics', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const userRepository = AppDataSource.getRepository(User);

    // User engagement metrics
    const userStats = await userRepository
      .createQueryBuilder('user')
      .select([
        'COUNT(*) as totalUsers',
        'SUM(CASE WHEN user.isActive = 1 THEN 1 ELSE 0 END) as activeUsers',
        'AVG(user.monthlySimulationsUsed) as avgSimulationsPerUser',
      ])
      .getRawOne();

    // Session performance metrics
    const sessionStats = await sessionRepository
      .createQueryBuilder('session')
      .select([
        'COUNT(*) as totalSessions',
        'AVG(session.durationSeconds) as avgDuration',
        'AVG(session.overallScore) as avgScore',
        'SUM(CASE WHEN session.status = :completed THEN 1 ELSE 0 END) as completedSessions',
      ])
      .setParameter('completed', SessionStatus.COMPLETED)
      .getRawOne();

    // Popular simulations
    const popularSimulations = await sessionRepository
      .createQueryBuilder('session')
      .leftJoin('session.simulation', 'simulation')
      .select([
        'simulation.title',
        'simulation.id',
        'COUNT(session.id) as sessionCount',
        'AVG(session.overallScore) as avgScore',
      ])
      .groupBy('simulation.id')
      .orderBy('sessionCount', 'DESC')
      .limit(10)
      .getRawMany();

    res.json({
      userStats,
      sessionStats,
      popularSimulations,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

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