from collections import Counter

import pytest

from app.services.peer_review_assignment import (
    SubmissionCandidate,
    build_balanced_peer_review_pairs,
)


def _submissions(student_ids: list[str]) -> list[SubmissionCandidate]:
    return [
        SubmissionCandidate(assignment_id=f"a-{student_id}", student_id=student_id)
        for student_id in student_ids
    ]


def test_six_students_review_all_except_self():
    students = [f"s{i}" for i in range(6)]

    pairs = build_balanced_peer_review_pairs(
        students,
        _submissions(students),
        peer_review_count=5,
        seed="task-1",
    )

    assert len(pairs) == 30
    by_reviewer = Counter(pair.reviewer_id for pair in pairs)
    by_assignment = Counter(pair.assignment_id for pair in pairs)
    assert set(by_reviewer.values()) == {5}
    assert set(by_assignment.values()) == {5}
    assert all(pair.assignment_id != f"a-{pair.reviewer_id}" for pair in pairs)


def test_ten_students_are_balanced_and_deterministic():
    students = [f"s{i}" for i in range(10)]

    first = build_balanced_peer_review_pairs(
        students,
        _submissions(students),
        peer_review_count=5,
        seed="task-2",
    )
    second = build_balanced_peer_review_pairs(
        students,
        _submissions(students),
        peer_review_count=5,
        seed="task-2",
    )

    assert first == second
    assert len(first) == 50
    by_reviewer = Counter(pair.reviewer_id for pair in first)
    by_assignment = Counter(pair.assignment_id for pair in first)
    assert set(by_reviewer.values()) == {5}
    assert max(by_assignment.values()) - min(by_assignment.values()) <= 1
    assert len({(p.reviewer_id, p.assignment_id) for p in first}) == len(first)


def test_missing_submitters_still_review_others():
    reviewers = [f"s{i}" for i in range(8)]
    submitters = reviewers[:6]

    pairs = build_balanced_peer_review_pairs(
        reviewers,
        _submissions(submitters),
        peer_review_count=5,
        seed="task-3",
    )

    by_reviewer = Counter(pair.reviewer_id for pair in pairs)
    assert set(by_reviewer) == set(reviewers)
    assert set(by_reviewer.values()) == {5}
    assert all(pair.assignment_id != f"a-{pair.reviewer_id}" for pair in pairs)


def test_insufficient_submissions_is_rejected():
    with pytest.raises(ValueError):
        build_balanced_peer_review_pairs(
            ["s0", "s1", "s2"],
            _submissions(["s0", "s1", "s2"]),
            peer_review_count=5,
            seed="task-4",
        )
