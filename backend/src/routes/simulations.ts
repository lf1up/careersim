import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { Simulation, SimulationStatus } from '@/entities/Simulation';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { SessionMessage, MessageType, MessageInputMethod } from '@/entities/SessionMessage';
import { evaluationsService, computeAndPersistSessionScores } from '@/services/evaluations';
import { emitGoalProgressUpdate } from '@/services/realtime';
import { config } from '@/config/env';
import { randomFloat, randomDelayMs, randomInt } from '@/utils/secureRandom';
import { compositeSimilarity } from '@/utils/textSimilarity';

const router: Router = Router();

/**
 * @swagger
 * /api/simulations:
 *   get:
 *     summary: Get all published simulations
 *     tags: [Simulations]
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
 *         description: Filter by category ID
 *       - in: query
 *         name: difficulty
 *         schema:
 *           type: string
 *           enum: [BEGINNER, INTERMEDIATE, ADVANCED]
 *         description: Filter by difficulty level
 *     responses:
 *       200:
 *         description: List of simulations retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 simulations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       title:
 *                         type: string
 *                       description:
 *                         type: string
 *                       difficulty:
 *                         type: string
 *                         enum: [BEGINNER, INTERMEDIATE, ADVANCED]
 *                       estimatedDuration:
 *                         type: integer
 *                       category:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                       persona:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           name:
 *                             type: string
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     total:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *       500:
 *         description: Server error
 */
// Get all published simulations (requires authentication)
router.get('/', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { page = 1, limit = 20, category, difficulty } = req.query;
    
    const queryBuilder = AppDataSource.getRepository(Simulation)
      .createQueryBuilder('simulation')
      .leftJoinAndSelect('simulation.category', 'category')
      .leftJoinAndSelect('simulation.personas', 'personas')
      .where('simulation.status = :status', { status: SimulationStatus.PUBLISHED });

    if (category) {
      // Support both ID (UUID) and slug for category filtering
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(category as string);
      if (isUUID) {
        queryBuilder.andWhere('category.id = :category', { category });
      } else {
        queryBuilder.andWhere('category.slug = :categorySlug', { categorySlug: category });
      }
    }

    if (difficulty) {
      queryBuilder.andWhere('simulation.difficulty = :difficulty', { difficulty });
    }

    const [simulations, total] = await queryBuilder
      .orderBy('simulation.sortOrder', 'ASC')
      .addOrderBy('simulation.createdAt', 'DESC')
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

// Get simulation by ID or slug
router.get('/:idOrSlug', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { idOrSlug } = req.params;
    const simulationRepository = AppDataSource.getRepository(Simulation);
    
    // Check if the parameter is a valid UUID format
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idOrSlug);
    
    let simulation;
    if (isUUID) {
      // If it's a UUID, search by ID
      simulation = await simulationRepository
        .createQueryBuilder('simulation')
        .leftJoinAndSelect('simulation.category', 'category')
        .leftJoinAndSelect('simulation.personas', 'personas')
        .where('simulation.id = :id', { id: idOrSlug })
        .andWhere('simulation.status = :status', { status: SimulationStatus.PUBLISHED })
        .getOne();
    } else {
      // If it's not a UUID, search by slug
      simulation = await simulationRepository
        .createQueryBuilder('simulation')
        .leftJoinAndSelect('simulation.category', 'category')
        .leftJoinAndSelect('simulation.personas', 'personas')
        .where('simulation.slug = :slug', { slug: idOrSlug })
        .andWhere('simulation.status = :status', { status: SimulationStatus.PUBLISHED })
        .getOne();
    }

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    res.json({ simulation });
  } catch (error) {
    console.error('Error fetching simulation:', error);
    res.status(500).json({ error: 'Failed to fetch simulation' });
  }
});

