import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { Simulation } from '@/entities/Simulation';

const router: any = Router();

// All session routes require authentication
router.use(authenticateToken as any);

// Get user's sessions
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    
    const queryBuilder = AppDataSource.getRepository(SimulationSession)
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.simulation', 'simulation')
      .where('session.user.id = :userId', { userId: req.user!.id });

    if (status) {
      queryBuilder.andWhere('session.status = :status', { status });
    }

    const [sessions, total] = await queryBuilder
      .orderBy('session.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    res.json({
      sessions,
      pagination: {
        current: Number(page),
        total: Math.ceil(total / Number(limit)),
        count: total,
        limit: Number(limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Start a new session
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { simulationId, userGoals } = req.body;
    
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    
    const simulation = await simulationRepository.findOne({
      where: { id: simulationId },
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    const session = new SimulationSession();
    session.user = req.user!;
    session.simulation = simulation;
    session.userGoals = userGoals;
    session.markAsStarted();

    await sessionRepository.save(session);

    res.status(201).json({ session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create session' });
  }
});

// Get specific session
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const session = await sessionRepository.findOne({
      where: { 
        id: req.params.id,
        user: { id: req.user!.id }
      },
      relations: ['simulation', 'messages', 'analytics'],
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({ session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Complete a session
router.patch('/:id/complete', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const session = await sessionRepository.findOne({
      where: { 
        id: req.params.id,
        user: { id: req.user!.id }
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    session.markAsCompleted();
    await sessionRepository.save(session);

    res.json({ session });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete session' });
  }
});

export default router; 