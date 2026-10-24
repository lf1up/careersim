"""Multi-character identity, privacy, ordering, and interruption contracts."""
import json
from copy import deepcopy
from unittest.mock import patch
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from careersim_agent.services.conversation_service import ConversationService, serialize_state, deserialize_state
from careersim_agent.graph.state import create_initial_state
from careersim_agent.graph.builder import build_graph

PERSONAS = {
    'alex': {'slug': 'alex', 'name': 'Alex', 'role': 'Lead', 'hiddenMotivation': 'A_SECRET', 'conversationStyle': {}},
    'brenda': {'slug': 'brenda', 'name': 'Brenda', 'role': 'HR', 'hiddenMotivation': 'B_SECRET', 'conversationStyle': {}},
}
SIM = {'slug': 'meeting', 'title': 'Meeting', 'scenario': 'Discuss a release.',
    'participants': [{'actorId': 'lead', 'personaSlug': 'alex', 'privateKnowledge': 'A_PRIVATE'},
                     {'actorId': 'hr', 'personaSlug': 'brenda', 'privateKnowledge': 'B_PRIVATE'}],
    'conversationGoals': [{'goalNumber': 1, 'title': 'Handle disagreement', 'keyBehaviors': ['Clarify concerns']}]}

def scene():
    with patch('careersim_agent.services.data_loader.load_persona', side_effect=lambda slug: deepcopy(PERSONAS[slug])):
        return create_initial_state('scene-test', deepcopy(SIM), deepcopy(PERSONAS['alex']))

def service():
    svc = ConversationService.__new__(ConversationService)
    svc._graph = build_graph().compile()
    return svc

def test_identity_roundtrip_and_stable_legacy_upgrade():
    original = {'session_id': 's1', 'persona': PERSONAS['alex'], 'messages': [
        HumanMessage(content='Hi'), AIMessage(content='Hello', id='event-123', name='hr', additional_kwargs={'actor_name': 'Brenda'})]}
    wire = serialize_state(original)
    assert wire['messages'][1]['event_id'] == 'event-123'
    assert wire['messages'][1]['actor_id'] == 'hr'
    assert wire['messages'][1]['actor_name'] == 'Brenda'
    assert serialize_state(deserialize_state(wire)) == wire
    legacy = {'session_id': 's1', 'persona': PERSONAS['alex'], 'messages': [{'role': 'ai', 'content': 'Hello'}]}
    a = serialize_state(deserialize_state(deepcopy(legacy)))['messages'][0]
    b = serialize_state(deserialize_state(deepcopy(legacy)))['messages'][0]
    assert a['event_id'] == b['event_id']
    assert a['actor_id'] == 'alex'

@pytest.mark.parametrize('participants', [[], [SIM['participants'][0]], [SIM['participants'][0]] * 2,
    [{'actorId': 'user', 'personaSlug': 'alex'}, SIM['participants'][1]],
    ['invalid participant', SIM['participants'][1]],
    [{'actorId': 'lead'}, SIM['participants'][1]],
    [{'actorId': 'lead', 'personaSlug': ''}, SIM['participants'][1]],
    [{**SIM['participants'][0], 'objective': None}, SIM['participants'][1]],
    [{**SIM['participants'][0], 'privateKnowledge': []}, SIM['participants'][1]]])
def test_invalid_cast_rejected(participants):
    with patch('careersim_agent.services.data_loader.load_persona', side_effect=lambda slug: PERSONAS[slug]):
        with pytest.raises(ValueError, match='participant|actor'):
            create_initial_state('s', {**SIM, 'participants': participants}, PERSONAS['alex'])

def test_two_ordered_replies_private_views_and_reload():
    state = scene()
    assert set(state['characters']) == {'lead', 'hr'}
    prompts = []
    def generate(messages):
        prompts.append(messages)
        return AIMessage(content=f'Reply {len(prompts)}')
    with patch('careersim_agent.graph.nodes.scene.ChatOpenAI') as model:
        model.return_value.invoke.side_effect = generate
        with patch('careersim_agent.graph.nodes.scene.evaluate_goals', return_value={'needs_evaluation': False}):
            events = list(service().stream_turn(state, 'What are the concerns?'))
    assert [e.actor_id for e in events if not e.is_final] == ['lead', 'hr']
    assert all(e.event_id for e in events if not e.is_final)
    first = '\n'.join(str(m.content) for m in prompts[0])
    second = '\n'.join(str(m.content) for m in prompts[1])
    assert 'A_SECRET' in first and 'A_PRIVATE' in first
    assert 'B_SECRET' not in first and 'B_PRIVATE' not in first
    assert 'B_SECRET' in second and 'B_PRIVATE' in second
    assert 'A_SECRET' not in second and 'A_PRIVATE' not in second
    assert 'Reply 1' in second
    assert isinstance(prompts[1][-1], HumanMessage)
    final = events[-1].state
    assert len(final['messages']) == 3
    assert final['scene_evaluation_cursor'] == 3
    assert [m.name for m in deserialize_state(serialize_state(final))['messages']] == ['user', 'lead', 'hr']

