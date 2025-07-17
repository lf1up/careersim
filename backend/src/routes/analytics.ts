import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { SimulationSession } from '@/entities/SimulationSession';
import { PerformanceAnalytics } from '@/entities/PerformanceAnalytics';

const router: any = Router();

// All analytics routes require authentication
router.use(authenticateToken as any);

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
          status: 'completed' as any
        }
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
    const avgScores = await sessionRepository
      .createQueryBuilder('session')
      .select('AVG(session.overallScore)', 'avgOverall')
      .addSelect('AVG(session.scores->"$.communication")', 'avgCommunication')
      .addSelect('AVG(session.scores->"$.problemSolving")', 'avgProblemSolving')
      .addSelect('AVG(session.scores->"$.emotional")', 'avgEmotional')
      .where('session.user.id = :userId', { userId: req.user!.id })
      .andWhere('session.overallScore IS NOT NULL')
      .getRawOne();

    res.json({
      stats: {
        totalSessions,
        completedSessions,
        completionRate: totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0,
      },
      averageScores: avgScores,
      recentAnalytics,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get analytics for a specific session
router.get('/session/:sessionId', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const analyticsRepository = AppDataSource.getRepository(PerformanceAnalytics);
    const analytics = await analyticsRepository.findOne({
      where: { 
        session: { 
          id: req.params.sessionId,
          user: { id: req.user!.id }
        }
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