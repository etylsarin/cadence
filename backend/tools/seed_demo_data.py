#!/usr/bin/env python3
"""
seed_demo_data.py — Generate synthetic demo data for local testing.

Creates realistic silver-layer issues (Jira issue JSON with changelogs) for all
five squads, then runs the real silver→gold pipeline stage so every gold file
(throughput, flow_metrics, completed_tickets, escaped_defects, chat_tickets,
ticket_links, …) is produced by the same transformation code production uses.

Also writes the Sync status artifacts (bronze mirror, last_sync.txt, logs)
so the Sync dashboard has something to show.

Usage:
    python3 tools/seed_demo_data.py          # generate + run silver→gold
    python3 tools/seed_demo_data.py --skip-gold   # silver/bronze/logs only

Deterministic (seeded RNG) — rerunning wipes and regenerates the same data.
A running backend picks the new data up automatically.
"""

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import zlib
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT   = Path(__file__).resolve().parent.parent
DATA   = ROOT / "data"
SILVER = DATA / "silver"
BRONZE = DATA / "bronze"
LOGS   = DATA / "logs"

rng = random.Random(42)

NOW         = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
START_YEAR  = 2024
START_MONTH = datetime(START_YEAR, 1, 1, tzinfo=timezone.utc)

# ── Squad profiles: distinct throughput / quality so charts differ per squad ──
PROFILES = {
    "ACCS":   {"stories": (5, 11), "bugs": (1, 5), "tasks": (1, 4), "spikes": (0, 1), "speed": 1.0},
    "CONS":   {"stories": (8, 15), "bugs": (2, 6), "tasks": (2, 5), "spikes": (0, 2), "speed": 0.8},
    "ENGS":   {"stories": (3, 8),  "bugs": (1, 4), "tasks": (1, 3), "spikes": (0, 1), "speed": 1.5},
    "NBLMNT": {"stories": (2, 6),  "bugs": (2, 6), "tasks": (1, 3), "spikes": (0, 1), "speed": 1.2},
    "TRAS":   {"stories": (4, 9),  "bugs": (1, 4), "tasks": (1, 4), "spikes": (0, 1), "speed": 1.1},
}

ASSIGNEES = {
    "ACCS":   ["Petra Kovacs", "Jan Dvorak", "Milos Horak", "Anna Reichel"],
    "CONS":   ["Tomas Novak", "Lucie Svobodova", "Marek Pollak", "Eva Cerna", "David Kral"],
    "ENGS":   ["Pavel Urban", "Karolina Mala", "Ondrej Benes"],
    "NBLMNT": ["Jana Vlckova", "Filip Marek", "Roman Sykora"],
    "TRAS":   ["Martin Vesely", "Tereza Hruba", "Adam Polak", "Nina Bartos"],
}

LABELS      = ["frontend", "backend", "api", "tech-debt", "regression", "performance", "security", "ux", "infra"]
ROOT_CAUSES = ["Code defect", "Configuration", "Data issue", "3rd party", "Missed requirement", "Environment"]
PRIORITIES  = ["Highest", "High", "Medium", "Medium", "Medium", "Low", "Low"]

STORY_SUMMARIES = [
    "Add bulk export to {area}", "Redesign {area} filters", "Support multi-currency in {area}",
    "Migrate {area} to new API gateway", "Inline editing for {area} table", "Add audit log to {area}",
    "Improve {area} search relevance", "Lazy-load {area} dashboard widgets", "New onboarding flow for {area}",
    "Consolidate {area} notification settings", "Add CSV import validation to {area}",
    "Role-based access for {area} admin", "Pagination for {area} history view", "Dark mode for {area} screens",
    "Localize {area} into DE and FR", "Configurable SLA thresholds in {area}",
]
BUG_SUMMARIES = [
    "{area} export drops rows with unicode names", "500 when saving empty {area} form",
    "{area} totals off by one day across DST", "Duplicate notifications from {area} watcher",
    "{area} chart axis overlaps on small screens", "Session expires mid-{area} wizard",
    "{area} search ignores diacritics", "Stale cache after {area} bulk update",
    "{area} PDF render cuts long tables", "Race condition in {area} autosave",
]
TASK_SUMMARIES = [
    "Update {area} dependencies", "Document {area} runbook", "Add monitoring to {area} jobs",
    "Cleanup deprecated {area} flags", "Tune {area} DB indexes", "Rotate {area} service credentials",
]
SPIKE_SUMMARIES = [
    "Evaluate vendor options for {area}", "Prototype {area} caching layer", "Investigate {area} latency spikes",
]
AREAS = ["billing", "checkout", "reporting", "catalog", "accounts", "shipments", "contracts", "inventory", "claims"]

