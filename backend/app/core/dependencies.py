"""FastAPI 公共依赖注入。"""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import decode_access_token
from app.db.session import AsyncSessionLocal
from app.models.user import User

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

security_scheme = HTTPBearer()


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials, Depends(security_scheme)
    ],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """从 Bearer Token 解析当前登录用户。"""
    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject",
        )
    result = await db.execute(
        select(User).where(User.user_id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user


async def require_teacher(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    """只允许教师角色访问。"""
    if user.role != "teacher":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher role required",
        )
    return user
