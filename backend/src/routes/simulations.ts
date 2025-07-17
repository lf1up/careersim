import { Router, Request, Response } from 'express';
import { authenticateToken, AuthenticatedRequest, optionalAuth } from '@/middleware/auth';
import { AppDataSource } from '@/config/database';
import { Simulation, SimulationStatus } from '@/entities/Simulation';

const router: any = Router();

// Get all published simulations (public endpoint with optional auth)
router.get('/', optionalAuth as any, async (req: AuthenticatedRequest, res: Response) => {
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
router.get('/:idOrSlug', optionalAuth as any, async (req: AuthenticatedRequest, res: Response) => {
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