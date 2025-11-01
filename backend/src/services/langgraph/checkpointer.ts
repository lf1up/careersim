import { BaseCheckpointSaver, Checkpoint, CheckpointMetadata, CheckpointTuple } from '@langchain/langgraph';

// Define RunnableConfig type locally since it's not exported from @langchain/langgraph
type RunnableConfig = {
  configurable?: {
    thread_id?: string;
    checkpoint_id?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

// Lazy import to avoid TypeORM initialization during module load
let AppDataSource: any;
let SimulationSession: any;
let SessionMessage: any;

/**
 * Lazy-load database dependencies to avoid initialization on import
 */
function loadDatabaseDependencies() {
  if (!AppDataSource) {
    AppDataSource = require('@/config/database').AppDataSource;
    SimulationSession = require('@/entities/SimulationSession').SimulationSession;
    SessionMessage = require('@/entities/SessionMessage').SessionMessage;
  }
}

/**
 * Custom checkpoint entity for storing graph state snapshots
 * We store checkpoints in a dedicated JSON column in the session
 */
interface SerializedCheckpoint {
  checkpointId: string;
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
  parentCheckpointId?: string;
  createdAt: Date;
}

/**
 * PostgreSQL-based checkpoint saver that integrates with our existing database schema
 * Stores checkpoints alongside session data for easy querying and debugging
 */
export class DatabaseCheckpointSaver extends BaseCheckpointSaver {
  private _sessionRepository?: any;
  
  constructor() {
    super();
    // Load database dependencies when checkpointer is instantiated
    loadDatabaseDependencies();
  }

  /**
   * Lazy-load the session repository to avoid initialization issues
   */
  private get sessionRepository() {
    if (!this._sessionRepository) {
      this._sessionRepository = AppDataSource.getRepository(SimulationSession);
    }
    return this._sessionRepository;
  }

  /**
   * Write checkpoint writes (required by BaseCheckpointSaver)
   * For now, we handle this in put() directly
   */
  async putWrites(
    config: RunnableConfig,
    writes: Array<[string, any]>,
    taskId: string,
  ): Promise<void> {
    // Not implemented for now - writes are handled in put()
    return Promise.resolve();
  }

  /**
   * Save a checkpoint to the database
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    const putStartTime = Date.now();
    console.log(`💾 [Checkpointer] PUT checkpoint for thread ${threadId}`);
    
    if (!threadId) {
      throw new Error('thread_id is required in config.configurable for checkpoint persistence');
    }

    try {
      // Load the session
      console.log(`   🔍 Loading session ${threadId}...`);
      const session = await this.sessionRepository.findOne({
        where: { id: threadId },
      });
      console.log(`   ✅ Session loaded in ${Date.now() - putStartTime}ms`);

      if (!session) {
        throw new Error(`Session ${threadId} not found`);
      }

      // Generate checkpoint ID
      const checkpointId = `${threadId}_${Date.now()}_${checkpoint.id || 'ckpt'}`;
      
      // Create serialized checkpoint
      const serializedCheckpoint: SerializedCheckpoint = {
        checkpointId,
        checkpoint,
        metadata,
        parentCheckpointId: config.configurable?.checkpoint_id,
        createdAt: new Date(),
      };

      // Store checkpoint in session metadata
      // We maintain a rolling buffer of the last N checkpoints to avoid unbounded growth
      const maxCheckpoints = 10;
      const checkpoints = (session.sessionMetadata as any)?.checkpoints || [];
      checkpoints.push(serializedCheckpoint);
      
      // Keep only the most recent checkpoints
      const trimmedCheckpoints = checkpoints.slice(-maxCheckpoints);
      
      session.sessionMetadata = {
        ...(session.sessionMetadata || {}),
        checkpoints: trimmedCheckpoints,
        lastCheckpointId: checkpointId,
        lastCheckpointAt: new Date(),
      } as any;

      console.log(`   💾 Saving checkpoint to DB...`);
      const saveStart = Date.now();
      await this.sessionRepository.save(session);
      const saveDuration = Date.now() - saveStart;
      const totalDuration = Date.now() - putStartTime;
      console.log(`   ✅ Checkpoint saved in ${saveDuration}ms (total: ${totalDuration}ms)`);

      return {
        ...config,
        configurable: {
          ...config.configurable,
          checkpoint_id: checkpointId,
        },
      };
    } catch (error) {
      console.error('Error saving checkpoint:', error);
      throw error;
    }
  }

  /**
   * Get a checkpoint by thread ID and optional checkpoint ID
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const getTupleStart = Date.now();
    const threadId = config.configurable?.thread_id;
    const checkpointId = config.configurable?.checkpoint_id;
    console.log(`📖 [Checkpointer] GET checkpoint for thread ${threadId}${checkpointId ? ` (checkpoint: ${checkpointId})` : ' (latest)'}`);

    if (!threadId) {
      return undefined;
    }

    try {
      const session = await this.sessionRepository.findOne({
        where: { id: threadId },
      });
      console.log(`   ✅ Session loaded in ${Date.now() - getTupleStart}ms`);

      if (!session || !(session.sessionMetadata as any)?.checkpoints) {
        return undefined;
      }

      const checkpoints = (session.sessionMetadata as any).checkpoints as SerializedCheckpoint[];
      
      // If specific checkpoint requested, find it
      let targetCheckpoint: SerializedCheckpoint | undefined;
      if (checkpointId) {
        targetCheckpoint = checkpoints.find(c => c.checkpointId === checkpointId);
      } else {
        // Get the most recent checkpoint
        targetCheckpoint = checkpoints[checkpoints.length - 1];
      }

      if (!targetCheckpoint) {
        return undefined;
      }

      // Find parent checkpoint if it exists
      let parentCheckpoint: SerializedCheckpoint | undefined;
      if (targetCheckpoint.parentCheckpointId) {
        parentCheckpoint = checkpoints.find(c => c.checkpointId === targetCheckpoint!.parentCheckpointId);
      }

      return {
        config: {
          ...config,
          configurable: {
            ...config.configurable,
            checkpoint_id: targetCheckpoint.checkpointId,
          },
        },
        checkpoint: targetCheckpoint.checkpoint,
        metadata: targetCheckpoint.metadata,
        parentConfig: parentCheckpoint ? {
          ...config,
          configurable: {
            ...config.configurable,
            checkpoint_id: parentCheckpoint.checkpointId,
          },
        } : undefined,
      };
    } catch (error) {
      console.error('Error getting checkpoint:', error);
      return undefined;
    }
  }

  /**
   * List all checkpoints for a thread
   */
  async *list(config: RunnableConfig): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;

    if (!threadId) {
      return;
    }

    try {
      const session = await this.sessionRepository.findOne({
        where: { id: threadId },
      });

      if (!session || !(session.sessionMetadata as any)?.checkpoints) {
        return;
      }

      const checkpoints = (session.sessionMetadata as any).checkpoints as SerializedCheckpoint[];
      
      // Yield checkpoints in reverse chronological order (most recent first)
      for (let i = checkpoints.length - 1; i >= 0; i--) {
        const checkpoint = checkpoints[i];
        
        // Find parent if exists
        let parentCheckpoint: SerializedCheckpoint | undefined;
        if (checkpoint.parentCheckpointId) {
          parentCheckpoint = checkpoints.find(c => c.checkpointId === checkpoint.parentCheckpointId);
        }

        yield {
          config: {
            ...config,
            configurable: {
              ...config.configurable,
              checkpoint_id: checkpoint.checkpointId,
            },
          },
          checkpoint: checkpoint.checkpoint,
          metadata: checkpoint.metadata,
          parentConfig: parentCheckpoint ? {
            ...config,
            configurable: {
              ...config.configurable,
              checkpoint_id: parentCheckpoint.checkpointId,
            },
          } : undefined,
        };
      }
    } catch (error) {
      console.error('Error listing checkpoints:', error);
      return;
    }
  }

  /**
   * Delete all checkpoints for a thread (required by BaseCheckpointSaver)
   */
  async deleteThread(threadId: string): Promise<void> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { id: threadId },
      });

      if (!session) {
        return;
      }

      // Delete all checkpoints for thread
      session.sessionMetadata = {
        ...(session.sessionMetadata || {}),
        checkpoints: [],
        lastCheckpointId: undefined,
        lastCheckpointAt: undefined,
      } as any;

      await this.sessionRepository.save(session);
    } catch (error) {
      console.error('Error deleting thread checkpoints:', error);
      throw error;
    }
  }

  /**
   * Delete a specific checkpoint (optional implementation)
   */
  async delete(threadId: string, checkpointId?: string): Promise<void> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { id: threadId },
      });

      if (!session || !(session.sessionMetadata as any)?.checkpoints) {
        return;
      }

      if (checkpointId) {
        // Delete specific checkpoint
        const checkpoints = (session.sessionMetadata as any).checkpoints as SerializedCheckpoint[];
        const filtered = checkpoints.filter(c => c.checkpointId !== checkpointId);
        
        session.sessionMetadata = {
          ...(session.sessionMetadata || {}),
          checkpoints: filtered,
        } as any;
      } else {
        // Delete all checkpoints for thread (delegate to deleteThread)
        await this.deleteThread(threadId);
        return;
      }

      await this.sessionRepository.save(session);
    } catch (error) {
      console.error('Error deleting checkpoint:', error);
      throw error;
    }
  }

  /**
   * Get the latest checkpoint for a thread
   */
  async getLatestCheckpoint(threadId: string): Promise<CheckpointTuple | undefined> {
    return this.getTuple({
      configurable: { thread_id: threadId },
    });
  }

  /**
   * Utility: Clean up old checkpoints across all sessions
   * Call this periodically to prevent checkpoint accumulation
   */
  async cleanupOldCheckpoints(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    try {
      const cutoffDate = new Date(Date.now() - maxAge);
      let cleaned = 0;

      // Find all sessions with checkpoints
      const sessions = await this.sessionRepository
        .createQueryBuilder('session')
        .where("session.sessionMetadata->>'checkpoints' IS NOT NULL")
        .getMany();

      for (const session of sessions) {
        const checkpoints = (session.sessionMetadata as any).checkpoints as SerializedCheckpoint[];
        
        if (!checkpoints || checkpoints.length === 0) {
          continue;
        }

        // Keep checkpoints newer than cutoff date
        const kept = checkpoints.filter(c => new Date(c.createdAt) > cutoffDate);
        
        // Always keep at least the most recent checkpoint
        if (kept.length === 0 && checkpoints.length > 0) {
          kept.push(checkpoints[checkpoints.length - 1]);
        }

        if (kept.length < checkpoints.length) {
          session.sessionMetadata = {
            ...(session.sessionMetadata || {}),
            checkpoints: kept,
          } as any;
          await this.sessionRepository.save(session);
          cleaned += (checkpoints.length - kept.length);
        }
      }

      console.log(`🧹 Cleaned up ${cleaned} old checkpoints`);
      return cleaned;
    } catch (error) {
      console.error('Error cleaning up checkpoints:', error);
      return 0;
    }
  }
}

/**
 * Singleton instance of the checkpointer
 */
let checkpointerInstance: DatabaseCheckpointSaver | null = null;

/**
 * Get or create the checkpoint saver instance
 */
export function getCheckpointer(): DatabaseCheckpointSaver {
  if (!checkpointerInstance) {
    console.log('    🔧 Creating checkpointer instance...');
    checkpointerInstance = new DatabaseCheckpointSaver();
    console.log('    ✅ Checkpointer instance created');
  }
  return checkpointerInstance;
}

/**
 * Reset the checkpointer instance (useful for testing)
 */
export function resetCheckpointer(): void {
  checkpointerInstance = null;
}

