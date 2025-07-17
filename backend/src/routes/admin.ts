import { Router } from 'express';
import { AppDataSource } from '@/config/database';
import { User, UserRole } from '@/entities/User';
import { Simulation } from '@/entities/Simulation';
import { Persona } from '@/entities/Persona';
import { Category } from '@/entities/Category';
import { SimulationSession } from '@/entities/SimulationSession';
import { Subscription } from '@/entities/Subscription';
import { authenticateToken, requireAdmin, AuthenticatedRequest } from '@/middleware/auth';

const router = Router();

// Apply authentication and admin role requirement to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// Dashboard stats
router.get('/dashboard', async (req: AuthenticatedRequest, res) => {
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
    simulationRepository.count({ where: { status: 'published' } }),
    sessionRepository.count(),
    sessionRepository.count({ where: { status: 'completed' } }),
    subscriptionRepository.count(),
    subscriptionRepository.count({ where: { status: 'active' } }),
  ]);

  // User growth over time (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentUsers = await userRepository
    .createQueryBuilder('user')
    .select('DATE(user.createdAt)', 'date')
    .addSelect('COUNT(*)', 'count')
    .where('user.createdAt >= :thirtyDaysAgo', { thirtyDaysAgo })
    .groupBy('DATE(user.createdAt)')
    .orderBy('date', 'ASC')
    .getRawMany();

  // Subscription tier breakdown
  const subscriptionTiers = await userRepository
    .createQueryBuilder('user')
    .select('user.subscriptionTier', 'tier')
    .addSelect('COUNT(*)', 'count')
    .groupBy('user.subscriptionTier')
    .getRawMany();

  res.json({
    stats: {
      users: {
        total: totalUsers,
        active: activeUsers,
        inactive: totalUsers - activeUsers,
      },
      simulations: {
        total: totalSimulations,
        published: publishedSimulations,
        draft: totalSimulations - publishedSimulations,
      },
      sessions: {
        total: totalSessions,
        completed: completedSessions,
        completionRate: totalSessions > 0 ? (completedSessions / totalSessions * 100) : 0,
      },
      subscriptions: {
        total: totalSubscriptions,
        active: activeSubscriptions,
        inactive: totalSubscriptions - activeSubscriptions,
      },
    },
    charts: {
      userGrowth: recentUsers,
      subscriptionTiers,
    },
  });
});

// User management
router.get('/users', async (req: AuthenticatedRequest, res) => {
  const { page = 1, limit = 20, search, tier, status } = req.query;
  
  const userRepository = AppDataSource.getRepository(User);
  const queryBuilder = userRepository.createQueryBuilder('user')
    .leftJoinAndSelect('user.subscription', 'subscription')
    .select([
      'user.id',
      'user.firstName',
      'user.lastName',
      'user.email',
      'user.role',
      'user.subscriptionTier',
      'user.isActive',
      'user.totalSimulationsCompleted',
      'user.monthlySimulationsUsed',
      'user.createdAt',
      'user.lastLoginAt',
      'subscription.status',
    ]);

  if (search) {
    queryBuilder.where(
      'user.firstName ILIKE :search OR user.lastName ILIKE :search OR user.email ILIKE :search',
      { search: `%${search}%` }
    );
  }

  if (tier) {
    queryBuilder.andWhere('user.subscriptionTier = :tier', { tier });
  }

  if (status === 'active') {
    queryBuilder.andWhere('user.isActive = true');
  } else if (status === 'inactive') {
    queryBuilder.andWhere('user.isActive = false');
  }

  const [users, total] = await queryBuilder
    .skip((Number(page) - 1) * Number(limit))
    .take(Number(limit))
    .orderBy('user.createdAt', 'DESC')
    .getManyAndCount();

  res.json({
    users,
    pagination: {
      current: Number(page),
      total: Math.ceil(total / Number(limit)),
      count: total,
    },
  });
});

// Get specific user details
router.get('/users/:id', async (req: AuthenticatedRequest, res) => {
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

  const { password: _, ...userData } = user;

  res.json({
    user: userData,
    recentSessions,
  });
});