/**
 * @swagger
 * /api/simulations/{id}/sessions:
 *   get:
 *     summary: Get sessions for a specific simulation
 *     tags: [Simulations]
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
 *     responses:
 *       200:
 *         description: Sessions retrieved successfully
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
// Get sessions for a specific simulation
router.get('/:id/sessions', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    // First verify the simulation exists
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const simulation = await simulationRepository.findOne({
      where: { id, status: SimulationStatus.PUBLISHED },
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    // Get user's sessions for this simulation
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const [sessions, total] = await sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.simulation', 'simulation')
      .addSelect('session.goalProgress')  // Explicitly select JSON columns
      .addSelect('simulation.conversationGoals')
      .where('session.simulation.id = :simulationId', { simulationId: id })
      .andWhere('session.user.id = :userId', { userId: req.user!.id })
      .orderBy('session.createdAt', 'DESC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    // Transform sessions to include currentStep and totalSteps for frontend
    const transformedSessions = sessions.map(session => {
      // Calculate dynamic duration for active sessions
      let totalDuration = session.durationSeconds || 0;
      if ((session.status === SessionStatus.IN_PROGRESS || session.status === SessionStatus.STARTED) && session.startedAt) {
        totalDuration = Math.floor((new Date().getTime() - session.startedAt.getTime()) / 1000);
      }

      return {
        ...session,
        totalSteps: session.simulation?.conversationGoals?.length || 0,
        currentStep: Array.isArray(session.goalProgress)
          ? session.goalProgress.filter((g: any) => g.status === 'achieved').length
          : 0,
        totalDuration,
      };
    });

    res.json({
      sessions: transformedSessions,
      pagination: {
        current: Number(page),
        total: Math.ceil(total / Number(limit)),
        count: total,
        limit: Number(limit),
      },
    });
  } catch (error) {
    console.error('Error fetching simulation sessions:', error);
    res.status(500).json({ error: 'Failed to fetch simulation sessions' });
  }
});

/**
 * @swagger
 * /api/simulations/{id}/start-session:
 *   post:
 *     summary: Start a new session for a specific simulation
 *     tags: [Simulations]
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
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               userGoals:
 *                 type: string
 *                 description: User's goals for this session
 *                 example: "Improve my communication skills and practice handling difficult conversations"
 *     responses:
 *       201:
 *         description: Session created successfully
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
// Start a session for a specific simulation
router.post('/:id/start-session', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { userGoals } = req.body;

    const simulationRepository = AppDataSource.getRepository(Simulation);
    const sessionRepository = AppDataSource.getRepository(SimulationSession);

    // Verify simulation exists and is published
    const simulation = await simulationRepository.findOne({
      where: { id, status: SimulationStatus.PUBLISHED },
      relations: ['category', 'personas'],
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    // Create new session
    const session = new SimulationSession();
    session.user = req.user!;
    session.simulation = simulation;
    session.userGoals = userGoals;
    session.markAsStarted();
    // Initialize goal progress from simulation goals
    if (simulation.conversationGoals && simulation.conversationGoals.length > 0) {
      session.goalProgress = simulation.conversationGoals
        .sort((a, b) => a.goalNumber - b.goalNumber)
        .map((g) => ({
          goalNumber: g.goalNumber,
          isOptional: !!g.isOptional,
          title: g.title,
          status: 'not_started',
          confidence: 0,
          evidence: [],
        }));
    }

    await sessionRepository.save(session);

    // Optionally, allow persona to initiate the conversation based on settings
    try {
      const persona = simulation.personas?.[0];
      const cs: any = persona?.conversationStyle || {};
      // For 'sometimes', use burstiness as proxy: more chatty personas (higher max) are more likely to start
      const burstMax = cs?.burstiness?.max || 1;
      const sometimesProbability = Math.min(0.5, burstMax * 0.15); // max=3 -> 45% chance
      const startsConversation = cs?.startsConversation === true || (cs?.startsConversation === 'sometimes' && randomFloat() < sometimesProbability);
      if (persona && startsConversation) {
        // Check if LangGraph is enabled
        if (config.langgraph.useLangGraph) {
          console.log('🔵 Using LangGraph for session start');
          
          // Use LangGraph for start message
          const { invokeConversationGraph } = await import('@/services/langgraph');
          
          await invokeConversationGraph({
            sessionId: session.id,
            userId: req.user!.id,
            proactiveTrigger: 'start',
            userMessage: undefined, // Explicitly clear to prevent checkpoint carryover
          });
          
          // Graph handles all persistence and emission
          // Just update session flags
          session.aiInitiated = true;
          await sessionRepository.save(session);
        } else {
          // OLD PATH: Use AIService
          const { AIService } = await import('@/services/ai');
          const aiService = new AIService();
          const context = {
            persona,
            simulation,
            conversationHistory: [] as SessionMessage[],
            sessionDuration: 0,
          };

          const aiResponse = await aiService.generateProactivePersonaMessage(context, { reason: 'start' });

          // Persist AI opening message
          const messageRepository = AppDataSource.getRepository(SessionMessage);
          const aiMessage = new SessionMessage();
          aiMessage.session = session;
          aiMessage.sequenceNumber = 1;
          aiMessage.type = MessageType.AI;
          aiMessage.content = aiResponse.message;
          aiMessage.timestamp = new Date();
          aiMessage.metadata = {
            confidence: aiResponse.confidence,
            processingTime: aiResponse.processingTime,
            emotionalTone: aiResponse.emotionalTone,
            sentiment: aiResponse.metadata.sentiment,
          };
          await messageRepository.save(aiMessage);
          session.addMessage();
          session.turn = 'user';
          session.aiInitiated = true;
          session.lastAiMessageAt = new Date();

          // Set initial inactivity nudge time based on persona config (unified {min,max} with fallbacks)
          {
            const csStart: any = persona.conversationStyle || {};
            const delayCfg = csStart?.inactivityNudgeDelaySec || {};
            const minSec = Math.max(5, Number(delayCfg?.min ?? 60));
            const maxSec = Math.max(minSec, Number(delayCfg?.max ?? 180));
            const delay = randomDelayMs(minSec * 1000, maxSec * 1000);
            session.inactivityNudgeAt = new Date(Date.now() + delay);
            session.inactivityNudgeCount = 0;
          }
          await sessionRepository.save(session);

          // Emit via Socket.IO
          try {
            const { io } = await import('@/server');
            io.to(`session-${session.id}`).emit('message-received', {
              sessionId: session.id,
              message: {
                id: aiMessage.id,
                sessionId: session.id,
                sequenceNumber: aiMessage.sequenceNumber,
                type: aiMessage.type,
                content: aiMessage.content,
                inputMethod: aiMessage.inputMethod,
                metadata: aiMessage.metadata,
                timestamp: aiMessage.timestamp,
                isHighlighted: aiMessage.isHighlighted,
                highlightReason: aiMessage.highlightReason,
                analysisData: aiMessage.analysisData,
                createdAt: aiMessage.createdAt,
                isFromUser: false,
              },
              timestamp: new Date(),
            });
          } catch (emitErr) {
            console.warn('⚠️ Failed to emit opening AI message:', emitErr);
          }
        }
      } else {
        // If AI does not initiate, set turn to user and schedule nudge
        if (persona) {
          session.turn = 'user';
          const csStart: any = persona.conversationStyle || {};
          const delayCfg = csStart?.inactivityNudgeDelaySec || {};
          const minSec = Math.max(5, Number(delayCfg?.min ?? 60));
          const maxSec = Math.max(minSec, Number(delayCfg?.max ?? 180));
          const delay = randomDelayMs(minSec * 1000, maxSec * 1000);
          session.inactivityNudgeAt = new Date(Date.now() + delay);
          session.inactivityNudgeCount = 0;
          await sessionRepository.save(session);
        }
      }
    } catch (e) {
      console.warn('⚠️ Failed to process AI initiation:', e);
    }

    // Return the session with simulation details
    const sessionWithDetails = await sessionRepository.findOne({
      where: { id: session.id },
      relations: ['simulation', 'simulation.category', 'simulation.personas'],
    });

    // Fetch initial messages (so AI openings appear immediately on client)
    const messageRepository = AppDataSource.getRepository(SessionMessage);
    const initialMessages = await messageRepository
      .createQueryBuilder('message')
      .where('message.sessionId = :sessionId', { sessionId: session.id })
      .orderBy('message.sequenceNumber', 'ASC')
      .getMany();

    // Add currentStep and totalSteps for frontend
    let totalDuration = sessionWithDetails?.durationSeconds || 0;
    if ((sessionWithDetails?.status === SessionStatus.IN_PROGRESS || sessionWithDetails?.status === SessionStatus.STARTED) && sessionWithDetails?.startedAt) {
      totalDuration = Math.floor((new Date().getTime() - sessionWithDetails.startedAt.getTime()) / 1000);
    }

    const transformedSession = {
      ...sessionWithDetails,
      totalSteps: sessionWithDetails?.simulation?.conversationGoals?.length || 0,
      currentStep: Array.isArray(sessionWithDetails?.goalProgress)
        ? sessionWithDetails.goalProgress.filter((g: any) => g.status === 'achieved').length
        : 0,
      totalDuration,
      messages: initialMessages.map((m) => ({
        id: m.id,
        sessionId: m.sessionId,
        sequenceNumber: m.sequenceNumber,
        type: m.type,
        content: m.content,
        inputMethod: m.inputMethod,
        metadata: m.metadata,
        timestamp: m.timestamp,
        isHighlighted: m.isHighlighted,
        highlightReason: m.highlightReason,
        analysisData: m.analysisData,
        createdAt: m.createdAt,
        isFromUser: m.type === MessageType.USER,
      })),
    };

    res.status(201).json({ session: transformedSession });
  } catch (error) {
    console.error('Error starting simulation session:', error);
    res.status(500).json({ error: 'Failed to start simulation session' });
  }
});

/**
 * @swagger
 * /api/simulations/{id}/stats:
 *   get:
 *     summary: Get statistics for a specific simulation
 *     tags: [Simulations]
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
 *         description: Statistics retrieved successfully
 *       404:
 *         description: Simulation not found
 *       500:
 *         description: Server error
 */
