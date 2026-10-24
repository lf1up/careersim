import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Message } from '@/lib/types';

import { ChatTranscript } from './ChatTranscript';

let seq = 0;
function msg(role: 'human' | 'ai', content: string): Message {
  seq += 1;
  return {
    id: `m${seq}`,
    role,
    content,
    order_index: seq,
    source: 'text',
    typing_delay_ms: null,
    created_at: new Date(seq * 1000).toISOString(),
  };
}

describe('ChatTranscript', () => {
  it('renders kept interrupt bubbles before the new pending human (chronological)', () => {
    const { container } = render(
      <ChatTranscript
        messages={[msg('ai', 'opener')]}
        keptBurst={['partial reply one']}
        pendingHumans={['follow-up question']}
        isWaiting
      />,
    );

    const text = container.textContent ?? '';
    const keptIdx = text.indexOf('partial reply one');
    const humanIdx = text.indexOf('follow-up question');
    expect(keptIdx).toBeGreaterThan(-1);
    expect(humanIdx).toBeGreaterThan(-1);
    // The persona's partial reply precedes the interrupting human message.
    expect(keptIdx).toBeLessThan(humanIdx);
  });

  it('shows the typing indicator while waiting with no in-flight bubble', () => {
    render(
      <ChatTranscript
        messages={[msg('human', 'hi')]}
        isWaiting
        persona={{ name: 'Brenda', role: 'HR Manager' }}
      />,
    );
    expect(
      screen.queryAllByLabelText(/assistant is typing/i).length,
    ).toBeGreaterThan(0);
  });

  it('keeps the typing indicator below the in-flight bubble while the turn continues', () => {
    // Follow-ups are generated as separate agent-side LLM calls between
    // message events — the dots must stay armed under the latest bubble
    // for the whole gap, not only after the next event arrives.
    render(
      <ChatTranscript
        messages={[msg('human', 'hi')]}
        pendingAssistant="streaming reply"
        isWaiting
        persona={{ name: 'Brenda', role: 'HR Manager' }}
      />,
    );
    expect(
      screen.queryAllByLabelText(/assistant is typing/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('streaming reply')).toBeInTheDocument();
  });

  it('hides the typing indicator once the turn is done', () => {
    render(
      <ChatTranscript
        messages={[msg('human', 'hi'), msg('ai', 'final reply')]}
        persona={{ name: 'Brenda', role: 'HR Manager' }}
      />,
    );
    expect(screen.queryAllByLabelText(/assistant is typing/i)).toHaveLength(0);
  });

  it('shows the typing indicator instantly after an interrupt (kept bubbles do not block it)', () => {
    // The interrupted turn's bubbles were moved to keptBurst and the stale
    // streaming bubble cleared — the indicator must come back immediately.
    render(
      <ChatTranscript
        messages={[msg('ai', 'opener')]}
        keptBurst={['partial reply one']}
        pendingHumans={['interrupt!']}
        isWaiting
        persona={{ name: 'Brenda', role: 'HR Manager' }}
      />,
    );
    expect(
      screen.queryAllByLabelText(/assistant is typing/i).length,
    ).toBeGreaterThan(0);
  });

  it('is not empty when only keptBurst has content', () => {
    const { container } = render(<ChatTranscript messages={[]} keptBurst={['kept']} />);
    expect(screen.queryByText(/No messages yet/i)).not.toBeInTheDocument();
    expect(screen.getByText('kept')).toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it('renders the active burst after pending humans', () => {
    const { container } = render(
      <ChatTranscript
        messages={[msg('ai', 'opener')]}
        pendingHumans={['my message']}
        burstedAssistant={['burst one']}
        pendingAssistant="burst two"
      />,
    );
    const text = container.textContent ?? '';
    const humanIdx = text.indexOf('my message');
    const burstOneIdx = text.indexOf('burst one');
    const burstTwoIdx = text.indexOf('burst two');
    expect(humanIdx).toBeGreaterThan(-1);
    expect(humanIdx).toBeLessThan(burstOneIdx);
    expect(burstOneIdx).toBeLessThan(burstTwoIdx);
  });
});

describe('multi-character speakers', () => {
  it('labels consecutive actors separately, including kept and streaming replies', () => {
    render(<ChatTranscript
      messages={[{ ...msg('ai', 'First'), actor_id: 'lead', actor_name: 'Alex' }]}
      keptBurst={[{ content: 'Second', actor_id: 'hr', actor_name: 'Brenda' }]}
      pendingAssistant={{ content: 'Third', actor_id: 'lead', actor_name: 'Alex' }}
      participants={[
        { actor_id: 'lead', name: 'Alex', persona_slug: 'alex', role: 'Lead' },
        { actor_id: 'hr', name: 'Brenda', persona_slug: 'brenda', role: 'HR' },
      ]}
    />);
    expect(screen.getAllByRole('group', { name: 'Alex message' })).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Brenda message' })).toBeInTheDocument();
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText('Third')).toBeInTheDocument();
  });
});
