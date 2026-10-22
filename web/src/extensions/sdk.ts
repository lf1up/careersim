/**
 * Stable imports for plugin UI. Plugin pages should import host pieces from
 * here rather than from `@/components/...` paths that can move.
 *
 * This module pulls in client components. Import it from client pages.
 */
export {
  apiBaseUrl,
  apiClient,
  apiRequest,
  ApiError,
  isRateLimitError,
  rateLimitRetryAfterSeconds,
} from '@/lib/api';
export { readSse } from '@/lib/sse';
export type { GoalProgress, Message } from '@/lib/types';
export { useAuth } from '@/contexts/AuthContext';
export { RequireAuth } from '@/components/auth/RequireAuth';

export { Button } from '@/components/ui/Button';
export { FormErrorAlert } from '@/components/ui/FormErrorAlert';
export { LoadingSpinner } from '@/components/ui/LoadingSpinner';
export { RetroAlert, RetroBadge } from '@/components/ui/RetroBadge';
export { RetroCard } from '@/components/ui/RetroCard';
export { RetroDialog, RetroTabs } from '@/components/ui/RetroDialog';
export {
  RetroCheckbox,
  RetroInput,
  RetroSelect,
  RetroTextArea,
  RetroToggle,
} from '@/components/ui/RetroInput';
export { RetroPanel } from '@/components/ui/RetroPanel';
export { RetroPagination, RetroTable } from '@/components/ui/RetroTable';

export { ChatComposer } from '@/components/chat/ChatComposer';
export { ChatTranscript } from '@/components/chat/ChatTranscript';
export type { ChatPersona } from '@/components/chat/ChatTranscript';
export {
  GoalProgressChips,
  GoalProgressSummary,
  GoalProgressTracker,
} from '@/components/chat/GoalProgressTracker';
export { TypingIndicator } from '@/components/chat/TypingIndicator';
