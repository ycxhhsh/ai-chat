"""逻辑谬误检测服务测试。"""
from __future__ import annotations

import json

import pytest

from app.services import fallacy_detector


AI_CLASSROOM_CLAIM = (
    "我觉得只要课堂用了AI，学生成绩就一定会提高。传统讲授效率低，"
    "所以学校应该尽快让AI代替老师的大部分教学工作。"
)


class FakeLLMClient:
    def __init__(self, responses: list[str]):
        self._responses = responses
        self.calls: list[list[dict]] = []

    async def stream_chat(self, *, messages, model=None, temperature=0.7):
        self.calls.append(messages)
        response = self._responses.pop(0)
        for chunk in response:
            yield chunk


@pytest.mark.asyncio
async def test_detect_fallacy_parses_strict_json(monkeypatch):
    """主模型返回严格 JSON 时应解析为 dict。"""
    payload = {
        "quote": "只要课堂用了AI，学生成绩就一定会提高",
        "fallacy_type": "绝对化因果 / 以偏概全 / 方案跳跃",
        "reason": "把使用AI直接推成成绩必然提高，且没有限定适用条件。",
        "suggestion": "先补充证据，并说明哪些课堂和学生群体适用。",
        "confidence": "high",
    }
    client = FakeLLMClient([json.dumps(payload, ensure_ascii=False)])

    monkeypatch.setattr(
        "app.llm.factory.get_llm_client",
        lambda _provider: client,
    )

    result = await fallacy_detector.detect_fallacy(AI_CLASSROOM_CLAIM)

    assert result == payload
    assert "绝对化因果" in client.calls[0][0]["content"]
    assert client.calls[0][1]["content"] == AI_CLASSROOM_CLAIM


@pytest.mark.asyncio
async def test_detect_fallacy_pass_returns_none(monkeypatch):
    """主模型返回 PASS 时表示未发现明显谬误。"""
    client = FakeLLMClient(["PASS"])

    monkeypatch.setattr(
        "app.llm.factory.get_llm_client",
        lambda _provider: client,
    )

    assert await fallacy_detector.detect_fallacy(
        "我认为AI可以作为课堂辅助工具，但还需要看具体课程和学生情况。"
    ) is None


class FakeManager:
    def __init__(self):
        self.broadcasts: list[tuple[str, str, dict]] = []

    async def broadcast(self, session_id, event, data):
        self.broadcasts.append((session_id, event, data))


class FakeDbSession:
    def __init__(self):
        self.added = []
        self.committed = False

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def add(self, item):
        self.added.append(item)

    async def commit(self):
        self.committed = True


@pytest.mark.asyncio
async def test_trigger_fallacy_intervention_broadcasts_flagged_message(
    monkeypatch,
):
    """快筛和主检出都命中时，应广播带谬误干预标记的 AI 消息。"""
    manager = FakeManager()
    db = FakeDbSession()
    client = FakeLLMClient(["你这个判断很有方向，但它把结果说得太确定了。你能先说明AI在哪些课堂、哪些学生身上最可能有效吗？"])

    async def fake_fast_screen(content, llm_provider="deepseek"):
        assert content == AI_CLASSROOM_CLAIM
        return True

    async def fake_detect_fallacy(content, llm_provider="deepseek"):
        assert content == AI_CLASSROOM_CLAIM
        return {
            "quote": "只要课堂用了AI，学生成绩就一定会提高",
            "fallacy_type": "绝对化因果 / 以偏概全 / 方案跳跃",
            "reason": "把未经验证的假设当成必然结果。",
            "suggestion": "先补充证据并限定适用范围。",
            "confidence": "high",
        }

    monkeypatch.setattr(fallacy_detector, "_fast_screen", fake_fast_screen)
    monkeypatch.setattr(fallacy_detector, "detect_fallacy", fake_detect_fallacy)
    monkeypatch.setattr(
        "app.llm.factory.get_llm_client",
        lambda _provider: client,
    )
    monkeypatch.setattr(
        "app.db.session.AsyncSessionLocal",
        lambda: db,
    )

    await fallacy_detector.trigger_fallacy_intervention(
        "session-1",
        {"user_id": "student-1"},
        AI_CLASSROOM_CLAIM,
        manager,
    )

    assert len(manager.broadcasts) == 1
    session_id, event, data = manager.broadcasts[0]
    assert session_id == "session-1"
    assert event == "CHAT_MESSAGE"
    assert data["metadata_info"]["is_fallacy_intervention"] is True
    assert data["metadata_info"]["intervention_type"] == "fallacy"
    assert data["metadata_info"]["intervention_label"] == "主动逻辑纠偏"
    assert data["metadata_info"]["llm_provider"] == "deepseek"
    assert "AI" in data["content"]
    intervention_prompt = client.calls[0][0]["content"]
    assert "直接指出关键问题" in intervention_prompt
    assert "不直接指出错误" not in intervention_prompt
    assert db.committed is True


def test_fast_screen_prompt_covers_ai_classroom_strong_claims():
    """快筛提示词应覆盖截图中的强因果和替代教师场景。"""
    prompt = fallacy_detector.FAST_SCREEN_PROMPT

    assert "绝对化因果" in prompt
    assert "方案跳跃" in prompt
    assert "只要" in prompt
    assert "一定" in prompt
    assert "尽快替代" in prompt


@pytest.mark.asyncio
async def test_fast_screen_allows_short_strong_claim(monkeypatch):
    """短句强断言也应进入快筛模型，而不是被长度门槛直接跳过。"""
    client = FakeLLMClient(["TRUE"])

    monkeypatch.setattr(
        "app.llm.factory.get_llm_client",
        lambda _provider: client,
    )

    assert await fallacy_detector._fast_screen("用AI就一定能提分") is True
