"""思维导图纯函数单元测试：{name, children} 格式。"""
from __future__ import annotations

import os

os.environ.setdefault("DB_URL", "sqlite+aiosqlite://")
os.environ.setdefault("REDIS_URL", "")
os.environ.setdefault("DEEPSEEK_API_KEY", "test-key-not-real")

import pytest  # noqa: E402

from app.websockets.handlers.mindmap import (  # noqa: E402
    _apply_mindmap_operation,
    _hard_truncate,
    _parse_tree_json,
    _tree_to_nodes_edges,
    _apply_tree_layout,
    _attach_source_metadata,
    _build_message_source_lookup,
)


class TestParseTreeJson:

    def test_direct_json(self):
        raw = '{"name": "批判性思维", "children": []}'
        assert _parse_tree_json(raw)["name"] == "批判性思维"

    def test_code_block(self):
        raw = '```json\n{"name": "设计思维", "children": []}\n```'
        assert _parse_tree_json(raw)["name"] == "设计思维"

    def test_embedded_json(self):
        raw = '分析结果：\n{"name": "主题", "children": [{"name": "子节点"}]}\n完毕。'
        tree = _parse_tree_json(raw)
        assert tree is not None
        assert len(tree["children"]) == 1

    def test_invalid_returns_none(self):
        assert _parse_tree_json("这不是 JSON") is None

    def test_old_topic_format_returns_none(self):
        """旧 {topic, branches} 格式不应被接受。"""
        raw = '{"topic": "主题", "branches": []}'
        assert _parse_tree_json(raw) is None

    def test_no_info(self):
        raw = '{"name": "待讨论", "children": []}'
        tree = _parse_tree_json(raw)
        assert tree["name"] == "待讨论"


class TestTreeToNodesEdges:

    def test_root_only(self):
        tree = {"name": "批判性思维", "children": []}
        nodes, edges = _tree_to_nodes_edges(tree)
        assert len(nodes) == 1
        assert nodes[0]["label"] == "批判性思维"
        assert nodes[0]["type"] == "concept"
        assert len(edges) == 0

    def test_one_child(self):
        tree = {
            "name": "批判性思维",
            "children": [
                {"name": "独立分析", "relationship": "包含"}
            ],
        }
        nodes, edges = _tree_to_nodes_edges(tree)
        assert len(nodes) == 2
        assert len(edges) == 1
        assert edges[0]["label"] == "包含"
        assert nodes[1]["type"] == "argument"  # depth 1

    def test_two_levels(self):
        tree = {
            "name": "主题",
            "children": [
                {
                    "name": "分支1",
                    "relationship": "包含",
                    "children": [
                        {"name": "细节A", "relationship": "举例"},
                        {"name": "细节B", "relationship": "属性"},
                    ],
                },
            ],
        }
        nodes, edges = _tree_to_nodes_edges(tree)
        assert len(nodes) == 4  # root + branch + 2 leaves
        assert len(edges) == 3
        # depth 2 nodes should be evidence type
        leaf_types = [n["type"] for n in nodes if n["label"] in ("细节A", "细节B")]
        assert all(t == "evidence" for t in leaf_types)

    def test_max_depth_2(self):
        """第 3 层不应被递归。"""
        tree = {
            "name": "根",
            "children": [{
                "name": "L1",
                "children": [{
                    "name": "L2",
                    "children": [{"name": "L3_should_not_appear"}],
                }],
            }],
        }
        nodes, edges = _tree_to_nodes_edges(tree)
        labels = [n["label"] for n in nodes]
        assert "L3_should…" not in labels and "L3_should_not_appear" not in labels
        assert len(nodes) == 3  # root, L1, L2

    def test_label_clipping(self):
        tree = {"name": "这个标签真的太长了超过十个字", "children": []}
        nodes, _ = _tree_to_nodes_edges(tree)
        assert nodes[0]["label"].endswith("…")
        assert len(nodes[0]["label"]) <= 11

    def test_preserves_source_metadata(self):
        tree = {
            "name": "方案",
            "source_message_ids": ["m1"],
            "source_students": [
                {"id": "s1", "name": "小明", "message_ids": ["m1"]}
            ],
            "children": [],
        }
        nodes, _ = _tree_to_nodes_edges(tree)
        assert nodes[0]["source_message_ids"] == ["m1"]
        assert nodes[0]["source_students"][0]["name"] == "小明"