# Status flows (every status exists in flow_config_default.json)
STORY_FLOW = [
    ("Open", 0.5, 4), ("In Analysis", 0.5, 4), ("Ready for Dev", 0.2, 3),
    ("In Progress", 1, 8), ("Code Review", 0.2, 2.5), ("Ready For Testing", 0.1, 3),
    ("In Testing", 0.5, 4), ("Ready for UAT", 0.1, 2), ("UAT in Progress", 0.5, 3),
    ("Ready to Deploy", 0.2, 6),
]
BUG_FLOW = [
    ("Open", 0.1, 2), ("In Triage", 0.1, 1.5), ("In Progress", 0.5, 5),
    ("Code Review", 0.1, 1.5), ("Ready for Test", 0.1, 2), ("Testing", 0.3, 3),
]
TASK_FLOW  = [("To Do", 0.5, 6), ("In Progress", 0.5, 6)]
SPIKE_FLOW = [("Open", 0.5, 5), ("In Progress", 1, 8)]

TERMINALS = {"Story": ["Delivered", "Done"], "Bug": ["Closed", "Done"], "Task": ["Done"], "Spike": ["Done"]}

# Mid-flow statuses for in-flight (Constellations) tickets — none pre/post-work.
STALE_STATUSES = [
    "In Progress", "Code Review", "In Testing", "UAT in Progress", "SIT in Progress",
    "Ready For Testing", "Ready for UAT", "Ready to Deploy", "Approved for SIT env", "Testing In Progress",
]

LINK_TYPES = [
    ("Blocks",     "blocks",     "is blocked by"),
    ("Dependancy", "depends on", "is a dependency of"),
    ("Relates",    "relates to", "relates to"),
]

_seq = {p: 100 for p in PROFILES}


def next_key(project: str) -> str:
    _seq[project] += rng.randint(1, 9)
    return f"{project}-{_seq[project]}"


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000+0000")


def pick_summary(pool: list, project: str) -> str:
    return rng.choice(pool).format(area=rng.choice(AREAS))


def month_range():
    """Yield (month_start, month_end) for every month from START_MONTH to now."""
    cur = START_MONTH
    while cur <= NOW:
        nxt = (cur.replace(day=28) + timedelta(days=6)).replace(day=1)
        yield cur, min(nxt - timedelta(seconds=1), NOW)
        cur = nxt


def build_flow(flow, speed: float, rework: bool):
    """Return [(status, duration_days)] — durations scaled by squad speed."""
    out = []
    for status, lo, hi in flow:
        d = rng.uniform(lo, hi) * speed
        if rng.random() < 0.06:           # occasional outlier (long tail)
            d *= rng.uniform(3, 8)
        out.append((status, d))
    if rework and len(flow) > 5:          # send it back from testing once
        i = next((j for j, (s, _) in enumerate(out) if "Test" in s), None)
        if i:
            out[i + 1:i + 1] = [("In Progress", rng.uniform(0.5, 3) * speed),
                                ("Code Review", rng.uniform(0.1, 1) * speed),
                                (out[i][0], rng.uniform(0.3, 2) * speed)]
    return out


def make_changelog(created: datetime, steps: list, final_status: str):
    """steps = [(status, duration_days)]; returns (histories, last_transition_dt)."""
    histories = []
    t = created
    for i, (status, dur) in enumerate(steps):
        t = t + timedelta(days=dur)
        to_status = steps[i + 1][0] if i + 1 < len(steps) else final_status
        histories.append({
            "created": iso(t),
            "items": [{"field": "status", "fromString": status, "toString": to_status}],
        })
    return histories, t


