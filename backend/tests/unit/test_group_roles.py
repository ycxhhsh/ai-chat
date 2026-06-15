from app.services.group_roles import COLLABORATION_ROLES, choose_balanced_role


def test_choose_balanced_role_prefers_unused_roles():
    role = choose_balanced_role(["推进者", "提问者"])

    assert role in {"解释者", "质疑者", "总结者"}


def test_choose_balanced_role_balances_repeated_roles():
    role = choose_balanced_role([
        "推进者",
        "提问者",
        "解释者",
        "质疑者",
        "总结者",
        "推进者",
    ])

    assert role in {"提问者", "解释者", "质疑者", "总结者"}


def test_collaboration_roles_have_student_prompt_text():
    assert set(COLLABORATION_ROLES) == {"推进者", "提问者", "解释者", "质疑者", "总结者"}
    assert all(COLLABORATION_ROLES[name]["description"] for name in COLLABORATION_ROLES)
    assert all(COLLABORATION_ROLES[name]["prompt"] for name in COLLABORATION_ROLES)
