import { SimulationSession } from '@/entities/SimulationSession';

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


