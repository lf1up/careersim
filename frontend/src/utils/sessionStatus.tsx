import React from 'react';
import { SessionStatus } from '../types/index.ts';
import {
  CheckCircleIcon,
  ClockIcon,
  PauseIcon,
  ExclamationTriangleIcon
} from '@heroicons/react/24/outline';

/**
 * Get the appropriate icon for a session status
 * @param status - The session status (enum or string)
 * @param size - Icon size class (default: 'h-4 w-4')
 * @returns React component for the status icon
 */
export const getSessionStatusIcon = (
  status: SessionStatus | string, 
  size: string = 'h-4 w-4'
): React.ReactElement => {
  const iconClass = size;

  switch (status) {
    case SessionStatus.COMPLETED:
    case 'completed':
      return <CheckCircleIcon className={iconClass} />;
      
    case SessionStatus.ACTIVE:
    case 'active':
    case 'started':
    case 'in_progress':
      return <ClockIcon className={iconClass} />;
      
    case SessionStatus.PAUSED:
    case 'paused':
      return <PauseIcon className={iconClass} />;
      
    case 'abandoned':
      return <ExclamationTriangleIcon className={iconClass} />;
      
    default:
      return <ExclamationTriangleIcon className={iconClass} />;
  }
};

/**
 * Get the appropriate color classes for a session status
 * @param status - The session status (enum or string)
 * @returns Tailwind CSS classes for background and text color
 */
export const getSessionStatusColor = (status: SessionStatus | string): string => {
  switch (status) {
    case SessionStatus.COMPLETED:
    case 'completed':
      return 'bg-green-100 text-green-800';
      
    case SessionStatus.ACTIVE:
    case 'active':
    case 'started':
    case 'in_progress':
      return 'bg-blue-100 text-blue-800';
      
    case SessionStatus.PAUSED:
    case 'paused':
      return 'bg-yellow-100 text-yellow-800';
      
    case 'abandoned':
      return 'bg-red-100 text-red-800';
      
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

/**
 * Get the human-readable label for a session status
 * @param status - The session status (enum or string)
 * @returns Human-readable status label
 */
export const getSessionStatusLabel = (status: SessionStatus | string): string => {
  switch (status) {
    case SessionStatus.COMPLETED:
    case 'completed':
      return 'Completed';
      
    case SessionStatus.ACTIVE:
    case 'active':
    case 'started':
    case 'in_progress':
      return 'In Progress';
      
    case SessionStatus.PAUSED:
    case 'paused':
      return 'Paused';
      
    case 'abandoned':
      return 'Abandoned';
      
    default:
      return 'Unknown';
  }
};