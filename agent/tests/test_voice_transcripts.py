"""Caption publishers: LiveKit data-channel frames and the no-op fallback."""

from __future__ import annotations

import json
import logging

from careersim_agent.voice.transcripts import (
    Caption,
    LiveKitCaptionPublisher,
    NullCaptionPublisher,
)


class _Participant:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.published: list[tuple[bytes, str, bool]] = []

    async def publish_data(self, payload: bytes, *, topic: str, reliable: bool) -> None:
        if self.fail:
            raise RuntimeError("room closed")
        self.published.append((payload, topic, reliable))


class _Room:
    def __init__(self, *, fail: bool = False) -> None:
        self.local_participant = _Participant(fail=fail)


async def test_livekit_publisher_sends_caption_and_control() -> None:
    room = _Room()
    publisher = LiveKitCaptionPublisher(room)
    caption = Caption(role="user", text="hello", is_final=True, confidence=0.9)

    await publisher.publish(caption)
    await publisher.publish_control({"type": "quota", "remaining_sec": 30})

    caption_payload, caption_topic, caption_reliable = room.local_participant.published[0]
    assert caption_topic == "voice-captions"
    assert caption_reliable is True
    assert json.loads(caption_payload) == {
        "role": "user",
        "text": "hello",
        "is_final": True,
        "confidence": 0.9,
    }

    control_payload, control_topic, control_reliable = room.local_participant.published[1]
    assert control_topic == "voice-control"
    assert control_reliable is True
    assert json.loads(control_payload) == {"type": "quota", "remaining_sec": 30}


async def test_livekit_publisher_swallows_send_failures(caplog) -> None:
    publisher = LiveKitCaptionPublisher(_Room(fail=True))
    with caplog.at_level(logging.ERROR):
        await publisher.publish(Caption(role="ai", text="dropped"))
        await publisher.publish_control({"type": "cutoff"})
    assert "failed to publish caption" in caplog.text
    assert "failed to publish control event" in caplog.text


async def test_null_publisher_logs_shape_not_text(caplog) -> None:
    publisher = NullCaptionPublisher()
    secret = "my private answer"
    with caplog.at_level(logging.DEBUG):
        await publisher.publish(Caption(role="user", text=secret, is_final=False))
        await publisher.publish_control({"type": "quota"})
        await publisher.aclose()
    assert secret not in caplog.text
    assert "role=user chars=17 final=False" in caplog.text
    assert "control(null):" in caplog.text
