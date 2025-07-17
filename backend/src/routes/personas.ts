import { Router, Request, Response } from 'express';
import { AppDataSource } from '@/config/database';
import { Persona } from '@/entities/Persona';

const router: any = Router();

/**
 * @swagger
 * /api/personas:
 *   get:
 *     summary: Get all personas
 *     tags: [Personas]
 *     responses:
 *       200:
 *         description: List of personas retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 personas:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Persona'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to fetch personas
 */
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

/**
 * @swagger
 * /api/personas/{id}:
 *   get:
 *     summary: Get persona by ID
 *     tags: [Personas]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Persona ID
 *     responses:
 *       200:
 *         description: Persona retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 persona:
 *                   $ref: '#/components/schemas/Persona'
 *       404:
 *         description: Persona not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Persona not found
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: Failed to fetch persona
 */
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