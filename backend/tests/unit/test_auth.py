"""认证模块单元测试。"""
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_and_verify(self):
        password = "my-secret-password"
        hashed = hash_password(password)
        assert hashed != password
        assert verify_password(password, hashed)

    def test_wrong_password_fails(self):
        hashed = hash_password("correct")
        assert not verify_password("wrong", hashed)


class TestJWT:
    def test_create_and_decode(self):
        token = create_access_token({"sub": "user-123"})
        payload = decode_access_token(token)
        assert payload is not None
        assert payload["sub"] == "user-123"

    def test_invalid_token_returns_none(self):
        assert decode_access_token("invalid.token.here") is None

    def test_token_contains_expiry(self):
        token = create_access_token({"sub": "user-456"})
        payload = decode_access_token(token)
        assert "exp" in payload
