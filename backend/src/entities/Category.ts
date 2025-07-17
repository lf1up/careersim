import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Simulation } from './Simulation';

/**
 * @swagger
 * components:
 *   schemas:
 *     Category:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           format: uuid
 *           example: "123e4567-e89b-12d3-a456-426614174000"
 *         name:
 *           type: string
 *           maxLength: 255
 *           example: "Business Communication"
 *         slug:
 *           type: string
 *           maxLength: 255
 *           example: "business-communication"
 *         description:
 *           type: string
 *           nullable: true
 *           example: "Develop your professional communication skills"
 *         iconUrl:
 *           type: string
 *           nullable: true
 *           maxLength: 255
 *           example: "https://example.com/icons/business.png"
 *         color:
 *           type: string
 *           nullable: true
 *           maxLength: 50
 *           example: "#3B82F6"
 *         sortOrder:
 *           type: integer
 *           minimum: 0
 *           example: 1
 *         isActive:
 *           type: boolean
 *           example: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2024-01-15T10:30:00Z"
 *         simulations:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Simulation'
 *         simulationCount:
 *           type: integer
 *           minimum: 0
 *           example: 5
 */

@Entity('categories')
@Index(['slug'], { unique: true })
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  slug!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  iconUrl?: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  color?: string;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  // Relationships
  @OneToMany(() => Simulation, (simulation) => simulation.category)
  simulations!: Simulation[];

  // Virtual properties
  get simulationCount(): number {
    return this.simulations?.length || 0;
  }
} 