class TestSourceMetadata:

    def test_attach_source_metadata_filters_invalid_and_groups_students(self):
        messages = [
            {
                "message_id": "m1",
                "sender": {"id": "s1", "name": "小明", "role": "student"},
            },
            {
                "message_id": "m2",
                "sender": {"id": "s2", "name": "小红", "role": "student"},
            },
            {
                "message_id": "m3",
                "sender": {"id": "ai", "name": "AI", "role": "ai"},
            },
        ]
        tree = {
            "name": "观点",
            "source_message_ids": ["m1", "m2", "missing", "m3"],
            "children": [],
        }
        enriched = _attach_source_metadata(
            tree,
            _build_message_source_lookup(messages),
        )
        assert enriched["source_message_ids"] == ["m1", "m2", "m3"]
        assert enriched["source_students"] == [
            {"id": "s1", "name": "小明", "message_ids": ["m1"]},
            {"id": "s2", "name": "小红", "message_ids": ["m2"]},
        ]

    def test_attach_source_metadata_ignores_nodes_without_valid_sources(self):
        tree = {"name": "观点", "source_message_ids": ["missing"], "children": []}
        enriched = _attach_source_metadata(tree, {})
        assert "source_message_ids" not in enriched
        assert "source_students" not in enriched


class TestApplyTreeLayout:

    def test_positions_assigned(self):
        tree = {
            "name": "主题",
            "children": [
                {"name": "A", "relationship": "包含"},
                {"name": "B", "relationship": "属性"},
            ],
        }
        nodes, edges = _tree_to_nodes_edges(tree)
        _apply_tree_layout(nodes, edges)
        for n in nodes:
            assert "position" in n
        # Root should be above children
        root_y = nodes[0]["position"]["y"]
        child_ys = [n["position"]["y"] for n in nodes[1:]]
        assert all(cy > root_y for cy in child_ys)

    def test_empty(self):
        _apply_tree_layout([], [])


class TestHardTruncate:

    def test_no_truncate(self):
        nodes = [{"id": "n1"}, {"id": "n2"}]
        edges = [{"id": "e1", "source": "n1", "target": "n2"}]
        rn, re_ = _hard_truncate(nodes, edges, 5, [])
        assert len(rn) == 2

    def test_truncate_cleans_edges(self):
        nodes = [{"id": f"n{i}"} for i in range(5)]
        edges = [
            {"id": "e1", "source": "n0", "target": "n1"},
            {"id": "e2", "source": "n0", "target": "n4"},
        ]
        rn, re_ = _hard_truncate(nodes, edges, 3, [])
        valid_ids = {n["id"] for n in rn}
        for e in re_:
            assert e["source"] in valid_ids
            assert e["target"] in valid_ids


class TestApplyMindmapOperation:

    def test_add_node_to_empty_graph(self):
        nodes, edges = _apply_mindmap_operation(
            [], [], "add_node",
            {"id": "n1", "label": "观点", "type": "argument"},
        )
        assert nodes == [{"id": "n1", "label": "观点", "type": "argument"}]
        assert edges == []

    def test_update_node_position(self):
        nodes, _ = _apply_mindmap_operation(
            [{"id": "n1", "label": "观点", "type": "argument"}],
            [],
            "update_node_position",
            {"id": "n1", "position": {"x": 12, "y": 34}},
        )
        assert nodes[0]["position"] == {"x": 12, "y": 34}

    def test_remove_node_cleans_edges(self):
        nodes, edges = _apply_mindmap_operation(
            [{"id": "n1"}, {"id": "n2"}],
            [{"id": "e1", "source": "n1", "target": "n2"}],
            "remove_node",
            {"id": "n1"},
        )
        assert nodes == [{"id": "n2"}]
        assert edges == []

    def test_add_edge_dedupes_by_endpoints(self):
        nodes, edges = _apply_mindmap_operation(
            [{"id": "n1"}, {"id": "n2"}],
            [{"id": "e1", "source": "n1", "target": "n2", "label": "包含"}],
            "add_edge",
            {"id": "e2", "source": "n1", "target": "n2", "label": "导致"},
        )
        assert len(edges) == 1

    def test_update_edge_label(self):
        _, edges = _apply_mindmap_operation(
            [],
            [{"id": "e1", "source": "n1", "target": "n2", "label": "包含"}],
            "update_edge",
            {"id": "e1", "label": "基于"},
        )
        assert edges[0]["label"] == "基于"
