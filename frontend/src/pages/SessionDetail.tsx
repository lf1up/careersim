import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { Button } from '../components/ui/Button.tsx';
import { SimulationSession, SessionMessage, SessionStatus, SimulationDifficulty } from '../types/index.ts';
import { getSessionStatusIcon, getSessionStatusColor, getSessionStatusLabel } from '../utils/sessionStatus.tsx';
import {
  ArrowLeftIcon,
  ClockIcon,
  CalendarIcon,
  ChatBubbleLeftIcon,
  UserIcon,
  ComputerDesktopIcon,
  CheckCircleIcon,
  PlayIcon,
  TagIcon
} from '@heroicons/react/24/outline';

// Status utility functions are now imported from shared utils

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

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

interface MessageBubbleProps {
  message: SessionMessage;
  isUser: boolean;
  userName?: string;
  userTitle?: string;
  personaName?: string;
  personaRole?: string;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ 
  message, 
  isUser, 
  userName, 
  userTitle, 
  personaName, 
  personaRole 
}) => {
  const displayName = isUser ? userName : personaName;
  const displayTitle = isUser ? userTitle : personaRole;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`flex max-w-[70%] ${isUser ? 'flex-row-reverse' : 'flex-row'} items-start gap-3`}>
        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? 'bg-primary-100' : 'bg-secondary-100'
        }`}>
          {isUser ? (
            <UserIcon className="h-4 w-4 text-primary-600" />
          ) : (
            <ComputerDesktopIcon className="h-4 w-4 text-secondary-600" />
          )}
        </div>
        <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
          <div className={`text-xs text-secondary-600 mb-1 ${isUser ? 'text-right' : 'text-left'}`}>
            <div className="font-medium">{displayName}</div>
            {displayTitle && <div className="text-secondary-500">{displayTitle}</div>}
          </div>
          <div className={`px-4 py-2 rounded-lg ${
            isUser 
              ? 'bg-primary-600 text-white' 
              : 'bg-secondary-100 text-secondary-900'
          }`}>
            <p className="text-sm">{message.content}</p>
            {message.metadata && Object.keys(message.metadata).length > 0 && (
              <div className="mt-1 text-xs opacity-75">
                {JSON.stringify(message.metadata)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const SessionDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [session, setSession] = useState<SimulationSession | null>(null);
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSession = async () => {
      if (!id) return;
      
      try {
        setIsLoading(true);
        setError(null);
        
        const sessionData = await apiClient.getSession(id);
        setSession(sessionData);

        // If session has messages, fetch them
        if (sessionData.messageCount > 0) {
          setIsLoadingMessages(true);
          try {
            const messagesData = await apiClient.getSessionMessages(
              sessionData.simulation.id, 
              id,
              { page: 1, limit: 100 }
            );
            setMessages(messagesData.messages || []);
          } catch (msgError) {
            console.error('Failed to fetch messages:', msgError);
          } finally {
            setIsLoadingMessages(false);
          }
        }
      } catch (error) {
        console.error('Failed to fetch session:', error);
        setError('Failed to load session details. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchSession();
  }, [id]);

  const handleBackToSessions = () => {
    navigate('/sessions');
  };

  const handleContinueSession = () => {
    if (session) {
      navigate(`/simulations/${session.simulation.id}/session/${session.id}`);
    }
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

  if (error || !session) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center py-8">
          <p className="text-red-600 mb-4">{error || 'Session not found'}</p>
          <Button onClick={handleBackToSessions}>
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            Back to Sessions
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 8rem)' }}>
        {/* Back button */}
        <div className="mb-6">
          <Button
            variant="secondary"
            onClick={handleBackToSessions}
            className="inline-flex items-center"
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back to Sessions
          </Button>
        </div>

        {/* Header */}
        <div className="mb-6 flex-shrink-0">
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-secondary-900 mb-2">
                {session.simulation?.title || 'Session Details'}
              </h1>
              <p className="text-secondary-600 mb-4">
                {session.simulation?.description}
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getSessionStatusColor(session.status)}`}>
                {getSessionStatusIcon(session.status, 'h-5 w-5')}
                <span className="ml-2">{getSessionStatusLabel(session.status)}</span>
              </span>
              
              {(session.status === SessionStatus.ACTIVE || 
                session.status === SessionStatus.PAUSED ||
                (session.status as string) === 'started' ||
                (session.status as string) === 'in_progress') && (
                <Button onClick={handleContinueSession}>
                  <PlayIcon className="h-4 w-4 mr-1" />
                  Continue Session
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Session Overview */}
        <div className="lg:col-span-1 flex flex-col min-h-0 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-sm border border-secondary-200 p-6">
            <h2 className="text-lg font-semibold text-secondary-900 mb-4">Session Overview</h2>
            
            <div className="space-y-4">
              <div className="flex items-center text-sm">
                <CalendarIcon className="h-4 w-4 mr-3 text-secondary-400" />
                <div>
                  <div className="font-medium">Started</div>
                  <div className="text-secondary-600">{formatDate(session.startedAt)}</div>
                </div>
              </div>
              
              {session.completedAt && (
                <div className="flex items-center text-sm">
                  <CheckCircleIcon className="h-4 w-4 mr-3 text-secondary-400" />
                  <div>
                    <div className="font-medium">Completed</div>
                    <div className="text-secondary-600">{formatDate(session.completedAt)}</div>
                  </div>
                </div>
              )}
              
              <div className="flex items-center text-sm">
                <ClockIcon className="h-4 w-4 mr-3 text-secondary-400" />
                <div>
                  <div className="font-medium">Duration</div>
                  <div className="text-secondary-600">{formatDuration(session.totalDuration || 0)}</div>
                </div>
              </div>
              
              <div className="flex items-center text-sm">
                <ChatBubbleLeftIcon className="h-4 w-4 mr-3 text-secondary-400" />
                <div>
                  <div className="font-medium">Messages</div>
                  <div className="text-secondary-600">{session.messageCount || 0}</div>
                </div>
              </div>

              {session.userGoals && (
                <div className="pt-4 border-t border-secondary-200">
                  <div className="font-medium text-sm mb-2">Your Goals</div>
                  <p className="text-sm text-secondary-600">{session.userGoals}</p>
                </div>
              )}
            </div>
            
            {/* Progress Bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm text-secondary-600 mb-2">
                <span>Progress</span>
                <span>{session.currentStep || 0}/{session.totalSteps || 0} steps</span>
              </div>
              <div className="w-full bg-secondary-200 rounded-full h-2">
                <div 
                  className="bg-primary-600 h-2 rounded-full transition-all duration-300" 
                  style={{ 
                    width: `${(session.totalSteps || 0) > 0 ? ((session.currentStep || 0) / (session.totalSteps || 0)) * 100 : 0}%` 
                  }}
                />
              </div>
            </div>
          </div>
          
          {/* Simulation Info */}
          {session.simulation && (
            <div className="bg-white rounded-lg shadow-sm border border-secondary-200 p-6 mt-6">
              <h3 className="text-lg font-semibold text-secondary-900 mb-4">Simulation Info</h3>
              
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-secondary-900 mb-2">Category</div>
                  {session.simulation.category ? (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                      <TagIcon className="h-3 w-3 mr-1" />
                      {session.simulation.category.name}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      <TagIcon className="h-3 w-3 mr-1" />
                      General
                    </span>
                  )}
                </div>
                
                <div>
                  <div className="text-sm font-medium text-secondary-900 mb-2">Difficulty</div>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getDifficultyColor(session.simulation.difficulty)}`}>
                    {getDifficultyLabel(session.simulation.difficulty)}
                  </span>
                </div>
                
                <div>
                  <div className="text-sm font-medium text-secondary-900">Estimated Duration</div>
                  <div className="text-sm text-secondary-600">{session.simulation.estimatedDurationMinutes} minutes</div>
                </div>
                
                <div className="pt-3 border-t border-secondary-200">
                  <Link to={`/simulations/${session.simulation.id}`}>
                    <Button variant="outline" size="sm" className="w-full">
                      View Simulation Details
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="lg:col-span-2 flex flex-col min-h-0">
          <div className="bg-white rounded-lg shadow-sm border border-secondary-200 flex flex-col flex-1 min-h-0">
            <div className="p-6 border-b border-secondary-200">
              <h2 className="text-lg font-semibold text-secondary-900">Session Messages</h2>
              <p className="text-sm text-secondary-600 mt-1">
                Conversation history from this session
              </p>
            </div>
            
            <div className="p-6 flex-1 flex flex-col min-h-0">
              {isLoadingMessages ? (
                <div className="flex justify-center py-8">
                  <LoadingSpinner size="md" />
                </div>
              ) : messages.length > 0 ? (
                <div className="space-y-4 flex-1 overflow-y-auto">
                  {messages.map((message) => {
                    const isUser = message.type === 'user';
                    // Get persona information from the simulation
                    const persona = session?.simulation?.personas?.[0];
                    
                    return (
                      <MessageBubble
                        key={message.id}
                        message={message}
                        isUser={isUser}
                        userName={user ? `${user.firstName} ${user.lastName}` : 'You'}
                        userTitle={user?.jobTitle}
                        personaName={persona?.name || 'Assistant'}
                        personaRole={persona?.role || 'AI Assistant'}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <ChatBubbleLeftIcon className="mx-auto h-12 w-12 text-secondary-400" />
                  <h3 className="mt-2 text-sm font-medium text-secondary-900">No messages yet</h3>
                  <p className="mt-1 text-sm text-secondary-500">
                    This session hasn't started or has no recorded messages.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};