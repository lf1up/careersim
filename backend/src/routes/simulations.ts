import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { Simulation, SimulationStatus } from '@/entities/Simulation';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { SessionMessage, MessageType, MessageInputMethod } from '@/entities/SessionMessage';

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
      where: { id, status: SimulationStatus.PUBLISHED }
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    // Get user's sessions for this simulation
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const [sessions, total] = await sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.simulation', 'simulation')
      .where('session.simulation.id = :simulationId', { simulationId: id })
      .andWhere('session.user.id = :userId', { userId: req.user!.id })
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
      relations: ['category', 'personas']
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

    await sessionRepository.save(session);

    // Return the session with simulation details
    const sessionWithDetails = await sessionRepository.findOne({
      where: { id: session.id },
      relations: ['simulation', 'simulation.category', 'simulation.personas']
    });

    res.status(201).json({ session: sessionWithDetails });
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
      where: { id, status: SimulationStatus.PUBLISHED }
    });

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    // Get user's session statistics for this simulation
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const sessions = await sessionRepository.find({
      where: {
        simulation: { id },
        user: { id: req.user!.id }
      },
      order: { createdAt: 'DESC' }
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
        user: { id: req.user!.id }
      }
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
      isFromUser: message.type === MessageType.USER
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
    const { content, type, inputMethod, metadata } = req.body;

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
        user: { id: req.user!.id }
      },
      relations: ['simulation', 'simulation.personas']
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
      isFromUser: message.type === MessageType.USER
    };

    // If this is a user message, generate AI response
    if (type === MessageType.USER && session.simulation?.personas?.length > 0) {
      try {
        // Import AI service dynamically to avoid circular dependencies
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
          sessionDuration: Date.now() - session.createdAt.getTime()
        };

        // Generate AI response
        const aiResponse = await aiService.generatePersonaResponse(conversationContext, content);

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
          responseToMessageId: message.id
        };
        aiMessage.timestamp = new Date();

        await messageRepository.save(aiMessage);

        // Update message count without manually managing the messages collection
        // TypeORM will handle the relationship synchronization automatically
        session.addMessage();
        await sessionRepository.save(session);

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
          isFromUser: false
        };

        // Only emit AI message via Socket.IO
        // User message is handled via API response to avoid duplication
        const { io } = await import('@/server');
        io.to(`session-${sessionId}`).emit('message-received', {
          sessionId,
          message: transformedAiMessage,
          timestamp: new Date(),
        });

        console.log(`✅ AI response generated for session ${sessionId}`);
        console.log(`🤖 Model used: ${aiResponse.metadata.model} (default configured: ${(await import('@/config/env')).config.ai.openai.model})`)
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
        user: { id: req.user!.id }
      }
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Find and update the message
    const messageRepository = AppDataSource.getRepository(SessionMessage);
    const message = await messageRepository.findOne({
      where: { id: messageId, sessionId }
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