def test_interrupt_snapshot_advances_speaker_without_repeating_delivered_reply():
    with patch('careersim_agent.graph.nodes.scene.ChatOpenAI') as model:
        model.return_value.invoke.return_value = AIMessage(content='First reply')
        stream = service().stream_turn(scene(), 'Start')
        first = next(stream)
        saved = json.loads(json.dumps(serialize_state(first.state), sort_keys=True))
        stream.close()
        assert saved['scene_next_actor'] == 1
        with patch('careersim_agent.graph.nodes.scene.evaluate_goals', return_value={'needs_evaluation': False}):
            resumed = list(service().stream_turn(deserialize_state(saved), 'Wait, clarify that'))
    assert [e.actor_id for e in resumed if not e.is_final] == ['hr', 'lead']
    assert len(resumed[-1].state['messages']) == 5
    assert resumed[-1].state['messages'][1].id == first.event_id

def test_stream_merges_ids_instead_of_replacing_branch_histories():
    first = AIMessage(content='one', id='a', name='lead')
    second = AIMessage(content='two', id='b', name='hr')
    class Graph:
        def stream(self, state, **kwargs):
            yield {'any_character_node': {'messages': [first]}}
            yield {'another_node': {'messages': [second]}}
            yield {'duplicate': {'messages': [first]}}
    svc = ConversationService.__new__(ConversationService)
    svc._graph = Graph()
    events = list(svc._stream_graph({'messages': []}))
    assert [e.content for e in events if not e.is_final] == ['one', 'two']
    assert [m.id for m in events[-1].state['messages']] == ['a', 'b']

def test_evaluation_covers_interrupted_range_once_with_event_ids():
    from careersim_agent.graph.nodes.scene import evaluate_scene
    state = scene()
    state['messages'] = [HumanMessage(content='A proposal', id='u1', name='user'),
        AIMessage(content='Concern', id='a1', name='lead'),
        HumanMessage(content='Clarification', id='u2', name='user'),
        AIMessage(content='Another concern', id='b1', name='hr')]
    state['needs_evaluation'] = True
    def evaluate(view):
        assert view['last_user_message'] == 'A proposal\nClarification'
        assert '[a1]' in view['last_ai_message'] and '[b1]' in view['last_ai_message']
        return {'goal_progress': [{'goalNumber': 1, 'evidence': [
            {'role': 'user', 'label': 'clarifies', 'score': 0.8},
            {'role': 'ai', 'label': 'concerns', 'score': 0.7}]}]}
    with patch('careersim_agent.graph.nodes.scene.evaluate_goals', side_effect=evaluate):
        result = evaluate_scene(state)
        evidence = result['goal_progress'][0]['evidence']
        assert evidence[0]['sourceEventIds'] == ['u1', 'u2']
        assert evidence[1]['sourceEventIds'] == ['a1', 'b1']
        state.update(result)
        assert evaluate_scene(state) == {'needs_evaluation': False}

def test_debrief_attributes_each_character():
    from careersim_agent.services.eval_service import _format_transcript_lines
    lines = _format_transcript_lines([
        {'role': 'ai', 'content': 'Ship', 'actor_id': 'lead', 'actor_name': 'Alex'},
        {'role': 'ai', 'content': 'Wait', 'actor_id': 'hr', 'actor_name': 'Brenda'},
    ], 'Alex')
    assert 'BRENDA' in lines[1] and 'ALEX' not in lines[1]

def test_group_scenario_is_playable_and_catalogue_hides_private_config():
    svc = service()
    with patch('careersim_agent.services.conversation_service.get_settings') as settings:
        settings.return_value.rag_enabled = False
        state = svc.init_session('release-planning-panel', 'demo')
    assert len(state['characters']) == 2
    assert state['proactive_trigger'] is None
    public = svc.get_simulation('release-planning-panel')
    assert 'Alex' in public['persona_name'] and 'Brenda' in public['persona_name']
    assert len(public['participants']) == 2
    assert 'privateKnowledge' not in json.dumps(public)

def test_failed_judge_keeps_delivered_history_pending_for_retry():
    from unittest.mock import MagicMock
    from careersim_agent.services.eval_service import EvalService
    evaluator = EvalService.__new__(EvalService)
    evaluator._llm = MagicMock()
    evaluator._llm.invoke.side_effect = TimeoutError('temporary outage')
    with patch('careersim_agent.graph.nodes.scene.ChatOpenAI') as model, patch(
        'careersim_agent.graph.nodes.evaluation.get_eval_service', return_value=evaluator
    ):
        model.return_value.invoke.return_value = AIMessage(content='A reply')
        stream = service().stream_turn(scene(), 'A proposal worth evaluating')
        next(stream)
        second = next(stream)
        assert second.state['scene_evaluation_cursor'] == 0
        final = next(stream)
        assert final.is_final
        assert final.state["scene_evaluation_cursor"] == 0
        assert final.state["needs_evaluation"] is True
        assert final.state["evaluation_complete"] is False
    assert len(second.state['messages']) == 3
    assert second.state['goal_progress'][0]['status'] == 'not_started'