// Get simulation statistics for the current user
router.get('/:id/stats', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Verify simulation exists
    const simulationRepository = AppDataSource.getRepository(Simulation);
    const simulation = await simulationRepository.findOne({
      where: { id, status: SimulationStatus.PUBLISHED },
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    // Get user's session statistics for this simulation
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const sessions = await sessionRepository.find({
      where: {
        simulation: { id },
        user: { id: req.user!.id },
      },
      order: { createdAt: 'DESC' },
    });

    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === SessionStatus.COMPLETED);
    const averageScore = completedSessions.length > 0 
      ? completedSessions.reduce((sum, s) => sum + (s.overallScore || 0), 0) / completedSessions.length 
      : 0;
    const totalTimeSpent = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
    const lastSession = sessions[0];
    const bestScore = Math.max(...completedSessions.map(s => s.overallScore || 0), 0);

    const stats = {
      totalSessions,
      completedSessions: completedSessions.length,
      completionRate: totalSessions > 0 ? (completedSessions.length / totalSessions) * 100 : 0,
      averageScore: Math.round(averageScore * 100) / 100,
      bestScore,
      totalTimeSpent,
      lastSessionDate: lastSession?.createdAt,
      lastSessionStatus: lastSession?.status,
    };

    res.json({ stats });
  } catch (error) {
    console.error('Error fetching simulation stats:', error);
    res.status(500).json({ error: 'Failed to fetch simulation statistics' });
  }
});

