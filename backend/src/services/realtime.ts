import { SimulationSession } from '@/entities/SimulationSession';
import { AppDataSource } from '@/config/database';
import { SessionMessage, MessageType } from '@/entities/SessionMessage';
import { Simulation } from '@/entities/Simulation';
import { Persona } from '@/entities/Persona';
import * as crypto from 'crypto';
import { compositeSimilarity } from '@/utils/textSimilarity';

/**
 * Emit a Socket.IO event with the latest goal progress for a session.
 * Throws if the underlying emit fails (e.g., io not available).
 */
export async function emitGoalProgressUpdate(session: SimulationSession): Promise<void> {
  const { io } = await import('@/server');
  const sessionId = session.id;

  const currentStep = Array.isArray(session.goalProgress)
    ? session.goalProgress.filter((g: any) => g.status === 'achieved').length
    : 0;
  const totalSteps = session.simulation?.conversationGoals?.length || 0;

  io.to(`session-${sessionId}`).emit('goal-progress-updated', {
    sessionId,
    goalProgress: session.goalProgress,
    currentStep,
    totalSteps,
    status: session.status,
    updatedAt: new Date(),
  });
}

/**
 * Lightweight in-memory scheduler to send inactivity nudges.
 * Runs only in a single process (sufficient for dev or single-instance).
 */
let inactivityIntervalStarted = false;