def test_three_character_cast_is_bounded_and_rotates_after_reload():
    sim = deepcopy(SIM)
    sim['participants'].append({'actorId': 'other-lead', 'personaSlug': 'alex', 'privateKnowledge': 'OTHER_SECRET'})
    with patch('careersim_agent.services.data_loader.load_persona', side_effect=lambda slug: deepcopy(PERSONAS[slug])):
        state = create_initial_state('three', sim, PERSONAS['alex'])
    with patch('careersim_agent.graph.nodes.scene.ChatOpenAI') as model, patch(
        'careersim_agent.graph.nodes.scene.evaluate_goals', return_value={'needs_evaluation': False}
    ):
        model.return_value.invoke.return_value = AIMessage(content='Reply')
        first = list(service().stream_turn(state, 'First round'))
        assert [e.actor_id for e in first if not e.is_final] == ['lead', 'hr']
        restored = deserialize_state(json.loads(json.dumps(serialize_state(first[-1].state), sort_keys=True)))
        second = list(service().stream_turn(restored, 'Second round'))
        assert [e.actor_id for e in second if not e.is_final] == ['other-lead', 'lead']
    from careersim_agent.graph.nodes.scene import character_messages
    prompt = character_messages(state, 'lead')[0].content
    assert 'OTHER_SECRET' not in prompt


@pytest.mark.parametrize('configured_provider', [False, True])
def test_character_reply_honors_provider_configuration(configured_provider):
    from types import SimpleNamespace
    from careersim_agent.graph.nodes.scene import generate_scene_reply
    settings = SimpleNamespace(
        openai_model='test-model', openai_temperature=0.3, openai_max_tokens=100,
        openai_api_key='test-key',
        openai_base_url='https://provider.example/v1' if configured_provider else None,
        openai_default_headers={'X-Test': 'scene'} if configured_provider else None,
    )
    state = scene()
    state['scene_replies_remaining'] = 2
    with patch('careersim_agent.graph.nodes.scene.get_settings', return_value=settings), patch(
        'careersim_agent.graph.nodes.scene.ChatOpenAI'
    ) as model:
        model.return_value.invoke.return_value = AIMessage(content='My concern')
        reply = generate_scene_reply(state)
    expected = dict(model='test-model', temperature=0.3, max_tokens=100, api_key='test-key')
    if configured_provider:
        expected.update(base_url=settings.openai_base_url, default_headers=settings.openai_default_headers)
    model.assert_called_once_with(**expected)
    assert reply['messages'][0].content == 'My concern'
    assert reply['messages'][0].name == 'lead'


def test_empty_character_reply_does_not_advance_or_mutate_scene():
    from careersim_agent.graph.nodes.scene import generate_scene_reply
    state = scene()
    state['scene_replies_remaining'] = 2
    before = deepcopy(state)
    with patch('careersim_agent.graph.nodes.scene.ChatOpenAI') as model:
        model.return_value.invoke.return_value = AIMessage(content='  ')
        with pytest.raises(ValueError, match='Empty character response'):
            generate_scene_reply(state)
    assert state == before


@pytest.mark.parametrize('trigger', ['start', 'inactivity', 'followup'])
def test_group_proactive_trigger_does_not_generate_or_advance_scene(trigger):
    state = scene()
    with patch('careersim_agent.graph.nodes.scene.ChatOpenAI') as model:
        events = list(service().stream_proactive(state, trigger))
    model.assert_not_called()
    assert len(events) == 1 and events[0].is_final
    assert events[0].state['messages'] == []
    assert events[0].state['scene_next_actor'] == 0
    assert events[0].state['scene_evaluation_cursor'] == 0


@pytest.mark.parametrize('inputs, expected_route', [
    ({'user_message': 'Hello'}, 'analyze_input'),
    ({'proactive_trigger': 'inactivity'}, 'check_proactive'),
])
def test_single_persona_input_keeps_legacy_routing(inputs, expected_route):
    from careersim_agent.graph.builder import _route_after_input
    from careersim_agent.graph.nodes.conversation import process_user_input
    state = create_initial_state('legacy', {'slug': 'solo', 'conversationGoals': []}, PERSONAS['alex'])
    state.update(inputs)
    state.update(process_user_input(state))
    assert state['characters'] == {}
    assert _route_after_input(state) == expected_route
    assert state['scene_replies_remaining'] == 0
