import { Router, Request, Response } from 'express';
import { AppDataSource } from '@/config/database';
import { Category } from '@/entities/Category';

const router: any = Router();

// Get all categories (public endpoint)
router.get('/', async (req: Request, res: Response) => {
  try {
    const categoryRepository = AppDataSource.getRepository(Category);
    const categories = await categoryRepository.find({
      order: { name: 'ASC' },
    });

    res.json({ categories });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get category by ID with simulations
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const categoryRepository = AppDataSource.getRepository(Category);
    const category = await categoryRepository.findOne({
      where: { id: req.params.id },
      relations: ['simulations'],
    });

    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ category });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch category' });
  }
});

export default router; 