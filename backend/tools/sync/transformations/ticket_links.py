"""
Ticket Links
============
Flat edge list of all Jira issue-link relationships extracted from the silver
layer.  Intended for the Constellations view in Cadence — a force-directed
graph of long-running tickets and their blocking/dependency relationships.

Each row represents one directed edge from source → target.

Fields
------
source_key          Jira key of the issue that holds the link (e.g. PROJ-123)
target_key          Jira key of the linked issue (e.g. PROJ-456)
link_type           Link type name (e.g. "Blocks", "Dependancy")
direction           "outward" or "inward"
relation            Human-readable relation label (e.g. "blocks", "is blocked by")
source_status       Current status of the source issue
source_project      Project key of the source issue
source_updated      YYYY-MM-DD of last update on the source issue
target_status       Current status of the linked issue (from the link snapshot)
target_project      Project key of the linked issue (derived from key prefix)
"""

OUTPUT = "data/gold/ticket_links.csv"
FIELDS = [
    "source_key",
    "target_key",
    "link_type",
    "direction",
    "relation",
    "source_status",
    "source_project",
    "source_updated",
    "target_status",
    "target_project",
]


def _ymd(iso_str: str) -> str:
    """Return 'YYYY-MM-DD' from an ISO timestamp, or ''."""
    if not iso_str:
        return ""
    return iso_str[:10]


def _project_from_key(key: str) -> str:
    """Extract project prefix from a Jira key like 'PROJ-123' → 'PROJ'."""
    return key.split("-")[0] if "-" in key else ""


def transform(issues: list) -> list:
    rows = []

    for issue in issues:
        source_key = issue.get("key", "")
        fields = issue.get("fields", {})

        source_status = (fields.get("status") or {}).get("name", "")
        source_project = (fields.get("project") or {}).get(
            "key", ""
        ) or _project_from_key(source_key)
        source_updated = _ymd(fields.get("updated", ""))

        for link in fields.get("issuelinks") or []:
            link_type = (link.get("type") or {}).get("name", "")

            for direction in ("outward", "inward"):
                linked_issue_key = (
                    "outwardIssue" if direction == "outward" else "inwardIssue"
                )
                linked = link.get(linked_issue_key)
                if not linked:
                    continue

                target_key = linked.get("key", "")
                relation = (link.get("type") or {}).get(direction, "")
                target_status = (linked.get("fields", {}).get("status") or {}).get(
                    "name", ""
                )
                target_project = _project_from_key(target_key)

                rows.append(
                    {
                        "source_key": source_key,
                        "target_key": target_key,
                        "link_type": link_type,
                        "direction": direction,
                        "relation": relation,
                        "source_status": source_status,
                        "source_project": source_project,
                        "source_updated": source_updated,
                        "target_status": target_status,
                        "target_project": target_project,
                    }
                )

    rows.sort(
        key=lambda r: (
            r["source_project"],
            r["source_key"],
            r["direction"],
            r["target_key"],
        )
    )
    return rows
