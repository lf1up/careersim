import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.tsx';
import { apiClient } from '../utils/api.ts';
import { LoadingSpinner } from '../components/ui/LoadingSpinner.tsx';
import { Button } from '../components/ui/Button.tsx';
import { RetroBadge } from '../components/ui/RetroBadge.tsx';
import { TagIcon } from '@heroicons/react/24/outline';
import { SimulationSession, SessionMessage, SessionStatus } from '../types/index.ts';
import { categoryNameToBadgeColor, difficultyToBadgeColor, getDifficultyLabel } from '../utils/badges.ts';
import { getSessionStatusIcon, getSessionStatusLabel, getSessionStatusBadgeColor } from '../utils/sessionStatus.tsx';
import {
  ArrowLeftIcon,
  ClockIcon,
  CalendarIcon,
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  PlayIcon
} from '@heroicons/react/24/outline';

// Status utility functions are now imported from shared utils

// styling handled via RetroBadge

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
  const toTitle = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '');
  const sentimentToColor = (s?: string) => {
    if (!s) return 'default' as const;
    const v = s.toLowerCase();
    if (v === 'positive') return 'green' as const;
    if (v === 'negative') return 'red' as const;
    return 'amber' as const;
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className="max-w-[70%] min-w-0">
        <div className={`text-xs mb-1 ${isUser ? 'text-right' : 'text-left'}`}>
          <div className="font-medium">{displayName}</div>
          {displayTitle && <div className="font-monoRetro">{displayTitle}</div>}
        </div>
        <div className={`px-4 py-2 border-2 border-black shadow-retro-2 break-words max-w-full ${
          isUser ? 'bg-black text-white' : 'bg-white'
        }`}>
          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        {/* AI Response Metadata */}
        {!isUser && message.metadata && (
          <div className="mt-2">
            <div className="p-2 border-2 border-black bg-white shadow-retro-2">
              <div className="flex flex-wrap gap-2">
                {typeof (message as any).metadata?.model === 'string' && (
                  <RetroBadge className="text-[10px]">{(message as any).metadata.model}</RetroBadge>
                )}
                {typeof (message as any).metadata?.tokenCount === 'number' && (
                  <RetroBadge color="default" className="text-[10px]">{(message as any).metadata.tokenCount} tokens</RetroBadge>
                )}
                {typeof (message as any).metadata?.processingTime === 'number' && (
                  <RetroBadge color="default" className="text-[10px]">{(message as any).metadata.processingTime.toFixed(2)}s</RetroBadge>
                )}
                {typeof (message as any).metadata?.confidence === 'number' && (
                  <RetroBadge color="default" className="text-[10px]">Conf {(message as any).metadata.confidence.toFixed(2)}</RetroBadge>
                )}
                {typeof (message as any).metadata?.sentiment === 'string' && (
                  <RetroBadge color={sentimentToColor((message as any).metadata.sentiment)} className="text-[10px]">
                    {toTitle((message as any).metadata.sentiment)}
                  </RetroBadge>
                )}
                {typeof (message as any).metadata?.emotionalTone === 'string' && (
                  <RetroBadge color="default" className="text-[10px]">{toTitle((message as any).metadata.emotionalTone)}</RetroBadge>
                )}
              </div>
              {Array.isArray((message as any).metadata?.keyPhrases) && (message as any).metadata.keyPhrases.length > 0 && (
                <div className="mt-2 text-[11px]">
                  <span className="font-medium">Key Phrases:</span>{' '}
                  <span className="font-monoRetro">
                    {(message as any).metadata.keyPhrases.slice(0, 5).join(', ')}
                    {(message as any).metadata.keyPhrases.length > 5 && ` +${(message as any).metadata.keyPhrases.length - 5} more`}
                  </span>
                </div>
              )}
              {((message as any).metadata?.qualityScores && Object.keys((message as any).metadata.qualityScores).length > 0) && (
                <div className="mt-2 text-[11px]">
                  <span className="font-medium">Quality:</span>{' '}
                  <span className="font-monoRetro">
                    {Object.entries((message as any).metadata.qualityScores)
                      .filter(([_, v]) => typeof v === 'number')
                      .map(([k, v]) => `${k}:${(v as number).toFixed(2)}`)
                      .join(' · ')}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
        <div className={`mt-1 text-[10px] opacity-75 font-monoRetro ${isUser ? 'text-right' : 'text-left'}`}>
          {new Date(message.timestamp).toLocaleTimeString()}
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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" />
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col" style={{ minHeight: 'calc(100vh - 6rem)' }}>
        {/* Back button */}
        <div className="mb-4">
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
        <div className="mb-4 flex-shrink-0">
          
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-retro tracking-wider2 mb-2">
                {session.simulation?.title || 'Session Details'}
              </h1>
              <p className="mb-4 font-monoRetro">
                {session.simulation?.description}
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              <RetroBadge color={getSessionStatusBadgeColor(session.status)} className="text-sm">
                {getSessionStatusIcon(session.status, 'h-5 w-5')}
                <span className="ml-2 whitespace-nowrap">{getSessionStatusLabel(session.status)}</span>
              </RetroBadge>
              
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
        <div className="lg:col-span-1 flex flex-col min-h-0 overflow-y-auto overflow-x-visible pr-4">
          <div className="retro-card p-6">
            <h2 className="text-lg font-semibold mb-4">Session Overview</h2>
            
            <div className="space-y-4">
              <div className="flex items-center text-sm">
                <CalendarIcon className="h-4 w-4 mr-3" />
                <div>
                  <div className="font-medium">Started</div>
                  <div className="">{formatDate(session.startedAt)}</div>
                </div>
              </div>
              
              {session.completedAt && (
                <div className="flex items-center text-sm">
                  <CheckCircleIcon className="h-4 w-4 mr-3" />
                  <div>
                    <div className="font-medium">Completed</div>
                    <div className="">{formatDate(session.completedAt)}</div>
                  </div>
                </div>
              )}
              
              <div className="flex items-center text-sm">
                <ClockIcon className="h-4 w-4 mr-3" />
                <div>
                  <div className="font-medium">Duration</div>
                  <div className="">{formatDuration(session.totalDuration || 0)}</div>
                </div>
              </div>
              
              <div className="flex items-center text-sm">
                <ChatBubbleLeftIcon className="h-4 w-4 mr-3" />
                <div>
                  <div className="font-medium">Messages</div>
                  <div className="">{session.messageCount || 0}</div>
                </div>
              </div>

              {session.userGoals && (
                <div className="pt-4 border-t-2 border-black">
                  <div className="font-medium text-sm mb-2">Your Goals</div>
                  <p className="text-sm">{session.userGoals}</p>
                </div>
              )}
            </div>
            
            {/* Progress Bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-2">
                <span>Progress</span>
                <span>{session.currentStep || 0}/{session.totalSteps || 0} steps</span>
              </div>
              <div className="w-full border-2 border-black h-3 shadow-retro-2">
                <div
                  className="bg-primary-500 h-[10px] transition-all duration-300"
                  style={{ 
                    width: `${(session.totalSteps || 0) > 0 ? ((session.currentStep || 0) / (session.totalSteps || 0)) * 100 : 0}%` 
                  }}
                />
              </div>
            </div>
          </div>
          
          {/* Simulation Info */}
          {session.simulation && (
            <div className="retro-card p-6 mt-6">
              <h3 className="text-lg font-semibold mb-4">Simulation Info</h3>
              
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium mb-2">Category</div>
                  {session.simulation.category ? (
                    <RetroBadge color={categoryNameToBadgeColor(session.simulation.category.name)} className="text-xs">
                      <TagIcon className="h-3 w-3 mr-1" />
                      {session.simulation.category.name}
                    </RetroBadge>
                  ) : (
                    <RetroBadge color={categoryNameToBadgeColor('General')} className="text-xs">
                      <TagIcon className="h-3 w-3 mr-1" />
                      General
                    </RetroBadge>
                  )}
                </div>
                
                <div>
                  <div className="text-sm font-medium mb-2">Difficulty</div>
                  <RetroBadge color={difficultyToBadgeColor(session.simulation.difficulty)} className="text-xs">
                    {getDifficultyLabel(session.simulation.difficulty)}
                  </RetroBadge>
                </div>
                
                <div>
                  <div className="text-sm font-medium">Estimated Duration</div>
                  <div className="text-sm">{session.simulation.estimatedDurationMinutes} minutes</div>
                </div>
                
                <div className="pt-3 border-t-2 border-black">
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
          <div className="retro-card flex flex-col flex-1 min-h-0">
            <div className="p-6 border-b-2 border-black">
              <h2 className="text-lg font-semibold">Session Messages</h2>
              <p className="text-sm font-monoRetro mt-1">
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
                  <ChatBubbleLeftIcon className="mx-auto h-12 w-12" />
                  <h3 className="mt-2 text-sm font-medium">No messages yet</h3>
                  <p className="mt-1 text-sm">
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