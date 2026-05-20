from app.models.base import Base
from app.models.user import User
from app.models.group import Group, GroupMember
from app.models.message import Message
from app.models.scaffold import Scaffold, UserScaffoldState
from app.models.assignment import (
    Assignment,
    AssignmentPeerReview,
    AssignmentSelfReview,
    AssignmentTask,
    AssignmentTaskTarget,
)
from app.models.document import Document
from app.models.mindmap import MindMap
from app.models.llm_provider import LLMProvider
from app.models.course import Course, CourseEnrollment
from app.models.ai_conversation import AiConversation
from app.models.conversation_summary import ConversationSummary
from app.models.job import Job
from app.models.notification import Notification
from app.models.learning_space_design import (
    LearningSpaceAccelerationCheck,
    LearningSpaceEntry,
    LearningSpaceMessage,
    LearningSpaceQuestion,
    LearningSpaceRevision,
    LearningSpaceSession,
)

__all__ = [
    "Base",
    "User",
    "Group",
    "GroupMember",
    "Message",
    "Scaffold",
    "UserScaffoldState",
    "Assignment",
    "AssignmentTask",
    "AssignmentTaskTarget",
    "AssignmentSelfReview",
    "AssignmentPeerReview",
    "Document",
    "MindMap",
    "LLMProvider",
    "Course",
    "CourseEnrollment",
    "AiConversation",
    "ConversationSummary",
    "Job",
    "Notification",
    "LearningSpaceQuestion",
    "LearningSpaceSession",
    "LearningSpaceEntry",
    "LearningSpaceRevision",
    "LearningSpaceMessage",
    "LearningSpaceAccelerationCheck",
]