// Update user
router.patch('/users/:id', async (req: AuthenticatedRequest, res) => {
  const userRepository = AppDataSource.getRepository(User);
  const { role, subscriptionTier, isActive } = req.body;

  const user = await userRepository.findOne({ where: { id: req.params.id } });
  if (!user) {
    return res.status(404).json({
      error: 'User not found',
      code: 'USER_NOT_FOUND',
    });
  }

  if (role && Object.values(UserRole).includes(role)) {
    user.role = role;
  }

  if (subscriptionTier) {
    user.subscriptionTier = subscriptionTier;
  }

  if (typeof isActive === 'boolean') {
    user.isActive = isActive;
  }

  await userRepository.save(user);

  const { password: _, ...userData } = user;
  res.json({ user: userData });
});

// Simulation management
router.get('/simulations', async (req: AuthenticatedRequest, res) => {
  const { page = 1, limit = 20, status, category } = req.query;
  
  const simulationRepository = AppDataSource.getRepository(Simulation);
  const queryBuilder = simulationRepository.createQueryBuilder('simulation')
    .leftJoinAndSelect('simulation.category', 'category')
    .leftJoinAndSelect('simulation.persona', 'persona')
    .leftJoinAndSelect('simulation.sessions', 'sessions');

  if (status) {
    queryBuilder.where('simulation.status = :status', { status });
  }

  if (category) {
    queryBuilder.andWhere('category.id = :category', { category });
  }

  const [simulations, total] = await queryBuilder
    .skip((Number(page) - 1) * Number(limit))
    .take(Number(limit))
    .orderBy('simulation.createdAt', 'DESC')
    .getManyAndCount();

  res.json({
    simulations,
    pagination: {
      current: Number(page),
      total: Math.ceil(total / Number(limit)),
      count: total,
    },
  });
});

// Analytics overview
router.get('/analytics', async (req: AuthenticatedRequest, res) => {
  const sessionRepository = AppDataSource.getRepository(SimulationSession);
  const userRepository = AppDataSource.getRepository(User);

  // Popular simulations
  const popularSimulations = await sessionRepository
    .createQueryBuilder('session')
    .leftJoin('session.simulation', 'simulation')
    .select('simulation.title', 'title')
    .addSelect('simulation.id', 'id')
    .addSelect('COUNT(*)', 'sessionCount')
    .groupBy('simulation.id, simulation.title')
    .orderBy('sessionCount', 'DESC')
    .limit(10)
    .getRawMany();

  // Average completion rates by simulation
  const completionRates = await sessionRepository
    .createQueryBuilder('session')
    .leftJoin('session.simulation', 'simulation')
    .select('simulation.title', 'title')
    .addSelect('COUNT(*)', 'totalSessions')
    .addSelect('SUM(CASE WHEN session.status = \'completed\' THEN 1 ELSE 0 END)', 'completedSessions')
    .groupBy('simulation.id, simulation.title')
    .getRawMany();

  // User engagement metrics
  const engagementMetrics = await userRepository
    .createQueryBuilder('user')
    .select('AVG(user.totalSimulationsCompleted)', 'avgSimulationsPerUser')
    .addSelect('user.subscriptionTier', 'tier')
    .groupBy('user.subscriptionTier')
    .getRawMany();

  res.json({
    popularSimulations,
    completionRates: completionRates.map(rate => ({
      ...rate,
      completionRate: rate.totalSessions > 0 ? 
        (rate.completedSessions / rate.totalSessions * 100) : 0,
    })),
    engagementMetrics,
  });
});

// Export data
router.get('/export/users', async (req: AuthenticatedRequest, res) => {
  const userRepository = AppDataSource.getRepository(User);
  const users = await userRepository.find({
    select: [
      'id', 'firstName', 'lastName', 'email', 'role', 
      'subscriptionTier', 'isActive', 'totalSimulationsCompleted',
      'createdAt', 'lastLoginAt'
    ],
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=users.json');
  res.json(users);
});

router.get('/export/sessions', async (req: AuthenticatedRequest, res) => {
  const sessionRepository = AppDataSource.getRepository(SimulationSession);
  const sessions = await sessionRepository.find({
    relations: ['user', 'simulation'],
    select: {
      user: ['id', 'email'],
      simulation: ['id', 'title'],
    },
  });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=sessions.json');
  res.json(sessions);
});

export default router; 