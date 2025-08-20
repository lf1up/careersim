import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { SimulationSession, SessionStatus } from '@/entities/SimulationSession';
import { PerformanceAnalytics } from '@/entities/PerformanceAnalytics';

const router: Router = Router();

// All analytics routes require authentication
router.use(authenticateToken as any);

/**
 * @swagger
 * /api/analytics/performance:
 *   get:
 *     summary: Get user's performance analytics
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Performance analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalSessions:
 *                       type: integer
 *                       description: Total number of sessions
 *                     completedSessions:
 *                       type: integer
 *                       description: Number of completed sessions
 *                     completionRate:
 *                       type: number
 *                       format: float
 *                       description: Session completion rate as percentage
 *                 averageScores:
 *                   type: object
 *                   properties:
 *                     avgOverall:
 *                       type: number
 *                       format: float
 *                       description: Average overall score
 *                     avgCommunication:
 *                       type: number
 *                       format: float
 *                       description: Average communication score
 *                     avgProblemSolving:
 *                       type: number
 *                       format: float
 *                       description: Average problem solving score
 *                     avgEmotional:
 *                       type: number
 *                       format: float
 *                       description: Average emotional intelligence score
 *                 recentAnalytics:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PerformanceAnalytics'
 *                   description: Recent performance analytics (last 10)
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Server error
 */
// Get user's performance analytics
router.get('/performance', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sessionRepository = AppDataSource.getRepository(SimulationSession);
    const analyticsRepository = AppDataSource.getRepository(PerformanceAnalytics);

    // Get user's session stats
    const [totalSessions, completedSessions] = await Promise.all([
      sessionRepository.count({ where: { user: { id: req.user!.id } } }),
      sessionRepository.count({ 
        where: { 
          user: { id: req.user!.id },
          status: 'completed' as any,
        },
      }),
    ]);

    // Get recent analytics
    const recentAnalytics = await analyticsRepository.find({
      where: { session: { user: { id: req.user!.id } } },
      relations: ['session', 'session.simulation'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    // Calculate average scores
    const avgScoresRaw = await sessionRepository
      .createQueryBuilder('session')
      .select('AVG(session.overallScore)', 'avgOverall')
      .addSelect('AVG((session.scores->>\'communication\')::numeric)', 'avgCommunication')
      .addSelect('AVG((session.scores->>\'problemSolving\')::numeric)', 'avgProblemSolving')
      .addSelect('AVG((session.scores->>\'emotional\')::numeric)', 'avgEmotional')
      .addSelect('AVG((session.scores->>\'outcome\')::numeric)', 'avgOutcome')
      .where('session.user.id = :userId', { userId: req.user!.id })
      .andWhere('session.overallScore IS NOT NULL')
      .getRawOne();

    // Normalize numeric strings -> numbers and clamp to sensible ranges
    const toNum = (v: any) => (v === null || v === undefined ? 0 : Number(v));
    const averageScores = {
      // Convert overall 0..100 -> 0..1 for frontend consistency
      avgOverall: Number((toNum(avgScoresRaw?.avgOverall) / 100).toFixed(3)),
      avgCommunication: Number(toNum(avgScoresRaw?.avgCommunication).toFixed(3)), // 0..1
      avgProblemSolving: Number(toNum(avgScoresRaw?.avgProblemSolving).toFixed(3)), // 0..1
      avgEmotional: Number(toNum(avgScoresRaw?.avgEmotional).toFixed(3)), // 0..1
      avgOutcome: Number(toNum(avgScoresRaw?.avgOutcome).toFixed(3)), // 0..1
    };

    // Derived metrics
    const avgDurationRaw = await sessionRepository
      .createQueryBuilder('session')
      .select('AVG(session.durationSeconds)', 'avgDuration')
      .where('session.user.id = :userId', { userId: req.user!.id })
      .getRawOne();

    const bestOverallRaw = await sessionRepository
      .createQueryBuilder('session')
      .select('MAX(session.overallScore)', 'best')
      .where('session.user.id = :userId', { userId: req.user!.id })
      .andWhere('session.overallScore IS NOT NULL')
      .getRawOne();

    const thirtyDaysAgoRate = await (async () => {
      const totals = await sessionRepository
        .createQueryBuilder('session')
        .select('COUNT(*)', 'total')
        .where('session.user.id = :userId', { userId: req.user!.id })
        .andWhere('session.createdAt >= NOW() - INTERVAL \'30 days\'')
        .getRawOne();
      const completed = await sessionRepository
        .createQueryBuilder('session')
        .select('COUNT(*)', 'count')
        .where('session.user.id = :userId', { userId: req.user!.id })
        .andWhere('session.createdAt >= NOW() - INTERVAL \'30 days\'')
        .andWhere('session.status = :status', { status: SessionStatus.COMPLETED })
        .getRawOne();
      const totalNum = Number(totals?.total || 0);
      const compNum = Number(completed?.count || 0);
      const rate = totalNum > 0 ? (compNum / totalNum) * 100 : 0;
      return Number(rate.toFixed(2));
    })();

    res.json({
      stats: {
        totalSessions,
        completedSessions,
        completionRate: totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0,
      },
      averageScores,
      // Extra derived metrics for the UI
      derived: {
        averageDurationSeconds: Number((Number(avgDurationRaw?.avgDuration || 0)).toFixed(0)),
        bestOverallScore: Number((Number(bestOverallRaw?.best || 0)).toFixed(2)),
        recentCompletionRate30d: thirtyDaysAgoRate,
      },
      recentAnalytics,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * @swagger
 * /api/analytics/session/{sessionId}:
 *   get:
 *     summary: Get analytics for a specific session
 *     tags: [Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Session ID to get analytics for
 *     responses:
 *       200:
 *         description: Session analytics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 analytics:
 *                   $ref: '#/components/schemas/PerformanceAnalytics'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       404:
 *         description: Analytics not found for this session
 *       500:
 *         description: Server error
 */
// Get analytics for a specific session
router.get('/session/:sessionId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const analyticsRepository = AppDataSource.getRepository(PerformanceAnalytics);
    const analytics = await analyticsRepository.findOne({
      where: { 
        session: { 
          id: req.params.sessionId,
          user: { id: req.user!.id },
        },
      },
      relations: ['session', 'session.simulation'],
    });

    if (!analytics) {
      return res.status(404).json({ error: 'Analytics not found' });
    }

    res.json({ analytics });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session analytics' });
  }
});

export default router; 