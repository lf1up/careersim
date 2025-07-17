import { Router, Request, Response } from 'express';
import { AppDataSource } from '@/config/database';
import { Persona } from '@/entities/Persona';

const router: any = Router();

// Get all personas (public endpoint)
router.get('/', async (req: Request, res: Response) => {
  try {
    const personaRepository = AppDataSource.getRepository(Persona);
    const personas = await personaRepository.find({
      order: { name: 'ASC' },
    });

    res.json({ personas });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch personas' });
  }
});

// Get persona by ID
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const personaRepository = AppDataSource.getRepository(Persona);
    const persona = await personaRepository.findOne({
      where: { id: req.params.id },
      relations: ['simulations'],
    });

    if (!persona) {
      return res.status(404).json({ error: 'Persona not found' });
    }

    res.json({ persona });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch persona' });
  }
});

export default router; 