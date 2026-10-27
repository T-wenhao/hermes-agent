"""Packaged banners must identify running code even beside an old source clone."""

import json
import subprocess

import pytest

from hermes_cli import banner, version_info


@pytest.fixture
def installed_tree(tmp_path, monkeypatch):
    root = tmp_path / "runtime"
    (root / "hermes_cli").mkdir(parents=True)
    monkeypatch.setattr(banner, "__file__", str(root / "hermes_cli" / "banner.py"))
    monkeypatch.setattr(version_info, "__file__", str(root / "hermes_cli" / "version_info.py"))
    monkeypatch.setattr("pm.paths.repo_root", lambda: root)
    monkeypatch.setattr("hermes_cli.config.get_project_root", lambda: root)
    monkeypatch.setattr(banner, "_git_banner_state_cache", None)
    monkeypatch.setattr(banner, "_latest_release_cache", None)
    version_info._reset_version_info_cache()
    yield root
    version_info._reset_version_info_cache()


def _checkout(root):
    root.mkdir(parents=True, exist_ok=True)

    def git(*args):
        return subprocess.check_output(
            ["git", "-c", "user.name=Banner Test", "-c", "user.email=banner@example.invalid",
             "-c", "commit.gpgsign=false", *args], cwd=root, text=True,
        ).strip()

    git("init", "-q")
    git("commit", "--allow-empty", "-qm", f"base for {root.name}")
    upstream = git("rev-parse", "--short=8", "HEAD")
    git("update-ref", "refs/remotes/origin/main", "HEAD")
    git("tag", "v0.1.0")
    git("commit", "--allow-empty", "-qm", "custom")
    return {"upstream": upstream, "local": git("rev-parse", "--short=8", "HEAD"), "ahead": 1}


@pytest.mark.parametrize("distribution", ["docker", "nix"])
def test_packaged_banner_ignores_shared_home_checkout(installed_tree, distribution):
    from hermes_constants import get_hermes_home

    old_clone = get_hermes_home() / "hermes-agent"
    old_state = _checkout(old_clone)
    commit = "a1b2c3d4" + "e" * 32
    (installed_tree / "install-stamp.json").write_text(json.dumps({
        "source": "ci", "distribution": distribution, "updateMechanism": "external",
        "commit": commit, "baseVersion": "0.22.5", "displayVersion": "0.22.5+11",
        "distance": 11,
    }), encoding="utf-8")

    assert banner.get_git_banner_state() == {"upstream": commit[:8], "local": commit[:8], "ahead": 0}
    label = banner.format_banner_version_label()
    assert "0.22.5+11" in label
    assert f"{distribution} · commit {commit[:12]}" in label
    assert old_state["local"] not in label
    assert "upstream" not in label
    assert banner.get_latest_release_tag() is None
    # Explicit repository inspection remains available beside a packaged runtime.
    assert banner.get_git_banner_state(repo_dir=old_clone) == old_state


def test_source_banner_still_compares_running_checkout(installed_tree):
    from hermes_constants import get_hermes_home

    old_state = _checkout(get_hermes_home() / "hermes-agent")
    expected = _checkout(installed_tree)
    assert expected["local"] != old_state["local"]
    assert banner.get_git_banner_state() == expected
    label = banner.format_banner_version_label()
    assert f"upstream {expected['upstream']}" in label
    assert f"local {expected['local']} (+1 carried commit)" in label