/**
 * @swagger
 * /api/simulations/{id}/sessions/{sessionId}/messages:
 *   get:
 *     summary: Get messages for a specific simulation session
 *     tags: [Simulations]
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
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
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
 *           default: 50
 *         description: Number of messages per page
 *     responses:
 *       200:
 *         description: Messages retrieved successfully
 *       404:
 *         description: Simulation or session not found
 *       403:
 *         description: Not authorized to access this session
 *       500:
 *         description: Server error
 */
// Get messages for a simulation session
router.get('/:id/sessions/:sessionId/messages', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, sessionId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Verify session belongs to user and simulation
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const session = await sessionRepository.findOne({
      where: {
        id: sessionId,
        simulation: { id },
        user: { id: req.user!.id },
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get messages for this session
    const messageRepository = AppDataSource.getRepository(SessionMessage);
    const [messages, total] = await messageRepository
      .createQueryBuilder('message')
      .where('message.sessionId = :sessionId', { sessionId })
      .orderBy('message.sequenceNumber', 'ASC')
      .skip((Number(page) - 1) * Number(limit))
      .take(Number(limit))
      .getManyAndCount();

    // Transform messages to include isFromUser field for frontend compatibility
    const transformedMessages = messages.map(message => ({
      ...message,
      isFromUser: message.type === MessageType.USER,
    }));

    res.json({
      messages: transformedMessages,
      pagination: {
        current: Number(page),
        total: Math.ceil(total / Number(limit)),
        count: total,
        limit: Number(limit),
      },
    });
  } catch (error) {
    console.error('Error fetching session messages:', error);
    res.status(500).json({ error: 'Failed to fetch session messages' });
  }
});

/**
 * @swagger
 * /api/simulations/{id}/sessions/{sessionId}/messages:
 *   post:
 *     summary: Add a new message to a simulation session
 *     tags: [Simulations]
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
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *               - type
 *             properties:
 *               content:
 *                 type: string
 *                 description: Message content
 *                 example: "Thank you for the opportunity to interview for this position."
 *               type:
 *                 type: string
 *                 enum: [user, ai, system]
 *                 description: Type of message
 *                 example: "user"
 *               inputMethod:
 *                 type: string
 *                 enum: [text, voice]
 *                 description: How the message was input
 *                 example: "text"
 *               metadata:
 *                 type: object
 *                 description: Additional message metadata
  *               syncMode:
  *                 type: boolean
  *                 description: Development only. If true, run evaluations synchronously; if false or omitted, run evaluations in background.
  *                 example: false
 *     responses:
 *       201:
 *         description: Message created successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Session not found
 *       403:
 *         description: Not authorized to access this session
 *       500:
 *         description: Server error
 */
// Add a message to a simulation session
router.post('/:id/sessions/:sessionId/messages', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const simulationId = req.params.id;
    const sessionId = req.params.sessionId;
    const { content, type, inputMethod, metadata, syncMode } = req.body;

    if (!content || !type) {
      return res.status(400).json({ error: 'Content and type are required' });
    }

    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }

    // Verify session belongs to user and simulation
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const session = await sessionRepository.findOne({
      where: {
        id: sessionId,
        simulation: { id: simulationId },
        user: { id: req.user!.id },
      },
      relations: ['simulation', 'simulation.personas'],
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get next sequence number
    const messageRepository = AppDataSource.getRepository(SessionMessage);
    const lastMessage = await messageRepository
      .createQueryBuilder('message')
      .where('message.sessionId = :sessionId', { sessionId })
      .orderBy('message.sequenceNumber', 'DESC')
      .getOne();

    const sequenceNumber = (lastMessage?.sequenceNumber || 0) + 1;

    // Create new user message
    const message = new SessionMessage();
    message.session = session; // Properly establish the relationship
    message.sequenceNumber = sequenceNumber;
    message.type = type as MessageType;
    message.content = content;
    message.inputMethod = inputMethod as MessageInputMethod;
    message.metadata = metadata;
    message.timestamp = new Date();

    await messageRepository.save(message);

    // Update message count without manually managing the messages collection
    // TypeORM will handle the relationship synchronization automatically
    session.addMessage();
    session.lastUserMessageAt = new Date();
    session.turn = 'ai';
    await sessionRepository.save(session);

    // Transform message to include isFromUser field for frontend compatibility
    // Exclude the session property to avoid circular reference
    const transformedMessage = {
      id: message.id,
      sessionId: session.id,
      sequenceNumber: message.sequenceNumber,
      type: message.type,
      content: message.content,
      inputMethod: message.inputMethod,
      metadata: message.metadata,
      timestamp: message.timestamp,
      isHighlighted: message.isHighlighted,
      highlightReason: message.highlightReason,
      analysisData: message.analysisData,
      createdAt: message.createdAt,
      isFromUser: message.type === MessageType.USER,
    };

    // If this is a user message, generate AI response
    if (type === MessageType.USER && session.simulation?.personas?.length > 0) {
      try {
        // Check if LangGraph is enabled
        if (config.langgraph.useLangGraph) {
          console.log('🔵 Using LangGraph for conversation');
          
          // Use LangGraph for conversation
          const { invokeConversationGraph } = await import('@/services/langgraph');
          
          await invokeConversationGraph({
            sessionId,
            userId: req.user!.id,
            userMessage: content,
          });
          
          // Graph handles all persistence and emission
          // Just return success
          return res.status(201).json({ message: transformedMessage });
        }
        
        // OLD PATH: Import AI service dynamically to avoid circular dependencies
        const { AIService } = await import('@/services/ai');
        const aiService = new AIService();

        // Get conversation history including the new message
        const allMessages = await messageRepository
          .createQueryBuilder('message')
          .where('message.sessionId = :sessionId', { sessionId })
          .orderBy('message.sequenceNumber', 'ASC')
          .getMany();

        // Build conversation context - use first persona for now
        const activePersona = session.simulation.personas[0];
        const conversationContext = {
          persona: activePersona,
          simulation: session.simulation,
          conversationHistory: allMessages.slice(0, -1), // All messages except the new one
          sessionDuration: Date.now() - session.createdAt.getTime(),
        };

        // Generate main AI response
        // const cs: any = activePersona.conversationStyle || {};
        
        let aiResponse = null as any;
        let backchannelSent = false;
        try {
          // Removed backchannel logic - burstiness handles follow-up behavior
          if (false) {
            // Send a brief clarification/backchannel instead of a full response
            const backchannel = await aiService.generateProactivePersonaMessage(conversationContext, { reason: 'backchannel', lastUserMessage: content });

            const aiMessage = new SessionMessage();
            aiMessage.session = session; // Properly establish the relationship
            aiMessage.sequenceNumber = sequenceNumber + 1;
            aiMessage.type = MessageType.AI;
            aiMessage.content = backchannel.message;
            aiMessage.inputMethod = null;
            aiMessage.metadata = {
              confidence: backchannel.confidence,
              processingTime: backchannel.processingTime,
              emotionalTone: backchannel.emotionalTone,
              sentiment: backchannel.metadata.sentiment,
              responseToMessageId: message.id,
              isBackchannel: true,
            } as any;
            aiMessage.timestamp = new Date();
            await messageRepository.save(aiMessage);

            session.addMessage();
            session.lastAiMessageAt = new Date();
            session.turn = 'user';
            // Schedule inactivity nudge window for user based on persona config (unified {min,max} with fallbacks)
            {
              const csDelay: any = activePersona.conversationStyle || {};
              const delayCfg = csDelay?.inactivityNudgeDelaySec || {};
              const minSec = Math.max(5, Number(delayCfg?.min ?? 60));
              const maxSec = Math.max(minSec, Number(delayCfg?.max ?? 180));
              const delay = randomDelayMs(minSec * 1000, maxSec * 1000);
              session.inactivityNudgeAt = new Date(Date.now() + delay);
            }
            session.inactivityNudgeCount = session.inactivityNudgeCount || 0;
            await sessionRepository.save(session);

            // Emit via Socket.IO
            try {
              const { io } = await import('@/server');
              io.to(`session-${sessionId}`).emit('message-received', {
                sessionId,
                message: {
                  id: aiMessage.id,
                  sessionId: session.id,
                  sequenceNumber: aiMessage.sequenceNumber,
                  type: aiMessage.type,
                  content: aiMessage.content,
                  inputMethod: aiMessage.inputMethod,
                  metadata: aiMessage.metadata,
                  timestamp: aiMessage.timestamp,
                  isHighlighted: aiMessage.isHighlighted,
                  highlightReason: aiMessage.highlightReason,
                  analysisData: aiMessage.analysisData,
                  createdAt: aiMessage.createdAt,
                  isFromUser: false,
                },
                timestamp: new Date(),
              });
            } catch (emitErr) {
              console.warn('⚠️ Failed to emit backchannel message:', emitErr);
            }

            backchannelSent = true;
          }
        } catch (bcErr) {
          console.warn('⚠️ Backchannel generation failed, falling back to normal response:', bcErr);
        }

        if (!backchannelSent) {
          // Generate full AI response
          aiResponse = await aiService.generatePersonaResponse(conversationContext, content);
        }

        if (!backchannelSent) {
          // Create AI response message
          const aiMessage = new SessionMessage();
          aiMessage.session = session; // Properly establish the relationship
          aiMessage.sequenceNumber = sequenceNumber + 1;
          aiMessage.type = MessageType.AI;
          aiMessage.content = aiResponse.message;
          aiMessage.inputMethod = null;
          aiMessage.metadata = {
            confidence: aiResponse.confidence,
            processingTime: aiResponse.processingTime,
            emotionalTone: aiResponse.emotionalTone,
            sentiment: aiResponse.metadata.sentiment,
            responseToMessageId: message.id,
            // Include extended analysis data for reuse in evaluations
            emotionAnalysis: aiResponse.metadata.emotionAnalysis,
            sentimentAnalysis: aiResponse.metadata.sentimentAnalysis,
            // Include quality scores for analytics and reporting
            qualityScores: aiResponse.metadata.qualityScores,
          };
          aiMessage.timestamp = new Date();

          await messageRepository.save(aiMessage);

          // Update message count
          session.addMessage();
          session.lastAiMessageAt = new Date();
          session.turn = 'user';
          // Schedule inactivity nudge window for user: random 1-3 minutes
          const minMs = 1 * 60 * 1000;
          const maxMs = 3 * 60 * 1000;
          const delay = randomDelayMs(minMs, maxMs);
          session.inactivityNudgeAt = new Date(Date.now() + delay);
          session.inactivityNudgeCount = session.inactivityNudgeCount || 0;

          // Evaluate goals based on last user and AI messages
          const syncModeParam = typeof syncMode === 'string' ? syncMode.toLowerCase() === 'true' : !!syncMode;
          const shouldRunEvalSync = !config.isDevelopment || syncModeParam === true;

          if (shouldRunEvalSync) {
          // Run evaluation synchronously (development mode and syncMode is true)
            try {
              const evalResult = await evaluationsService.evaluateAfterTurnLLM(session.simulation, session, message, aiMessage);
              session.goalProgress = evalResult.updatedProgress as any;
              if (evalResult.allRequiredAchieved && session.status !== SessionStatus.COMPLETED) {
                session.markAsCompleted();
              }
              const summary = {
                allRequiredAchieved: evalResult.allRequiredAchieved,
                steps: (evalResult.updatedProgress || []).map((p: any) => ({ goalNumber: p.goalNumber, status: p.status, confidence: p.confidence })),
              };
              console.log('💡 Goal evaluation result:', JSON.stringify(summary));
            } catch (e) {
              console.warn('⚠️ Goal evaluation failed:', e);
            }

            await sessionRepository.save(session);
            if (session.status === SessionStatus.COMPLETED) {
              setImmediate(() => {
                computeAndPersistSessionScores(session.id).catch((e) => {
                  console.warn('⚠️ Failed to compute scores after completion:', e);
                });
              });
            }

            // Emit goal progress update to session room
            try {
              await emitGoalProgressUpdate(session);
            } catch (emitErr) {
              console.warn('⚠️ Failed to emit goal progress update:', emitErr);
            }
          } else {
          // Run evaluation in the background
            void (async () => {
              try {
                const evalResult = await evaluationsService.evaluateAfterTurnLLM(session.simulation, session, message, aiMessage);
                session.goalProgress = evalResult.updatedProgress as any;
                if (evalResult.allRequiredAchieved && session.status !== SessionStatus.COMPLETED) {
                  session.markAsCompleted();
                }
                const bgSummary = {
                  allRequiredAchieved: evalResult.allRequiredAchieved,
                  steps: (evalResult.updatedProgress || []).map((p: any) => ({ goalNumber: p.goalNumber, status: p.status, confidence: p.confidence })),
                };
                console.log('💡 [background] Goal evaluation result:', JSON.stringify(bgSummary));
              } catch (e) {
                console.warn('⚠️ [background] Goal evaluation failed:', e);
              }

              try {
                await sessionRepository.save(session);
                if (session.status === SessionStatus.COMPLETED) {
                  setImmediate(() => {
                    computeAndPersistSessionScores(session.id).catch((e) => {
                      console.warn('⚠️ [background] Failed to compute scores after completion:', e);
                    });
                  });
                }
                // Emit goal progress update to session room after background save
                try {
                  await emitGoalProgressUpdate(session);
                } catch (emitErr) {
                  console.warn('⚠️ [background] Failed to emit goal progress update:', emitErr);
                }
              } catch (saveErr) {
                console.warn('⚠️ [background] Failed to save session after evaluation:', saveErr);
              }
            })();
          }

          // Transform AI message for frontend
          // Exclude the session property to avoid circular reference
          const transformedAiMessage = {
            id: aiMessage.id,
            sessionId: session.id,
            sequenceNumber: aiMessage.sequenceNumber,
            type: aiMessage.type,
            content: aiMessage.content,
            inputMethod: aiMessage.inputMethod,
            metadata: aiMessage.metadata,
            timestamp: aiMessage.timestamp,
            isHighlighted: aiMessage.isHighlighted,
            highlightReason: aiMessage.highlightReason,
            analysisData: aiMessage.analysisData,
            createdAt: aiMessage.createdAt,
            isFromUser: false,
          };

          // Only emit AI message via Socket.IO
          // User message is handled via API response to avoid duplication
          const { io } = await import('@/server');
          io.to(`session-${sessionId}`).emit('message-received', {
            sessionId,
            message: transformedAiMessage,
            timestamp: new Date(),
          });

          console.log(`✅ AI response generated for session ${String(sessionId)}`);
          console.log(`🤖 Persona model used: ${String(aiResponse.metadata.model)} (default configured: ${String((await import('@/config/env')).config.ai.openai.model)})`);
        }

        // Optionally trigger a small burst of follow-up messages in background
        if (!backchannelSent) {
          const baseAiSeq = sequenceNumber + 1;
          void (async () => {
            try {
              const cs: any = activePersona.conversationStyle || {};
              const burst = cs?.burstiness;
              const burstMin = Math.max(1, Number(burst?.min) || 1);
              const burstMax = Math.max(burstMin, Number(burst?.max) || 1);
              const extraCount = Math.max(0, randomInt(burstMin, burstMax) - 1);
              const typingWpm = Math.max(60, Number(cs?.typingSpeedWpm) || 120);
              let nextSeq = baseAiSeq + 1;
              for (let i = 0; i < extraCount; i++) {
              // Prepare context with current messages
                const updatedMessages = await messageRepository
                  .createQueryBuilder('message')
                  .where('message.sessionId = :sessionId', { sessionId })
                  .orderBy('message.sequenceNumber', 'ASC')
                  .getMany();

                const contextForFollowup = {
                  persona: activePersona,
                  simulation: session.simulation,
                  conversationHistory: updatedMessages as SessionMessage[],
                  sessionDuration: Date.now() - session.createdAt.getTime(),
                };

                const previousAi = [...updatedMessages].reverse().find((m) => m.type === MessageType.AI)?.content;
                
                // Get recent AI messages to check for repetition against multiple messages, not just the last one
                const recentAiMessages = [...updatedMessages]
                  .reverse()
                  .filter((m) => m.type === MessageType.AI)
                  .slice(0, 3)
                  .map(m => m.content);

                // Try to generate a non-duplicative follow-up (one retry if too similar)
                const similarityThreshold = 0.82;
                let follow = await aiService.generateProactivePersonaMessage(
                  contextForFollowup,
                  { reason: 'followup', lastUserMessage: content, previousAiMessage: previousAi },
                );
                
                // Check similarity against multiple recent AI messages to catch longer-term loops
                const isTooSimilar = recentAiMessages.some(
                  recentMsg => compositeSimilarity(recentMsg, follow.message) >= similarityThreshold,
                );
                
                if (isTooSimilar && previousAi) {
                  // Retry once with a stronger instruction baked in via previousAiMessage
                  const strongerPrev = `${previousAi}\n[CRITICAL: Your last few messages were too similar. Provide a COMPLETELY DIFFERENT angle, new detail, or next actionable step. Use different vocabulary and sentence structure.]`;
                  follow = await aiService.generateProactivePersonaMessage(
                    contextForFollowup,
                    { reason: 'followup', lastUserMessage: content, previousAiMessage: strongerPrev },
                  );
                }
                
                // Check again against recent messages
                const stillTooSimilar = recentAiMessages.some(
                  recentMsg => compositeSimilarity(recentMsg, follow.message) >= similarityThreshold,
                );
                
                if (stillTooSimilar) {
                  // Still too similar; skip sending this follow-up
                  console.log(`⚠️ Skipping follow-up message ${i + 1}/${extraCount} due to high similarity with recent messages`);
                  continue;
                }

                // Simulate typing delay based on length
                const words = Math.max(3, follow.message.split(/\s+/).length);
                const millis = Math.min(4000, Math.ceil((words / typingWpm) * 60_000));
                await new Promise(r => setTimeout(r, millis));

                const followMsg = new SessionMessage();
                followMsg.session = session;
                followMsg.sequenceNumber = nextSeq++;
                followMsg.type = MessageType.AI;
                followMsg.content = follow.message;
                followMsg.timestamp = new Date();
                followMsg.metadata = {
                  confidence: follow.confidence,
                  processingTime: follow.processingTime,
                  emotionalTone: follow.emotionalTone,
                  sentiment: follow.metadata.sentiment,
                };
                await messageRepository.save(followMsg);

                session.addMessage();
                session.lastAiMessageAt = new Date();
                // Reset inactivity timer each follow-up based on persona config (unified {min,max} with fallbacks)
                {
                  const csDelay: any = activePersona.conversationStyle || {};
                  const delayCfg = csDelay?.inactivityNudgeDelaySec || {};
                  const minSec = Math.max(5, Number(delayCfg?.min ?? 60));
                  const maxSec = Math.max(minSec, Number(delayCfg?.max ?? 180));
                  const delayFollow = randomDelayMs(minSec * 1000, maxSec * 1000);
                  session.inactivityNudgeAt = new Date(Date.now() + delayFollow);
                }
                await sessionRepository.save(session);

                const transformedFollow = {
                  id: followMsg.id,
                  sessionId: session.id,
                  sequenceNumber: followMsg.sequenceNumber,
                  type: followMsg.type,
                  content: followMsg.content,
                  inputMethod: followMsg.inputMethod,
                  metadata: followMsg.metadata,
                  timestamp: followMsg.timestamp,
                  isHighlighted: followMsg.isHighlighted,
                  highlightReason: followMsg.highlightReason,
                  analysisData: followMsg.analysisData,
                  createdAt: followMsg.createdAt,
                  isFromUser: false,
                };
                const { io } = await import('@/server');
                io.to(`session-${sessionId}`).emit('message-received', {
                  sessionId,
                  message: transformedFollow,
                  timestamp: new Date(),
                });
              }

              // After the burst, run a consolidated goal evaluation only if we actually sent follow-ups
              if (extraCount > 0) {
                try {
                  const latestMessages = await messageRepository
                    .createQueryBuilder('message')
                    .where('message.sessionId = :sessionId', { sessionId })
                    .orderBy('message.sequenceNumber', 'DESC')
                    .getMany();
                  const latestAi = latestMessages.find((m) => m.type === MessageType.AI);
                  const lastUser = latestMessages.find((m) => m.type === MessageType.USER);
                  if (lastUser) {
                    const evalResult = await evaluationsService.evaluateAfterTurnLLM(session.simulation, session, lastUser, latestAi);
                    session.goalProgress = evalResult.updatedProgress as any;
                    if (evalResult.allRequiredAchieved && session.status !== SessionStatus.COMPLETED) {
                      session.markAsCompleted();
                    }
                    await sessionRepository.save(session);
                    try {
                      await emitGoalProgressUpdate(session);
                    } catch (emitErr) {
                      console.warn('⚠️ Failed to emit goal progress after burst:', emitErr);
                    }
                  }
                } catch (postEvalErr) {
                  console.warn('⚠️ Post-burst evaluation failed:', postEvalErr);
                }
              }
            } catch (burstErr) {
              console.warn('⚠️ Burst follow-up failed:', burstErr);
            }
          })();
        }
      } catch (aiError) {
        console.error('Error generating AI response:', aiError);
        // Don't fail the entire request if AI response fails
        // The user message was still saved successfully
      }
    }

    res.status(201).json({ message: transformedMessage });
  } catch (error) {
    console.error('Error creating session message:', error);
    res.status(500).json({ error: 'Failed to create session message' });
  }
});

