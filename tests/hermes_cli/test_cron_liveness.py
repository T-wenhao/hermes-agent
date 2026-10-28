"""Regression: a split deployment (gateway in one container, CLI/dashboard in another) must not
report the scheduler as "not running" while its ticker is demonstrably alive.

The local PID scan, the gateway runtime lock, the multiplexer record and the heartbeat-writer PID
check are all invisible from a sibling container (separate PID namespaces), so the fresh ticker
heartbeat plus the gateway's cross-boundary control-socket answer are the only evidence left.
Three behaviour contracts: a fresh heartbeat with an answering control socket is ready; no
heartbeat at all is still not ready; and a fresh stamp with NO answering gateway keeps the
"not running" verdict, so a killed ticker's last stamp (which reads fresh for ~3 minutes) cannot
queue manual runs nobody picks up.
"""

from __future__ import annotations

import hermes_cli.cron as cron_cli


def _stub_probe(monkeypatch, *, pids, lock, heartbeat_age, identify=None):
    """Wire the liveness evidence sources the helper consults.

    Defaults mirror a split deployment's measured values: no visible gateway PID, no visible
    runtime lock, no multiplexer record, no locally-visible heartbeat writer — the control
    socket (``identify``) answers or not per the test.
    """
    import cron.jobs as jobs_mod
    import gateway.control_socket as control_mod
    import gateway.status as status_mod
    import hermes_cli.gateway as gw_mod

    monkeypatch.setattr(cron_cli, "_active_cron_provider_name", lambda: "builtin")
    monkeypatch.setattr(gw_mod, "find_gateway_pids", lambda: pids)
    monkeypatch.setattr(status_mod, "is_gateway_runtime_lock_active", lambda: lock)
    monkeypatch.setattr(jobs_mod, "get_ticker_heartbeat_age", lambda: heartbeat_age)
    monkeypatch.setattr(gw_mod, "named_profile_served_by_running_multiplexer", lambda: False)
    monkeypatch.setattr(jobs_mod, "ticker_heartbeat_writer_alive", lambda: False)
    monkeypatch.setattr(control_mod, "identify_gateway", lambda home, timeout=2.0: identify)


def test_fresh_heartbeat_and_answering_socket_is_ready_without_a_visible_gateway_process(monkeypatch):
    """No visible PID, lock, multiplexer or writer, but the ticker is fresh and the gateway's
    control socket answers across the container boundary (the split-deployment case)."""
    _stub_probe(monkeypatch, pids=[], lock=False, heartbeat_age=15.0,
                identify={"kind": "hermes-gateway", "pid": 206})
    assert cron_cli._builtin_gateway_liveness() is True


def test_no_gateway_process_and_no_fresh_heartbeat_is_not_ready(monkeypatch):
    """Don't overshoot the other way: without a fresh heartbeat the answer stays False even when
    a gateway answers — the scheduler loop itself is not iterating."""
    _stub_probe(monkeypatch, pids=[], lock=False, heartbeat_age=None,
                identify={"kind": "hermes-gateway", "pid": 206})
    assert cron_cli._builtin_gateway_liveness() is False


def test_fresh_heartbeat_with_no_answering_gateway_is_not_ready(monkeypatch):
    """A killed ticker's last stamp reads fresh for ~3 minutes: with the writer unverifiable and
    the control socket silent (dead gateway), the scheduler is NOT ready — the pre-split-fix
    "trust the stamp alone" behaviour must not return for same-namespace deaths."""
    _stub_probe(monkeypatch, pids=[], lock=False, heartbeat_age=15.0, identify=None)
    assert cron_cli._builtin_gateway_liveness() is False