export function startInactivityScheduler(): void {
  if (inactivityIntervalStarted) return;
  inactivityIntervalStarted = true;

  setInterval(async () => {
    try {
      // Find sessions that are in progress and due for a nudge
      const repo = AppDataSource.getRepository(SimulationSession);
      const sessions = await repo.createQueryBuilder('session')
        .leftJoinAndSelect('session.simulation', 'simulation')
        .leftJoinAndSelect('simulation.personas', 'personas')
        .where('session.status IN (:...statuses)', { statuses: ['started', 'in_progress'] })
        .andWhere('session.inactivityNudgeAt IS NOT NULL')
        .andWhere('session.inactivityNudgeAt <= :now', { now: new Date() })
        .getMany();

      for (const s of sessions) {
        // Only nudge if it's user's turn
        if (s.turn !== 'user' || !s.simulation?.personas?.length) {
          continue;
        }
        const persona = (s.simulation.personas as unknown as Persona[])[0];

        try {
          // Persona-configured limits
          const cs: any = persona?.conversationStyle || {};
          const maxNudges = Math.max(0, Number(cs?.inactivityNudgeMaxCount ?? 2));

          // Limit number of inactivity nudges per session
          if ((s.inactivityNudgeCount || 0) >= maxNudges) {
            // Disable further nudges by clearing the schedule
            s.inactivityNudgeAt = null as any;
            await repo.save(s);
            continue;
          }

          const { AIService } = await import('@/services/ai');
          const aiService = new AIService();
          const messageRepo = AppDataSource.getRepository(SessionMessage);
          const history = await messageRepo.createQueryBuilder('message')
            .where('message.sessionId = :sid', { sid: s.id })
            .orderBy('message.sequenceNumber', 'ASC')
            .getMany();

          // Check if LangGraph is enabled
          const { config } = await import('@/config/env');
          if (config.langgraph.useLangGraph) {
            console.log('🔵 Using LangGraph for inactivity nudge');
            
            // Use LangGraph for inactivity nudge with timeout protection
            try {
              const { invokeConversationGraph } = await import('@/services/langgraph');
              
              // Create a timeout promise to prevent hanging
              const timeoutMs = 30000; // 30 second timeout
              const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('LangGraph invocation timeout')), timeoutMs);
              });
              
              // Race between the graph invocation and timeout
              await Promise.race([
                invokeConversationGraph({
                  sessionId: s.id,
                  userId: (s.user as any)?.id || '',
                  proactiveTrigger: 'inactivity',
                }),
                timeoutPromise,
              ]);
              
              // Graph handles all persistence, scheduling, and emission
              console.log(`✅ LangGraph inactivity nudge sent for session ${s.id}`);
              continue;
            } catch (graphErr) {
              console.warn('⚠️ LangGraph inactivity nudge failed:', graphErr instanceof Error ? graphErr.message : graphErr);
              console.warn('⚠️ Falling back to legacy nudge system for this session');
              // Fall through to legacy system
            }
          }

          // OLD PATH: Use AIService
          const context = {
            persona,
            simulation: s.simulation as unknown as Simulation,
            conversationHistory: history,
            sessionDuration: s.startedAt ? (Date.now() - s.startedAt.getTime()) : 0,
          } as const;

          const lastUser = history.filter(m => m.type === MessageType.USER).slice(-1)[0]?.content;
          const previousAi = history.filter(m => m.type === MessageType.AI).slice(-1)[0]?.content;
          
          // Get recent AI messages to check for repetition against multiple messages
          const recentAiMessages = history
            .filter(m => m.type === MessageType.AI)
            .slice(-3)
            .map(m => m.content);

          // Generate inactivity nudge with duplicate prevention
          const similarityThreshold = 0.82;
          let nudge = await aiService.generateProactivePersonaMessage(context, { reason: 'inactivity', lastUserMessage: lastUser, previousAiMessage: previousAi });
          
          // Check similarity against multiple recent AI messages
          let isTooSimilar = recentAiMessages.some(
            recentMsg => compositeSimilarity(recentMsg, nudge.message) >= similarityThreshold,
          );
          
          if (isTooSimilar && previousAi) {
            const strongerPrev = `${previousAi}\n[CRITICAL: Your last few messages were too similar. Provide a COMPLETELY DIFFERENT angle, new detail, or concrete next step. Use different vocabulary and sentence structure.]`;
            nudge = await aiService.generateProactivePersonaMessage(context, { reason: 'inactivity', lastUserMessage: lastUser, previousAiMessage: strongerPrev });
          }
          
          // Check again against recent messages
          isTooSimilar = recentAiMessages.some(
            recentMsg => compositeSimilarity(recentMsg, nudge.message) >= similarityThreshold,
          );
          
          if (isTooSimilar) {
            // Still too similar; reschedule without sending to avoid spammy duplicates
            console.log(`⚠️ Skipping inactivity nudge for session ${s.id} due to high similarity with recent messages`);
            const delayCfg = cs?.inactivityNudgeDelaySec || {};
            const minSec = Math.max(5, Number(delayCfg?.min ?? 60));
            const maxSec = Math.max(minSec, Number(delayCfg?.max ?? 180));
            const minMs = minSec * 1000;
            const maxMs = maxSec * 1000;
            const delay = crypto.randomInt(minMs, maxMs + 1);
            s.inactivityNudgeAt = new Date(Date.now() + delay);
            await repo.save(s);
            continue;
          }

          const seq = (history[history.length - 1]?.sequenceNumber || 0) + 1;
          const aiMessage = new SessionMessage();
          aiMessage.session = s as any;
          aiMessage.sequenceNumber = seq;
          aiMessage.type = MessageType.AI;
          aiMessage.content = nudge.message;
          aiMessage.timestamp = new Date();
          aiMessage.metadata = {
            confidence: nudge.confidence,
            processingTime: nudge.processingTime,
            emotionalTone: nudge.emotionalTone,
            sentiment: nudge.metadata.sentiment,
          };
          await messageRepo.save(aiMessage);

          s.addMessage();
          s.lastAiMessageAt = new Date();
          // After a nudge, schedule next delay from persona config (unified {min,max} with fallbacks)
          const delayCfg = cs?.inactivityNudgeDelaySec || {};
          const minSec = Math.max(5, Number(delayCfg?.min ?? 60));
          const maxSec = Math.max(minSec, Number(delayCfg?.max ?? 180));
          const minMs = minSec * 1000;
          const maxMs = maxSec * 1000;
          const delay = crypto.randomInt(minMs, maxMs + 1);
          s.inactivityNudgeAt = new Date(Date.now() + delay);
          s.inactivityNudgeCount = (s.inactivityNudgeCount || 0) + 1;
          await repo.save(s);

          const { io } = await import('@/server');
          io.to(`session-${s.id}`).emit('message-received', {
            sessionId: s.id,
            message: {
              id: aiMessage.id,
              sessionId: s.id,
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
        } catch (err) {
          console.warn('⚠️ Failed to send inactivity nudge:', err);
        }
      }
    } catch (outerErr) {
      console.warn('⚠️ Inactivity scheduler iteration failed:', outerErr);
    }
  }, 10_000); // check every 10s
}
