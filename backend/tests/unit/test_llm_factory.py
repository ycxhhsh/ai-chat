"""LLM 工厂单元测试。"""
import pytest

from app.llm.factory import get_available_providers, get_llm_client
from app.llm.openai_compat import OpenAICompatibleClient


class TestLLMFactory:
    def test_unknown_provider_raises(self):
        with pytest.raises(ValueError, match="Unknown LLM provider"):
            get_llm_client("nonexistent")

    def test_get_available_providers_returns_list(self):
        providers = get_available_providers()
        assert isinstance(providers, list)
        # 至少返回的每个 provider 都有必要字段
        for p in providers:
            assert "name" in p
            assert "display_name" in p
            assert "model" in p
