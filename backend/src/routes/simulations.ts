import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest, optionalAuth } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { Simulation, SimulationStatus } from '@/entities/Simulation';

const router: any = Router();

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
      .leftJoinAndSelect('simulation.persona', 'persona')
      .where('simulation.status = :status', { status: SimulationStatus.PUBLISHED });

    if (category) {
      queryBuilder.andWhere('category.id = :category', { category });
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
    
    const simulation = await simulationRepository
      .createQueryBuilder('simulation')
      .leftJoinAndSelect('simulation.category', 'category')
      .leftJoinAndSelect('simulation.persona', 'persona')
      .where('simulation.id = :idOrSlug OR simulation.slug = :idOrSlug', { idOrSlug })
      .andWhere('simulation.status = :status', { status: SimulationStatus.PUBLISHED })
      .getOne();

    if (!simulation) {
      return res.status(404).json({ error: 'Simulation not found' });
    }

    res.json({ simulation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch simulation' });
  }
});

export default router; 