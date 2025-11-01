import { ConversationGraphState } from '../state';
import * as crypto from 'crypto';

// Lazy imports to avoid TypeORM initialization during module load
let AppDataSource: any;
let SimulationSession: any;
let SessionMessage: any;
let MessageType: any;

/**
 * Lazy-load database dependencies
 */
function loadDatabaseDependencies() {
  if (!AppDataSource) {
    AppDataSource = require('@/config/database').AppDataSource;
    SimulationSession = require('@/entities/SimulationSession').SimulationSession;
    SessionMessage = require('@/entities/SessionMessage').SessionMessage;
    MessageType = require('@/entities/SessionMessage').MessageType;
  }
}

/**
 * Node: Persist and Emit
 * Saves the AI message to database and emits via Socket.IO
 */
export async function persistAndEmitNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  const startTime = Date.now();
  console.log(`💾 [${state.sessionId}] Persist node started`);

  // Check if there's a message to persist
  const hasMessage = state.lastAiMessage && state.lastAiMessage.trim().length > 0;
  console.log(`   📝 Has message to persist: ${hasMessage}`);
  
  if (!hasMessage) {
    console.log(`⚠️ No AI message to persist, but updating session metadata`);
    
    // Even without a message, we should update metadata like inactivityNudgeCount
    try {
      loadDatabaseDependencies();
      const sessionRepo = AppDataSource.getRepository(SimulationSession);
      const session = await sessionRepo.findOne({
        where: { id: state.sessionId },
      });

      if (session && state.metadata?.inactivityNudgeCount !== undefined) {
        session.inactivityNudgeCount = state.metadata.inactivityNudgeCount;
        await sessionRepo.save(session);
        console.log(`📊 Updated session inactivityNudgeCount to ${session.inactivityNudgeCount} (no message)`);
      }
    } catch (error) {
      console.error('Error updating session metadata:', error);
    }
    
    return {};
  }

  try {
    // Load database dependencies
    loadDatabaseDependencies();
    
    const sessionRepo = AppDataSource.getRepository(SimulationSession);
    const messageRepo = AppDataSource.getRepository(SessionMessage);

    // Load session
    const session = await sessionRepo.findOne({
      where: { id: state.sessionId },
    });

    if (!session) {
      throw new Error(`Session ${state.sessionId} not found`);
    }

    // Get next sequence number
    const lastMessage = await messageRepo
      .createQueryBuilder('message')
      .where('message.sessionId = :sessionId', { sessionId: state.sessionId })
      .orderBy('message.sequenceNumber', 'DESC')
      .getOne();

    const sequenceNumber = (lastMessage?.sequenceNumber || 0) + 1;

    // Create AI message
    const aiMessage = new SessionMessage();
    aiMessage.session = session as any;
    aiMessage.sequenceNumber = sequenceNumber;
    aiMessage.type = MessageType.AI;
    aiMessage.content = state.lastAiMessage;
    aiMessage.timestamp = new Date();
    aiMessage.metadata = {
      emotionAnalysis: state.lastEmotionAnalysis,
      sentimentAnalysis: state.lastSentimentAnalysis,
      qualityScores: state.lastQualityScores,
      proactiveTrigger: state.proactiveTrigger,
      processingTime: state.metadata.processingTime,
    };

    await messageRepo.save(aiMessage);

    // Update session
    session.addMessage();
    session.lastAiMessageAt = new Date();
    session.turn = state.turn || 'user';
    
    // Update goal progress if changed
    if (state.goalProgress && state.goalProgress.length > 0) {
      session.goalProgress = state.goalProgress as any;
    }
    
    // Update inactivity nudge count if present in metadata
    // This should only happen when we're actually sending a proactive inactivity message
    if (state.metadata?.inactivityNudgeCount !== undefined) {
      session.inactivityNudgeCount = state.metadata.inactivityNudgeCount;
      console.log(`📊 Updated session inactivityNudgeCount to ${session.inactivityNudgeCount}`);
    }
    
    // IMPORTANT: Only clear the inactivity schedule if this is NOT an inactivity trigger
    // Inactivity triggers will reschedule in the scheduleInactivityNode
    if (state.proactiveTrigger !== 'inactivity') {
      // Update inactivity nudge schedule if present in metadata (including clearing it)
      if (state.metadata?.inactivityNudgeAt !== undefined) {
        session.inactivityNudgeAt = state.metadata.inactivityNudgeAt;
        if (state.metadata.inactivityNudgeAt === null) {
          console.log(`🔄 Cleared inactivity nudge schedule (user active)`);
        }
      }
    } else {
      console.log(`   ⏭️  Skipping inactivity schedule update (will be set by schedule node)`);
    }

    await sessionRepo.save(session);

    // Emit via Socket.IO (skip in test/non-server contexts)
    try {
      // Check if we're in a server context (not a test script)
      if (process.env.NODE_ENV !== 'test' && !process.argv.some(arg => arg.includes('test-'))) {
        const { io } = await import('@/server');
        
        if (io) {
          io.to(`session-${state.sessionId}`).emit('message-received', {
            sessionId: state.sessionId,
            message: {
              id: aiMessage.id,
              sessionId: state.sessionId,
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
              isFromUser: false,
            },
            timestamp: new Date(),
          });

          console.log(`📡 Message emitted via Socket.IO`);
        }
      } else {
        console.log(`🧪 Skipping Socket.IO emit (test mode)`);
      }
    } catch (emitError) {
      console.warn('Failed to emit via Socket.IO (non-fatal):', (emitError as Error).message);
      // Don't fail the whole flow if emit fails
    }

    const persistDuration = Date.now() - startTime;
    console.log(`✅ [${state.sessionId}] Message persisted with sequence ${sequenceNumber} in ${persistDuration}ms`);

    return {
      metadata: {
        ...state.metadata,
        messageCount: (state.metadata.messageCount || 0) + 1,
      },
    };
  } catch (error) {
    console.error('Error persisting message:', error);
    return {
      lastError: error instanceof Error ? error.message : 'Failed to persist message',
    };
  }
}

