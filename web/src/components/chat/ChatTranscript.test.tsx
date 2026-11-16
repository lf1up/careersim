import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  afterEach(() => vi.useRealTimers());

  it('shows the saved time on every human, AI follow-up, and voice message', () => {
    const messages = [
      msg('human', 'Hello'),
      msg('ai', 'Hi there'),
      msg('ai', 'A follow-up'),
      { ...msg('human', 'Spoken question'), source: 'voice' as const },
      { ...msg('ai', 'Spoken reply'), source: 'voice' as const },
    ];
    const { container } = render(<ChatTranscript messages={messages} persona={{ name: 'Alex' }} />);
    const times = container.querySelectorAll('time');
    expect(times).toHaveLength(messages.length);
    messages.forEach((message, index) => {
      expect(times[index]).toHaveAttribute('datetime', message.created_at);
      expect(times[index].textContent).toMatch(/\d.*\d/);
      expect(times[index]).toHaveAttribute('title', new Date(message.created_at).toLocaleString());
    });
  });

  it('keeps pending message times stable when the transcript rerenders', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:24:00Z'));
    const props = {
      messages: [],
      keptBurst: ['Interrupted reply'],
      pendingHumans: ['New question'],
      burstedAssistant: ['First reply'],
      pendingAssistant: 'Next reply',
    };
    const { container, rerender } = render(<ChatTranscript {...props} />);
    expect(container.querySelectorAll('time')).toHaveLength(4);
    for (const time of container.querySelectorAll('time')) {
      expect(time).toHaveAttribute('datetime', '2026-11-16T10:24:00.000Z');
    }
    vi.setSystemTime(new Date('2026-11-16T10:26:00Z'));
    rerender(<ChatTranscript {...props} isWaiting />);
    for (const time of container.querySelectorAll('time')) {
      expect(time).toHaveAttribute('datetime', '2026-11-16T10:24:00.000Z');
    }
  });

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

it('offers actions for persisted messages with their original stable IDs', () => {
  const message = msg('human', 'try again');
  const { rerender } = render(<ChatTranscript messages={[message]} renderMessageActions={(m) => <button>Retry {m.id}</button>} />);
  expect(screen.getByRole('button', { name: `Retry ${message.id}` })).toBeInTheDocument();
  rerender(<ChatTranscript messages={[message]} />);
  expect(screen.queryByRole('button')).toBeNull();
});
it('keeps historical names after the current cast is renamed', () => {
 render(<ChatTranscript messages={[{...msg('ai','old reply'),actor_id:'lead',actor_name:'Original Alex'}]} participants={[{actor_id:'lead',name:'New Alex',persona_slug:'alex',role:'Lead'}]}/>);
 expect(screen.getByRole('group',{name:'Original Alex message'})).toBeInTheDocument();
});