/**
 * @swagger
 * /api/simulations/{id}/sessions/{sessionId}/messages/{messageId}/highlight:
 *   patch:
 *     summary: Highlight or unhighlight a message in a session
 *     tags: [Simulations]
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
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Message ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isHighlighted
 *             properties:
 *               isHighlighted:
 *                 type: boolean
 *                 description: Whether to highlight the message
 *                 example: true
 *               reason:
 *                 type: string
 *                 description: Reason for highlighting (required if isHighlighted is true)
 *                 example: "Excellent technical response demonstrating deep knowledge"
 *     responses:
 *       200:
 *         description: Message highlight status updated successfully
 *       400:
 *         description: Validation error
 *       404:
 *         description: Message not found
 *       403:
 *         description: Not authorized to access this session
 *       500:
 *         description: Server error
 */
// Highlight/unhighlight a message
router.patch('/:id/sessions/:sessionId/messages/:messageId/highlight', authenticateToken as any, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id, sessionId, messageId } = req.params;
    const { isHighlighted, reason } = req.body;

    if (typeof isHighlighted !== 'boolean') {
      return res.status(400).json({ error: 'isHighlighted must be a boolean' });
    }

    if (isHighlighted && !reason) {
      return res.status(400).json({ error: 'Reason is required when highlighting a message' });
    }

    // Verify session belongs to user and simulation
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const session = await sessionRepository.findOne({
      where: {
        id: sessionId,
        simulation: { id },
        user: { id: req.user!.id },
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Find and update the message
    const messageRepository = AppDataSource.getRepository(SessionMessage);
    const message = await messageRepository.findOne({
      where: { id: messageId, sessionId },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (isHighlighted) {
      message.markAsHighlighted(reason);
    } else {
      message.isHighlighted = false;
      message.highlightReason = undefined;
    }

    await messageRepository.save(message);

    res.json({ message });
  } catch (error) {
    console.error('Error updating message highlight:', error);
    res.status(500).json({ error: 'Failed to update message highlight' });
  }
});

export default router; 