/**
 * Node: Schedule Inactivity
 * Schedules the next inactivity nudge based on persona configuration
 */
export async function scheduleInactivityNode(
  state: ConversationGraphState,
): Promise<Partial<ConversationGraphState>> {
  console.log(`⏰ Scheduling inactivity check for session ${state.sessionId}`);

  try {
    // Load database dependencies
    loadDatabaseDependencies();
    
    const sessionRepo = AppDataSource.getRepository(SimulationSession);
    const session = await sessionRepo.findOne({
      where: { id: state.sessionId },
    });

    if (!session) {
      throw new Error(`Session ${state.sessionId} not found`);
    }

    // Get persona config for inactivity nudge timing and limits
    const cs: any = state.persona.conversationStyle || {};
    const maxNudges = Number(cs.inactivityNudgeMaxCount ?? 2);
    const currentCount = session.inactivityNudgeCount || 0;
    
    console.log(`📊 Inactivity nudge status: ${currentCount}/${maxNudges} nudges sent`);
    
    // Check if we've already hit the max count
    if (currentCount >= maxNudges) {
      console.log(`🛑 Max inactivity nudges (${currentCount}/${maxNudges}) reached, NOT scheduling next nudge`);
      // Clear any existing schedule
      session.inactivityNudgeAt = null as any;
      await sessionRepo.save(session);
      
      return {
        metadata: {
          ...state.metadata,
          inactivityNudgeAt: null,
        },
      };
    }
    
    const delayCfg = cs.inactivityNudgeDelaySec || {};
    const minSec = Math.max(30, Number(delayCfg.min ?? 60)); // Enforce 30s minimum
    const maxSec = Math.max(minSec, Number(delayCfg.max ?? 180));
    const minMs = minSec * 1000;
    const maxMs = maxSec * 1000;
    
    // Random delay within range
    const delay = crypto.randomInt(minMs, maxMs + 1);
    const nudgeAt = new Date(Date.now() + delay);

    // Update session
    session.inactivityNudgeAt = nudgeAt;
    
    await sessionRepo.save(session);

    console.log(`✅ Inactivity nudge #${currentCount + 1}/${maxNudges} scheduled for ${nudgeAt.toISOString()} (in ${Math.floor(delay / 1000)}s)`);

    return {
      metadata: {
        ...state.metadata,
        inactivityNudgeAt: nudgeAt,
      },
    };
  } catch (error) {
    console.error('Error scheduling inactivity:', error);
    return {
      lastError: error instanceof Error ? error.message : 'Failed to schedule inactivity',
    };
  }
}

