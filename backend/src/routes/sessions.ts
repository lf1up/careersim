import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { Simulation } from '@/entities/Simulation';

const router: any = Router();

// All session routes require authentication
router.use(authenticateToken as any);

/**
 * @swagger
 * /api/sessions:
 *   get:
 *     summary: Get user's simulation sessions
 *     tags: [Sessions]
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
 *           enum: [ACTIVE, COMPLETED, PAUSED]
 *         description: Filter sessions by status
 *     responses:
 *       200:
 *         description: Sessions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/SimulationSession'
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
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/sessions:
 *   post:
 *     summary: Start a new simulation session
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - simulationId
 *             properties:
 *               simulationId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the simulation to start
 *               userGoals:
 *                 type: string
 *                 description: User's goals for this session
 *                 example: "Improve my communication skills and practice handling difficult conversations"
 *     responses:
 *       201:
 *         description: Session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 session:
 *                   $ref: '#/components/schemas/SimulationSession'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/sessions/{id}:
 *   get:
 *     summary: Get specific session details
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 session:
 *                   $ref: '#/components/schemas/SimulationSession'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       404:
 *         description: Session not found
 *       500:
 *         description: Server error
 */
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

/**
 * @swagger
 * /api/sessions/{id}/complete:
 *   patch:
 *     summary: Mark a session as completed
 *     tags: [Sessions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Session completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 session:
 *                   $ref: '#/components/schemas/SimulationSession'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       404:
 *         description: Session not found
 *       500:
 *         description: Server error
 */
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