# Board ids per project — sprint id = board_id * 1000 + sprint number.
BOARD_IDS = {"CONS": 1963, "ENGS": 1433, "TRAS": 1965, "ACCS": 2364, "NBLMNT": 2998}


def _sprint_obj(project: str, n: int) -> dict:
    """Full sprint entity for biweekly sprint n (1-based since START_YEAR)."""
    year   = START_YEAR + (n - 1) // 26
    biweek = (n - 1) % 26
    start  = datetime(year, 1, 1, 8, tzinfo=timezone.utc) + timedelta(days=biweek * 14)
    end    = start + timedelta(days=13, hours=9)
    closed = end < NOW
    return {
        "id":           BOARD_IDS[project] * 1000 + n,
        "name":         f"{project} Sprint {n}",
        "state":        "closed" if closed else "active",
        "startDate":    iso(start),
        "endDate":      iso(end),
        "completeDate": iso(end + timedelta(minutes=30)) if closed else "",
        "goal":         f"Burn down {project.lower()} backlog priorities and close out carried-over defects.",
    }


def sprint_for(project: str, dt: datetime):
    n = (dt.year - START_YEAR) * 26 + (dt.timetuple().tm_yday // 14) + 1
    sprints = [_sprint_obj(project, n)]
    if n > 1 and rng.random() < 0.18:        # carried over from the previous sprint
        sprints.insert(0, _sprint_obj(project, n - 1))
    return sprints


def base_fields(project: str, itype: str, summary: str, status: str, created: datetime, updated: datetime):
    f = {
        "summary":   summary,
        "issuetype": {"name": itype},
        "project":   {"key": project},
        "status":    {"name": status},
        "priority":  {"name": rng.choice(PRIORITIES)},
        "assignee":  {"displayName": rng.choice(ASSIGNEES[project])} if rng.random() < 0.9 else None,
        "created":   iso(created),
        "updated":   iso(updated),
        "labels":    rng.sample(LABELS, k=rng.randint(0, 2)),
        "description": f"As a user I want {summary[0].lower()}{summary[1:]} so the team can work faster.",
        "customfield_10007": sprint_for(project, updated),
        "customfield_10008": f"{project}-{rng.randint(90, 96) * 100}" if rng.random() < 0.7 else None,
    }
    if itype in ("Story", "Bug") and rng.random() < 0.8:
        f["customfield_10005"] = float(rng.choice([1, 2, 3, 3, 5, 5, 8, 13]))
    return f


def add_bug_fields(fields: dict, escaped: bool):
    fields["customfield_12081"] = {"value": rng.choice(ROOT_CAUSES)}
    if escaped:
        fields["customfield_12589"] = [{"value": "Production [PROD]"}]
        fields["customfield_12017"] = {"value": "Production"}
    else:
        fields["customfield_12589"] = [{"value": rng.choice(["UAT [UAT]", "SIT [SIT]", "Dev [DEV]"])}]
        fields["customfield_12017"] = {"value": rng.choice(["UAT", "SIT", "Development", "Internal Testing"])}


def completed_issue(project: str, itype: str, terminal_dt: datetime):
    """A ticket whose first terminal transition lands at terminal_dt."""
    profile = PROFILES[project]
    flow = {"Story": STORY_FLOW, "Bug": BUG_FLOW, "Task": TASK_FLOW, "Spike": SPIKE_FLOW}[itype]
    steps = build_flow(flow, profile["speed"], rework=(itype == "Story" and rng.random() < 0.2))
    total = sum(d for _, d in steps)
    created = terminal_dt - timedelta(days=total)
    terminal = rng.choice(TERMINALS[itype])

    pool = {"Story": STORY_SUMMARIES, "Bug": BUG_SUMMARIES, "Task": TASK_SUMMARIES, "Spike": SPIKE_SUMMARIES}[itype]
    fields = base_fields(project, itype, pick_summary(pool, project), terminal, created, terminal_dt)
    histories, _ = make_changelog(created, steps, terminal)

    if itype == "Bug":
        add_bug_fields(fields, escaped=rng.random() < 0.55)
    if itype in ("Story", "Bug") and rng.random() < 0.75:
        q = (terminal_dt.month - 1) // 3 + 1
        ver_seq = terminal_dt.month * 2 + (1 if terminal_dt.day > 15 else 0)
        name = f"{project} {terminal_dt.year}.Q{q}.{ver_seq}"
        if terminal_dt.day > 15:
            nxt = (terminal_dt.replace(day=28) + timedelta(days=6)).replace(day=1)
            rel_date = (nxt - timedelta(days=1)).date()
        else:
            rel_date = terminal_dt.replace(day=15).date()
        # Deterministic, collision-free id per (project, name) — Python's hash()
        # is salted per process and collides across projects.
        fields["fixVersions"] = [{
            "id":          str(100000 + zlib.crc32(name.encode()) % 900000),
            "name":        name,
            "released":    rel_date < (NOW - timedelta(days=30)).date(),
            "releaseDate": rel_date.isoformat(),
        }]

    return {"key": next_key(project), "fields": fields, "changelog": {"histories": histories}}


def inflight_issue(project: str, status: str, days_stale: int):
    """An open ticket sitting in `status` for `days_stale` days (Constellations)."""
    itype = rng.choices(["Story", "Bug", "Task"], weights=[6, 3, 1])[0]
    flow = {"Story": STORY_FLOW, "Bug": BUG_FLOW, "Task": TASK_FLOW}[itype]
    # Walk part of the flow, then land in `status` days_stale ago.
    upto = rng.randint(1, max(1, len(flow) - 2))
    steps = build_flow(flow[:upto], PROFILES[project]["speed"], rework=False)
    total = sum(d for _, d in steps)
    last_transition = NOW - timedelta(days=days_stale)
    created = last_transition - timedelta(days=total)

    pool = {"Story": STORY_SUMMARIES, "Bug": BUG_SUMMARIES, "Task": TASK_SUMMARIES}[itype]
    fields = base_fields(project, itype, pick_summary(pool, project), status, created, last_transition)
    histories, _ = make_changelog(created, steps, status)
    if itype == "Bug":
        add_bug_fields(fields, escaped=rng.random() < 0.3)
    return {"key": next_key(project), "fields": fields, "changelog": {"histories": histories}}


def backlog_issue(project: str, epic_key: str):
    """A genuinely open ticket in an epic's backlog — never sprinted."""
    itype  = rng.choices(["Story", "Bug", "Task"], weights=[7, 2, 1])[0]
    status = rng.choice(["Open", "Open", "In Analysis", "Ready for Dev"])
    created = NOW - timedelta(days=rng.uniform(3, 150))
    pool = {"Story": STORY_SUMMARIES, "Bug": BUG_SUMMARIES, "Task": TASK_SUMMARIES}[itype]
    fields = base_fields(project, itype, pick_summary(pool, project), status, created, created)
    fields["customfield_10007"] = None
    fields["customfield_10008"] = epic_key
    if itype == "Bug":
        add_bug_fields(fields, escaped=False)
    histories = []
    if status != "Open":
        histories = [{"created": iso(created + timedelta(days=rng.uniform(0.5, 5))),
                      "items": [{"field": "status", "fromString": "Open", "toString": status}]}]
    return {"key": next_key(project), "fields": fields, "changelog": {"histories": histories}}


_EPIC_THEMES = [
    "Self-service onboarding", "Reporting revamp", "Checkout 2.0",
    "Data quality programme", "Mobile parity", "Compliance 2026",
    "Performance hardening", "Partner integrations",
]
_EPIC_STATUSES   = ["In Progress", "In Progress", "In Analysis", "Ready to Start", "Delivered"]
_EPIC_PRIORITIES = ["Critical", "High", "Medium", "Medium", "Low"]


def epic_issue(epic_key: str, members: list) -> dict:
    """A first-class Epic issue synthesized from its children's date span."""
    h = zlib.crc32(epic_key.encode())
    created = min(m["fields"].get("created", "") for m in members)
    created = max(created, iso(START_MONTH))      # keep within the sync window
    updated = max(m["fields"].get("updated", "") for m in members)
    theme   = _EPIC_THEMES[h % len(_EPIC_THEMES)]
    return {
        "key": epic_key,
        "fields": {
            "summary":     theme,
            "issuetype":   {"name": "Epic"},
            "project":     {"key": epic_key.split("-")[0]},
            "status":      {"name": _EPIC_STATUSES[h % len(_EPIC_STATUSES)]},
            "priority":    {"name": _EPIC_PRIORITIES[(h >> 8) % len(_EPIC_PRIORITIES)]},
            "assignee":    None,
            "created":     created,
            "updated":     updated,
            "labels":      [],
            "description": f"Epic: {theme.lower()} — umbrella for related delivery work.",
            "customfield_10007": None,
            "customfield_10008": None,
        },
        "changelog": {"histories": []},
    }


def link_entry(link_type, direction: str, other_key: str, other_status: str):
    name, outward, inward = link_type
    entry = {"type": {"name": name, "outward": outward, "inward": inward}}
    entry["outwardIssue" if direction == "outward" else "inwardIssue"] = {
        "key": other_key, "fields": {"status": {"name": other_status}}}
    return entry


def add_link(a: dict, b: dict, link_type):
    """a --link--> b, recorded on both sides (outward on a, inward on b)."""
    a["fields"].setdefault("issuelinks", []).append(
        link_entry(link_type, "outward", b["key"], b["fields"]["status"]["name"]))
    b["fields"].setdefault("issuelinks", []).append(
        link_entry(link_type, "inward", a["key"], a["fields"]["status"]["name"]))


def add_external_link(a: dict, link_type, ext_key: str, ext_status: str):
    a["fields"].setdefault("issuelinks", []).append(
        link_entry(link_type, "inward", ext_key, ext_status))


# ── Generation ────────────────────────────────────────────────────────────────

def generate() -> list:
    issues = []

    # Completed work, month by month, with mild seasonality + growth.
    for project, profile in PROFILES.items():
        for m_start, m_end in month_range():
            month_idx = (m_start.year - START_YEAR) * 12 + m_start.month - 1
            season = 1.0 + 0.18 * rng.uniform(-1, 1) + min(0.25, month_idx * 0.008)
            span_days = max(1, (m_end - m_start).days)
            for itype, key in (("Story", "stories"), ("Bug", "bugs"), ("Task", "tasks"), ("Spike", "spikes")):
                lo, hi = profile[key]
                n = round(rng.randint(lo, hi) * season * (span_days / 30))
                for _ in range(n):
                    terminal_dt = m_start + timedelta(
                        days=rng.uniform(0, span_days - 0.2), hours=rng.uniform(8, 18))
                    issues.append(completed_issue(project, itype, terminal_dt))

    # In-flight stale tickets + link clusters for Constellations.
    stale_by_project = {}
    for project in PROFILES:
        group = []
        for _ in range(rng.randint(8, 12)):
            status = rng.choice(STALE_STATUSES)
            days = rng.choices([rng.randint(5, 13), rng.randint(14, 45), rng.randint(46, 120)],
                               weights=[2, 5, 3])[0]
            group.append(inflight_issue(project, status, days))
        stale_by_project[project] = group
        issues.extend(group)

    for project, group in stale_by_project.items():
        rng.shuffle(group)
        # Blocking chain of three
        if len(group) >= 3:
            add_link(group[0], group[1], LINK_TYPES[0])
            add_link(group[1], group[2], LINK_TYPES[0])
        # A dependency pair and a relates pair
        if len(group) >= 5:
            add_link(group[3], group[4], LINK_TYPES[1])
        if len(group) >= 7:
            add_link(group[5], group[6], LINK_TYPES[2])
        # Link to an external (unsynced) project
        ext = f"{rng.choice(['DO', 'PLAT', 'INFRA'])}-{rng.randint(1000, 4000)}"
        add_external_link(group[0], LINK_TYPES[0], ext, rng.choice(["In Progress", "Open"]))
        # Link to a recently completed ticket (renders as dashed "resolved end")
        done = [i for i in issues
                if i["fields"]["project"]["key"] == project
                and i["fields"]["status"]["name"] in ("Done", "Delivered", "Closed")]
        if done and len(group) >= 2:
            add_link(group[1], rng.choice(done[-20:]), LINK_TYPES[1])

    # One cross-squad blocking edge
    if stale_by_project["ACCS"] and stale_by_project["CONS"]:
        add_link(stale_by_project["CONS"][0], stale_by_project["ACCS"][0], LINK_TYPES[0])

    # Recently approved-for-PROD tickets (not yet terminal) — the Sprint
    # Summary "approved" metric counts current status.
    for project in PROFILES:
        for _ in range(rng.randint(5, 10)):
            issues.append(inflight_issue(project, "Approved for PROD env", rng.randint(1, 45)))

    # Epics as first-class issues (so they sync like everything else), each
    # with a plannable open backlog for the Epic Planner.
    children = defaultdict(list)
    for i in issues:
        ek = i["fields"].get("customfield_10008")
        if ek:
            children[ek].append(i)

    for ek in sorted(children):
        project = ek.split("-")[0]
        for _ in range(rng.randint(2, 6)):
            b = backlog_issue(project, ek)
            issues.append(b)
            children[ek].append(b)

    for ek, members in sorted(children.items()):
        issues.append(epic_issue(ek, members))

    return issues


def write_layers(issues: list):
    for d in (SILVER, BRONZE, LOGS):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True, exist_ok=True)

    for issue in issues:
        blob = json.dumps(issue, ensure_ascii=False, indent=1)
        (SILVER / f"{issue['key']}.json").write_text(blob)
        (BRONZE / f"{issue['key']}.json").write_text(blob)

    sync_dt = NOW - timedelta(hours=2)
    (DATA / "last_sync.txt").write_text(sync_dt.strftime("%Y-%m-%dT%H:%M:%SZ") + "\n")

    # Demo pipeline logs (format matches sync's _parse_log_summary)
    for days_ago, new, updated in ((0, 14, 63), (1, 9, 41), (2, 22, 78)):
        start = (NOW - timedelta(days=days_ago, hours=2)).replace(minute=0, second=1)
        name = start.strftime("%Y-%m-%dT%H-%M-%SZ") + ".log"
        end1 = start + timedelta(minutes=2, seconds=41)
        end2 = end1 + timedelta(seconds=17)
        end3 = end2 + timedelta(seconds=14)
        log_path = LOGS / name
        log_path.write_text("\n".join([
            f"Sync pipeline  started={start.strftime('%Y-%m-%dT%H:%M:%SZ')}",
            "Stages: fetch → repair → bronze→silver → silver→gold",
            f"DISCOVER  {len(issues)} tickets across 5 projects",
            f"  SUMMARY  new={new} updated={updated} deleted=0 time=2m41s",
            f"[fetch]  finished={end1.strftime('%Y-%m-%dT%H:%M:%SZ')}  exit=0",
            f"[bronze→silver]  finished={end2.strftime('%Y-%m-%dT%H:%M:%SZ')}  exit=0",
            f"[silver→gold]  finished={end3.strftime('%Y-%m-%dT%H:%M:%SZ')}  exit=0",
            "Done.",
        ]) + "\n")
        # The Sync UI derives run duration from filename-ts → file mtime.
        os.utime(log_path, (end3.timestamp(), end3.timestamp()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-gold", action="store_true",
                        help="generate silver/bronze/logs but skip the silver→gold run")
    args = parser.parse_args()

    print("Generating synthetic issues…")
    issues = generate()
    by_type = {}
    for i in issues:
        t = i["fields"]["issuetype"]["name"]
        by_type[t] = by_type.get(t, 0) + 1
    print(f"  {len(issues)} issues: " + ", ".join(f"{v} {k}" for k, v in sorted(by_type.items())))

    print(f"Writing silver + bronze layers to {DATA.relative_to(ROOT)}/ …")
    write_layers(issues)

    if args.skip_gold:
        print("Skipped silver→gold (--skip-gold).")
        return

    print("Running the real silver→gold transformations…")
    result = subprocess.run([sys.executable, "_silver2gold.py"],
                            cwd=ROOT / "tools" / "sync")
    if result.returncode != 0:
        sys.exit("silver→gold failed")

    print("\nDone. A running backend picks the new data up automatically "
          "(mirror + gold caches reload on change).")


if __name__ == "__main__":
    main()
