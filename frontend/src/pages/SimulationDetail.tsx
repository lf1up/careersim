import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { Button } from '../components/ui/Button.tsx';
import { RetroBadge, RetroAlert } from '../components/ui/RetroBadge.tsx';
import { MarkdownMessage } from '../components/ui/MarkdownMessage.tsx';
import { useSocket } from '../contexts/SocketContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { 
  Simulation, 
  SimulationSession, 
  SessionMessage, 
  SessionStatus,
    ConversationGoal
} from '../types/index.ts';
import { categoryNameToBadgeColor, difficultyToBadgeColor, getDifficultyLabel } from '../utils/badges.ts';
import {
  ClockIcon,
  TagIcon,
  PlayIcon,
  PaperAirplaneIcon,
  UserIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline';

// styling handled via RetroBadge

export const SimulationDetail: React.FC = () => {
  const { id, sessionId } = useParams<{ id: string; sessionId?: string }>();
  const navigate = useNavigate();
  const { socket } = useSocket();
  const { user } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isAwaitingAIResponse, setIsAwaitingAIResponse] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [goalTooltip, setGoalTooltip] = useState<{
    visible: boolean;
    goal?: ConversationGoal;
    top: number;
    left: number;
  }>({ visible: false, top: 0, left: 0 });
  const goalTooltipRef = useRef<HTMLDivElement | null>(null);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [session?.messages]);

  // Fetch simulation details
  useEffect(() => {
    const fetchSimulation = async () => {
      if (!id) return;
      
      try {
        setIsLoading(true);
        setError(null);
        const simulationData = await apiClient.getSimulation(id);
        setSimulation(simulationData);
      } catch (error) {
        console.error('Failed to fetch simulation:', error);
        setError('Failed to load simulation. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSimulation();
  }, [id]);

  // Load existing session if sessionId is provided
  useEffect(() => {
    const loadExistingSession = async () => {
      if (!sessionId || !id) return;
      
      try {
        setError(null);
        const sessionData = await apiClient.getSession(sessionId);
        
        // Always ensure messages is an array
        const sessionWithMessages = {
          ...sessionData,
          messages: sessionData.messages || []
        };
        setSession(sessionWithMessages);

        // Load session messages if they exist
        if (sessionData.messageCount > 0) {
          try {
            const messagesData = await apiClient.getSessionMessages(id, sessionId, { page: 1, limit: 100 });
            setSession(_prevSession => ({
              ...sessionWithMessages,
              messages: messagesData.messages || []
            }));
          } catch (msgError) {
            console.error('Failed to fetch session messages:', msgError);
          }
        }
      } catch (error) {
        console.error('Failed to load session:', error);
        setError('Failed to load session. Please try again.');
      }
    };

    loadExistingSession();
  }, [sessionId, id]);

  // Socket.IO event handlers
  useEffect(() => {
    if (!socket || !session?.id) return;

    // Join session room
    socket.emit('join-session', session.id);

    // Listen for incoming messages
    const handleMessageReceived = (data: { message: SessionMessage }) => {
      setSession(prev => {
        if (!prev) return prev;
        // Check if message already exists to prevent duplicates
        const messageExists = prev.messages.some(msg => msg.id === data.message.id);
        if (messageExists) {
          return prev;
        }
        return {
          ...prev,
          messages: [...(prev.messages || []), data.message]
        };
      });

      // If AI responded, stop typing indicator
      if (data.message.type === 'ai') {
        setIsAwaitingAIResponse(false);
      }
    };

    // Listen for goal progress updates from backend
    const handleGoalProgressUpdated = (data: { sessionId: string; goalProgress?: any; currentStep?: number; totalSteps?: number; status?: string }) => {
      if (!session?.id || data.sessionId !== session.id) return;
      setSession(prev => prev ? {
        ...prev,
        goalProgress: data.goalProgress ?? prev.goalProgress,
        currentStep: typeof data.currentStep === 'number' ? data.currentStep : prev.currentStep,
        totalSteps: typeof data.totalSteps === 'number' ? data.totalSteps : prev.totalSteps,
        status: (data.status as any) ?? prev.status,
      } : prev);
    };

    socket.on('message-received', handleMessageReceived);
    socket.on('goal-progress-updated', handleGoalProgressUpdated);

    return () => {
      socket.off('message-received', handleMessageReceived);
      socket.off('goal-progress-updated', handleGoalProgressUpdated);
    };
  }, [socket, session?.id]); // Only depend on session.id, not the entire session object

  // Tooltip helpers for goals
  const showGoalTooltip = (goal: ConversationGoal, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const left = Math.round(rect.right + 12);
    const top = Math.round(rect.top);
    setGoalTooltip({ visible: true, goal, top, left });
  };
  const hideGoalTooltip = () => setGoalTooltip(prev => ({ ...prev, visible: false }));

  // After tooltip mounts, clamp within viewport bottom and top
  useEffect(() => {
    if (!goalTooltip.visible || !goalTooltipRef.current) return;
    const tooltipEl = goalTooltipRef.current;
    const padding = 12;
    const tooltipHeight = tooltipEl.offsetHeight;
    const maxTop = window.innerHeight - tooltipHeight - padding;
    let clampedTop = goalTooltip.top;
    if (clampedTop > maxTop) clampedTop = Math.max(padding, maxTop);
    if (clampedTop < padding) clampedTop = padding;
    if (clampedTop !== goalTooltip.top) {
      setGoalTooltip(prev => ({ ...prev, top: clampedTop }));
    }
  }, [goalTooltip.visible, goalTooltip.top]);

  const handleStartSession = async () => {
    if (!simulation) return;

    try {
      setIsStartingSession(true);
      setError(null);
      const newSession = await apiClient.startSession(simulation.id);
      // Ensure messages is always an array
      setSession({
        ...newSession,
        messages: newSession.messages || []
      });
      // Navigate to the session URL
      navigate(`/simulations/${simulation.id}/session/${newSession.id}`);
    } catch (error) {
      console.error('Failed to start session:', error);
      setError('Failed to start simulation session. Please try again.');
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !simulation || !messageInput.trim() || isSendingMessage) return;

    const content = messageInput.trim();
    setMessageInput('');

    try {
      setIsSendingMessage(true);
      setIsAwaitingAIResponse(true);
      
      // Add user message immediately to UI with temporary ID
      const tempId = `temp-${Date.now()}`;
      const userMessage: SessionMessage = {
        id: tempId,
        content,
        type: 'user',
        isFromUser: true,
        timestamp: new Date().toISOString(),
      };

      setSession(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: [...(prev.messages || []), userMessage]
        };
      });

      // Send message to backend and get the actual message
      const actualMessage = await apiClient.sendMessage(session.id, content, simulation.id);
      
      // Replace the temporary message with the actual message from server
      setSession(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.map(msg => 
            msg.id === tempId ? actualMessage : msg
          )
        };
      });
      
      // Note: No need to emit socket message here as the backend API endpoint 
      // already handles socket emission for both user and AI messages
    } catch (error) {
      console.error('Failed to send message:', error);
      setError('Failed to send message. Please try again.');
      setIsAwaitingAIResponse(false);
      
      // Remove the optimistic message on error
      setSession(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          messages: prev.messages.filter(msg => !msg.id.startsWith('temp-'))
        };
      });
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleEndSession = async () => {
    if (!session) return;

    try {
      await apiClient.updateSessionStatus(session.id, SessionStatus.COMPLETED);
      navigate('/sessions');
    } catch (error) {
      console.error('Failed to end session:', error);
      setError('Failed to end session. Please try again.');
    }
  };

  const handleBackToSimulations = () => {
    navigate('/simulations');
  };

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  if (error && !simulation) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-8">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={() => window.location.reload()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!simulation) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-8">
          <p className="text-secondary-600 mb-4">Simulation not found</p>
          <Button onClick={handleBackToSimulations}>
            Back to Simulations
          </Button>
        </div>
      </div>
    );
  }

  // If no active session, show simulation details with start button
  if (!session) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Back button */}
        <div className="mb-6">
          <Button
            variant="secondary"
            onClick={handleBackToSimulations}
            className="inline-flex items-center"
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back to Simulations
          </Button>
        </div>

        {/* Simulation details */}
        <div className="retro-card overflow-hidden">
          {simulation.thumbnailUrl && (
            <div className="h-48 bg-secondary-200">
              <img
                src={simulation.thumbnailUrl}
                alt={simulation.title}
                className="w-full h-full object-cover"
              />
            </div>
          )}
          
          <div className="p-8">
            <div className="flex items-start justify-between mb-6">
              <div className="flex-1">
                <h1 className="text-3xl font-retro tracking-wider2 mb-2">
                  {simulation.title}
                </h1>
                <p className="text-lg mb-4">
                  {simulation.description}
                </p>
              </div>
            </div>

            {/* Tags and metadata */}
            <div className="flex items-center gap-3 mb-6">
              {simulation.category && (
                <RetroBadge color={categoryNameToBadgeColor(simulation.category.name)} className="text-sm">
                  <TagIcon className="h-4 w-4 mr-1" />
                  {simulation.category.name}
                </RetroBadge>
              )}
              
              <RetroBadge color={difficultyToBadgeColor(simulation.difficulty)} className="text-sm">
                {getDifficultyLabel(simulation.difficulty)}
              </RetroBadge>

              <RetroBadge className="text-sm">
                <ClockIcon className="h-4 w-4 mr-1" />
                {simulation.estimatedDurationMinutes} min
              </RetroBadge>
            </div>

            {/* Scenario */}
            <div className="mb-6">
              <h2 className="text-xl font-semibold mb-3">Scenario</h2>
              <p className="leading-relaxed">
                {simulation.scenario}
              </p>
            </div>

            {/* Objectives */}
            {simulation.objectives && simulation.objectives.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-3">Learning Objectives</h2>
                <ul className="list-disc list-inside space-y-2">
                  {simulation.objectives.map((objective, index) => (
                    <li key={index} className="">
                      {objective}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Personas */}
            {simulation.personas && simulation.personas.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-3">You'll interact with</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {simulation.personas.map((persona) => (
                    <div key={persona.id} className="flex items-center p-4 border-2 border-black shadow-retro-2">
                      {persona.avatarUrl ? (
                        <img
                          src={persona.avatarUrl}
                          alt={persona.name}
                          className="h-12 w-12 rounded-full mr-3"
                        />
                      ) : (
                        <div className="h-12 w-12 border-2 border-black flex items-center justify-center mr-3">
                          <UserIcon className="h-6 w-6" />
                        </div>
                      )}
                      <div>
                        <h3 className="font-semibold">{persona.name}</h3>
                        <p className="text-sm">{persona.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="mb-6">
                <RetroAlert tone="error" title="Error">{error}</RetroAlert>
              </div>
            )}

            {/* Start button */}
            <div className="text-center">
              <Button
                onClick={handleStartSession}
                disabled={isStartingSession}
                className="inline-flex items-center px-8 py-3 text-lg"
              >
                {isStartingSession ? (
                  <>
                    <LoadingSpinner size="sm" className="mr-2" />
                    Starting...
                  </>
                ) : (
                  <>
                    <PlayIcon className="h-5 w-5 mr-2" />
                    Start Simulation
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active session - show chat interface
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col min-h-0" style={{ height: 'calc(100vh - 8rem)' }}>
        {/* Session header */}
        <div className="retro-card mb-4 p-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold dark:text-retro-ink-dark">{simulation.title}</h1>
              <p className="text-sm font-monoRetro text-secondary-600 dark:text-secondary-400">Session in progress</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={handleEndSession}
              >
                End Session
              </Button>
            </div>
          </div>
        </div>

        {/* Chat interface with goals sidebar */}
        <div className="retro-card flex-1 flex flex-row min-h-0">
          {/* Left goals sidebar */}
          <div className="relative w-64 border-r-2 border-black dark:border-retro-ink-dark p-4 overflow-y-auto hidden md:block">
            <h3 className="text-sm font-semibold mb-3 dark:text-retro-ink-dark">Conversation Goals</h3>
            {simulation.conversationGoals && simulation.conversationGoals.length > 0 ? (
              <ul className="space-y-2">
                {simulation.conversationGoals
                  .slice()
                  .sort((a, b) => a.goalNumber - b.goalNumber)
                  .map((goal) => {
                    const progress = session.goalProgress?.find(g => g.goalNumber === goal.goalNumber);
                    const status = progress?.status || 'not_started';
                    const isAchieved = status === 'achieved';
                    const isInProgress = status === 'in_progress';

                    return (
                      <li
                        key={goal.goalNumber}
                        className={`relative border-2 px-3 py-2 shadow-retro-2 dark:shadow-retro-dark-2 ${isAchieved ? 'bg-green-100 border-green-500 dark:bg-green-900 dark:border-green-400' : isInProgress ? 'bg-yellow-100 border-yellow-500 dark:bg-yellow-900 dark:border-yellow-400' : 'bg-white border-black dark:bg-retro-surface-dark dark:border-retro-ink-dark'}`}
                        onMouseEnter={(e) => showGoalTooltip(goal, e.currentTarget as unknown as HTMLElement)}
                        onMouseLeave={hideGoalTooltip}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold dark:text-retro-ink-dark">{goal.title}</span>
                          {goal.isOptional && (
                            <span className="ml-2 text-[10px] uppercase tracking-wider2 dark:text-neutral-400">Optional</span>
                          )}
                        </div>
                        <div className="mt-1">
                          <span className={`text-xs ${isAchieved ? 'text-green-700 dark:text-green-400' : isInProgress ? 'text-yellow-700 dark:text-yellow-400' : 'dark:text-neutral-400'}`}>{isAchieved ? 'Achieved' : isInProgress ? 'In progress' : 'Not started'}</span>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <p className="text-sm text-secondary-500 dark:text-secondary-400">No goals defined.</p>
            )}
          </div>

          {/* Right chat column */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {session.messages && session.messages.length > 0 ? (
              session.messages.map((message, index) => {
                const persona = simulation.personas && simulation.personas.length > 0 ? simulation.personas[0] : null;
                const userName = user ? `${user.firstName} ${user.lastName}` : 'You';
                const userTitle = user?.jobTitle;
                const personaName = persona?.name || 'Assistant';
                const personaRole = persona?.role || 'AI Assistant';

                return (
                  <div key={message.id || index} className={`flex ${message.isFromUser ? 'justify-end' : 'justify-start'} mb-4`}>
                    <div className="max-w-[70%] min-w-0">
                      <div className={`text-xs mb-1 ${message.isFromUser ? 'text-right' : 'text-left'} dark:text-retro-ink-dark`}>
                        <div className="font-medium">{message.isFromUser ? userName : personaName}</div>
                        {(message.isFromUser ? userTitle : personaRole) && (
                          <div className="font-monoRetro text-secondary-600 dark:text-secondary-400">{message.isFromUser ? userTitle : personaRole}</div>
                        )}
                      </div>
                      <div className={`px-4 py-2 border-2 border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2 break-words max-w-full ${message.isFromUser ? 'bg-black text-white dark:bg-retro-ink-dark dark:text-retro-paper-dark' : 'bg-white dark:bg-retro-surface-dark dark:text-retro-ink-dark'}`}>
                        <MarkdownMessage content={message.content} />
                      </div>
                      <div className={`mt-1 text-[10px] opacity-75 font-monoRetro ${message.isFromUser ? 'text-right' : 'text-left'} dark:text-retro-ink-dark`}>
                        {new Date(message.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <p className="dark:text-retro-ink-dark">Start the conversation! Send your first message below.</p>
              </div>
            )}
            {/* Typing indicator */}
            {isAwaitingAIResponse && (
              <div className="flex justify-start mb-4">
                <div className="max-w-[70%] min-w-0">
                  <div className="text-xs mb-1 text-left dark:text-retro-ink-dark">
                    <div className="font-medium">{simulation.personas && simulation.personas[0]?.name ? simulation.personas[0].name : 'Assistant'}</div>
                    {simulation.personas && simulation.personas[0]?.role && (
                      <div className="font-monoRetro text-secondary-600 dark:text-secondary-400">{simulation.personas[0].role}</div>
                    )}
                  </div>
                  <div className="px-4 py-2 border-2 border-black dark:border-retro-ink-dark shadow-retro-2 dark:shadow-retro-dark-2 break-words max-w-full bg-white dark:bg-retro-surface-dark">
                    <div className="flex items-center gap-2">
                      <span className="text-sm dark:text-retro-ink-dark">is typing</span>
                      <div className="flex gap-1">
                        <span className="h-2 w-2 bg-secondary-400 inline-block animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="h-2 w-2 bg-secondary-400 inline-block animate-bounce" style={{ animationDelay: '100ms' }}></span>
                        <span className="h-2 w-2 bg-secondary-400 inline-block animate-bounce" style={{ animationDelay: '200ms' }}></span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message input */}
            <div className="border-t-2 border-black dark:border-retro-ink-dark p-4">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  placeholder="Type your message..."
                  className="retro-input flex-1"
                  disabled={isSendingMessage}
                />
                <Button
                  type="submit"
                  disabled={!messageInput.trim() || isSendingMessage}
                  className="px-4 py-2"
                >
                  {isSendingMessage ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    <PaperAirplaneIcon className="h-4 w-4" />
                  )}
                </Button>
              </form>
            </div>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 flex-shrink-0">
            <RetroAlert tone="error" title="Error">{error}</RetroAlert>
          </div>
        )}

        {/* Fixed-position tooltip overlay for goals */}
        {goalTooltip.visible && goalTooltip.goal && (
          <div
            className="fixed z-[2147483647] pointer-events-none"
            style={{ top: goalTooltip.top, left: goalTooltip.left }}
          >
            <div ref={goalTooltipRef} className="w-72 max-w-[18rem] max-h-[70vh] overflow-auto whitespace-normal border-2 border-black dark:border-retro-ink-dark bg-white dark:bg-retro-surface-dark text-xs shadow-retro-4 dark:shadow-retro-dark-4">
              <div className="p-3">
                <div className="font-semibold mb-1 dark:text-retro-ink-dark">{goalTooltip.goal.title}</div>
                {goalTooltip.goal.description && (
                  <p className="leading-snug dark:text-retro-ink-dark">{goalTooltip.goal.description}</p>
                )}
                {(goalTooltip.goal.keyBehaviors && goalTooltip.goal.keyBehaviors.length > 0) && (
                  <div className="mt-2">
                    <div className="font-medium mb-1 dark:text-retro-ink-dark">Key behaviors</div>
                    <ul className="list-disc list-inside space-y-0.5 dark:text-retro-ink-dark">
                      {goalTooltip.goal.keyBehaviors.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(goalTooltip.goal.successIndicators && goalTooltip.goal.successIndicators.length > 0) && (
                  <div className="mt-2">
                    <div className="font-medium mb-1 dark:text-retro-ink-dark">Success indicators</div>
                    <ul className="list-disc list-inside space-y-0.5 dark:text-retro-ink-dark">
                      {goalTooltip.goal.successIndicators.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};