"""Peer-review assignment helpers."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Sequence


@dataclass(frozen=True)
class SubmissionCandidate:
    assignment_id: str
    student_id: str


@dataclass(frozen=True)
class PeerReviewPair:
    reviewer_id: str
    assignment_id: str
    reviewee_id: str


def _stable_rank(seed: str, *parts: str) -> str:
    raw = "|".join([seed, *parts]).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def build_balanced_peer_review_pairs(
    reviewer_ids: Sequence[str],
    submissions: Sequence[SubmissionCandidate],
    peer_review_count: int = 5,
    seed: str = "",
) -> list[PeerReviewPair]:
    """Build deterministic, balanced, anonymous peer-review pairs.

    Every reviewer receives ``peer_review_count`` submissions, never their own
    submission. The load of received reviews is kept as even as the candidate
    constraints allow.
    """
    reviewers = list(dict.fromkeys(reviewer_ids))
    candidates = list({s.assignment_id: s for s in submissions}.values())

    if peer_review_count <= 0:
        raise ValueError("互评份数必须大于 0")
    if not reviewers:
        raise ValueError("没有可分配互评的学生")
    if not candidates:
        raise ValueError("没有可供互评的作业")

    for reviewer_id in reviewers:
        available = [s for s in candidates if s.student_id != reviewer_id]
        if len(available) < peer_review_count:
            raise ValueError(
                f"学生 {reviewer_id} 可评作业不足：需要 {peer_review_count} 份，"
                f"当前只有 {len(available)} 份"
            )

    best_pairs: list[PeerReviewPair] | None = None
    best_score: tuple[int, int, str] | None = None

    for attempt in range(96):
        loads = {s.assignment_id: 0 for s in candidates}
        pairs: list[PeerReviewPair] = []
        ordered_reviewers = sorted(
            reviewers,
            key=lambda reviewer_id: _stable_rank(
                seed,
                "reviewer",
                str(attempt),
                reviewer_id,
            ),
        )

        for reviewer_id in ordered_reviewers:
            available = [s for s in candidates if s.student_id != reviewer_id]
            available.sort(
                key=lambda s: (
                    loads[s.assignment_id],
                    _stable_rank(
                        seed,
                        "candidate",
                        str(attempt),
                        reviewer_id,
                        s.assignment_id,
                    ),
                )
            )
            selected = available[:peer_review_count]
            for submission in selected:
                loads[submission.assignment_id] += 1
                pairs.append(
                    PeerReviewPair(
                        reviewer_id=reviewer_id,
                        assignment_id=submission.assignment_id,
                        reviewee_id=submission.student_id,
                    )
                )

        load_values = list(loads.values())
        spread = max(load_values) - min(load_values)
        signature = "|".join(
            f"{pair.reviewer_id}:{pair.assignment_id}"
            for pair in sorted(
                pairs,
                key=lambda p: (p.reviewer_id, p.assignment_id),
            )
        )
        score = (spread, max(load_values), signature)
        if best_score is None or score < best_score:
            best_score = score
            best_pairs = pairs
        if spread <= 1:
            break

    pairs = best_pairs or []

    return sorted(
        pairs,
        key=lambda p: _stable_rank(seed, "pair", p.reviewer_id, p.assignment_id),
    )
