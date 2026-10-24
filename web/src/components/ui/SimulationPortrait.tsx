import clsx from 'clsx';
import type { Simulation } from '@/lib/types';
import { PersonaAvatar } from './PersonaAvatar';

export function SimulationPortrait({ simulation, priority, sizes, className }: {
  simulation: Simulation & { persona_role?: string | null };
  priority?: boolean;
  sizes: string;
  className?: string;
}) {
  const participants = simulation.participants ?? [];
  if (participants.length < 2) {
    return <PersonaAvatar name={simulation.persona_name} slug={simulation.persona_slug}
      avatarUrl={simulation.avatar_url} roleHint={simulation.persona_role}
      variant="wide" priority={priority} sizes={sizes} className={className} />;
  }
  return (
    <div className={clsx("relative after:pointer-events-none after:absolute after:inset-0 after:z-10 after:border-4 after:border-black after:content-[''] grid aspect-[3/2] grid-cols-2 gap-0.5 overflow-hidden border-2 border-black bg-black shadow-retro-2 dark:border-retro-ink-dark dark:shadow-retro-dark-2", className)}>
      {participants.map(participant => (
        <div key={participant.actor_id} className="relative min-h-0 min-w-0">
          <PersonaAvatar name={participant.name} slug={participant.persona_slug}
            roleHint={participant.role} variant="panel" priority={priority} sizes={sizes} />
        </div>
      ))}
    </div>
  );
}
