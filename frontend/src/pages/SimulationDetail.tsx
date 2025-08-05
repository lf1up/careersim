import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { Button } from '../components/ui/Button.tsx';
import { useSocket } from '../contexts/SocketContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { 
  Simulation, 
  SimulationSession, 
  SessionMessage, 
  SessionStatus,
  SimulationDifficulty 
} from '../types/index.ts';
import {
  ClockIcon,
  TagIcon,
  PlayIcon,
  PaperAirplaneIcon,
  UserIcon,
  ComputerDesktopIcon,
  ArrowLeftIcon
} from '@heroicons/react/24/outline';

const getDifficultyColor = (difficulty: SimulationDifficulty): string => {
  switch (difficulty) {
    case SimulationDifficulty.BEGINNER:
      return 'bg-green-100 text-green-800';
    case SimulationDifficulty.INTERMEDIATE:
      return 'bg-yellow-100 text-yellow-800';
    case SimulationDifficulty.ADVANCED:
      return 'bg-orange-100 text-orange-800';
    case SimulationDifficulty.EXPERT:
      return 'bg-red-100 text-red-800';
    case SimulationDifficulty.MASTER:
      return 'bg-purple-100 text-purple-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const getDifficultyLabel = (difficulty: SimulationDifficulty): string => {
  switch (difficulty) {
    case SimulationDifficulty.BEGINNER:
      return 'Beginner';
    case SimulationDifficulty.INTERMEDIATE:
      return 'Intermediate';
    case SimulationDifficulty.ADVANCED:
      return 'Advanced';
    case SimulationDifficulty.EXPERT:
      return 'Expert';
    case SimulationDifficulty.MASTER:
      return 'Master';
    default:
      return 'Unknown';
  }
};

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
  const [error, setError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');

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
    };

    socket.on('message-received', handleMessageReceived);

    return () => {
      socket.off('message-received', handleMessageReceived);
    };
  }, [socket, session?.id]); // Only depend on session.id, not the entire session object

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
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
                <h1 className="text-3xl font-bold text-secondary-900 mb-2">
                  {simulation.title}
                </h1>
                <p className="text-lg text-secondary-600 mb-4">
                  {simulation.description}
                </p>
              </div>
            </div>

            {/* Tags and metadata */}
            <div className="flex items-center gap-3 mb-6">
              {simulation.category && (
                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-primary-100 text-primary-800">
                  <TagIcon className="h-4 w-4 mr-1" />
                  {simulation.category.name}
                </span>
              )}
              
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getDifficultyColor(simulation.difficulty)}`}>
                {getDifficultyLabel(simulation.difficulty)}
              </span>

              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-secondary-100 text-secondary-800">
                <ClockIcon className="h-4 w-4 mr-1" />
                {simulation.estimatedDurationMinutes} min
              </span>
            </div>

            {/* Scenario */}
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-secondary-900 mb-3">Scenario</h2>
              <p className="text-secondary-700 leading-relaxed">
                {simulation.scenario}
              </p>
            </div>

            {/* Objectives */}
            {simulation.objectives && simulation.objectives.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold text-secondary-900 mb-3">Learning Objectives</h2>
                <ul className="list-disc list-inside space-y-2">
                  {simulation.objectives.map((objective, index) => (
                    <li key={index} className="text-secondary-700">
                      {objective}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Personas */}
            {simulation.personas && simulation.personas.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold text-secondary-900 mb-3">You'll interact with</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {simulation.personas.map((persona) => (
                    <div key={persona.id} className="flex items-center p-4 bg-secondary-50 rounded-lg">
                      {persona.avatarUrl ? (
                        <img
                          src={persona.avatarUrl}
                          alt={persona.name}
                          className="h-12 w-12 rounded-full mr-3"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-secondary-300 flex items-center justify-center mr-3">
                          <UserIcon className="h-6 w-6 text-secondary-600" />
                        </div>
                      )}
                      <div>
                        <h3 className="font-medium text-secondary-900">{persona.name}</h3>
                        <p className="text-sm text-secondary-600">{persona.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600">{error}</p>
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col min-h-0" style={{ height: 'calc(100vh - 8rem)' }}>
        {/* Session header */}
        <div className="bg-white rounded-lg shadow-sm border border-secondary-200 mb-4 p-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-secondary-900">{simulation.title}</h1>
              <p className="text-sm text-secondary-600">Session in progress</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleEndSession}
              >
                End Session
              </Button>
            </div>
          </div>
        </div>

        {/* Chat interface */}
        <div className="bg-white rounded-lg shadow-sm border border-secondary-200 flex-1 flex flex-col min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {session.messages && session.messages.length > 0 ? (
              session.messages.map((message, index) => {
                const persona = simulation.personas && simulation.personas.length > 0 ? simulation.personas[0] : null;
                const userName = user ? `${user.firstName} ${user.lastName}` : 'User';
                
                return (
                  <div
                    key={message.id || index}
                    className={`flex ${message.isFromUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[70%] rounded-lg px-4 py-2 ${
                        message.isFromUser
                          ? 'bg-primary-600 text-white'
                          : 'bg-secondary-100 text-secondary-900'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!message.isFromUser && (
                          <ComputerDesktopIcon className="h-4 w-4 mt-1 flex-shrink-0" />
                        )}
                        <div className="flex-1">
                          {/* Name header */}
                          <div className={`text-xs font-medium mb-1 ${
                            message.isFromUser ? 'text-primary-100' : 'text-secondary-600'
                          }`}>
                            {message.isFromUser ? (
                              userName
                            ) : (
                              <span>
                                {persona?.name || 'AI Assistant'}
                                {persona?.role && (
                                  <span className="ml-1 font-normal">
                                    • {persona.role}
                                  </span>
                                )}
                              </span>
                            )}
                          </div>
                          <p className="whitespace-pre-wrap">{message.content}</p>
                          <p className={`text-xs mt-1 ${
                            message.isFromUser ? 'text-primary-200' : 'text-secondary-500'
                          }`}>
                            {new Date(message.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                        {message.isFromUser && (
                          <UserIcon className="h-4 w-4 mt-1 flex-shrink-0" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center text-secondary-500 py-8">
                <p>Start the conversation! Send your first message below.</p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Message input */}
          <div className="border-t border-secondary-200 p-4">
            <form onSubmit={handleSendMessage} className="flex gap-2">
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                placeholder="Type your message..."
                className="flex-1 px-3 py-2 border border-secondary-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
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

        {/* Error message */}
        {error && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex-shrink-0">
            <p className="text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};