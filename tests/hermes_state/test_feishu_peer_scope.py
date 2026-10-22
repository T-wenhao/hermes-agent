"""Feishu peer scoping stays intact across the newer listing paths."""

import json

import pytest

from hermes_state import SessionDB


@pytest.fixture
def db(tmp_path):
    store = SessionDB(db_path=tmp_path / "state.db")
    yield store
    store.close()


def test_pinned_backfill_keeps_the_selected_feishu_peer(db):
    for sid, peer in (("alice-current", "alice"), ("alice-pin", "alice"), ("bob-pin", "bob")):
        db.create_session(sid, "feishu", origin_json=json.dumps({"user_id_alt": peer}))
    for sid in ("alice-pin", "bob-pin"):
        db.set_session_pinned(sid, True)
        db.set_session_archived(sid, True)

    rows = db.list_sessions_rich(source="feishu", peer_id="alice", limit=1, include_pinned=True)

    # A pin still overrides archive visibility, but never the selected person.
    assert {row["id"] for row in rows} == {"alice-current", "alice-pin"}


def test_subagent_visibility_and_peer_scope_apply_to_both_rows_and_total(db):
    for peer in ("alice", "bob"):
        origin = json.dumps({"user_id_alt": peer})
        db.create_session(peer, "feishu", origin_json=origin)
        db.create_session(f"{peer}-child", "feishu", origin_json=origin,
                          parent_session_id=peer, model_config={"_delegate_from": peer})

    scope = {"source": "feishu", "peer_id": "alice"}
    assert {row["id"] for row in db.list_sessions_rich(**scope)} == {"alice"}
    assert db.session_count(exclude_children=True, **scope) == 1
    rows = db.list_sessions_rich(include_subagents=True, **scope)
    assert {row["id"] for row in rows} == {"alice", "alice-child"}
    assert db.session_count(exclude_children=True, include_subagents=True, **scope) == len(rows)
