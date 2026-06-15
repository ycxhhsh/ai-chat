from app.services.group_role_actions import detect_role_action


def test_questioner_action_detects_question_message():
    result = detect_role_action(
        "提问者",
        [
            {
                "message_id": "m1",
                "content": "为什么这个空间布局能帮助小组协作？",
            }
        ],
    )

    assert result["observed"] is True
    assert result["evidence_message_id"] == "m1"


def test_role_action_reports_unobserved_without_matching_message():
    result = detect_role_action(
        "总结者",
        [
            {
                "message_id": "m1",
                "content": "我也同意这个想法。",
            }
        ],
    )

    assert result["observed"] is False
    assert result["evidence_message_id"] is None
