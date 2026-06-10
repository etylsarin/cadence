"""Prompt assembly for the Prompt Builder tool.

Purely deterministic — no AI call. The output of this tool IS the prompt,
which the user copies into Claude (Code, chat, …) themselves.
"""

import pathlib

PROMPTS_DIR = pathlib.Path(__file__).parent / "prompts"

# Context blocks the user can toggle on/off; all included by default.
INCLUDE_KEYS = ("description", "epic", "links", "attachments")


def _block(title: str, body: str) -> str:
    return f"## {title}\n{body.strip()}\n"


def _human_size(size) -> str:
    try:
        n = int(size)
    except (TypeError, ValueError):
        return "unknown size"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return ""


def build_prompt(detail: dict, include: dict, instruction: str) -> str:
    inc = {k: True for k in INCLUDE_KEYS}
    inc.update({k: bool(v) for k, v in (include or {}).items() if k in INCLUDE_KEYS})

    blocks = []

    if inc["description"]:
        blocks.append(_block("Description", detail.get("description") or "(no description)"))

    epic = detail.get("epic")
    if inc["epic"] and epic:
        body = f"[{epic['key']}] {epic.get('summary') or '(summary not synced)'}"
        if epic.get("description"):
            body += "\n" + epic["description"]
        blocks.append(_block("Epic", body))

    links = detail.get("links") or []
    if inc["links"] and links:
        lines = [
            f"- {l['relation']} [{l['key']}]"
            + (f" {l['summary']}" if l.get("summary") else "")
            + (f" (status: {l['status']})" if l.get("status") else "")
            for l in links
        ]
        blocks.append(_block("Linked issues", "\n".join(lines)))

    attachments = detail.get("attachments") or []
    if inc["attachments"] and attachments:
        lines = [
            f"- {a['filename']} ({a.get('mimeType') or 'unknown type'}, {_human_size(a.get('size'))})"
            for a in attachments
        ]
        blocks.append(_block(
            "Attachments (filenames only — contents are not synced locally; fetch from Jira if needed)",
            "\n".join(lines),
        ))

    instruction_block = ""
    if instruction.strip():
        instruction_block = f"\nAdditional instructions from the requester:\n{instruction.strip()}\n"

    template = (PROMPTS_DIR / "ticket_prompt.txt").read_text()
    return template.format(
        key=detail.get("key", ""),
        summary=detail.get("summary", ""),
        issue_type=detail.get("type") or "Unknown",
        priority=detail.get("priority") or "None",
        status=detail.get("status") or "Unknown",
        project=detail.get("project", ""),
        context_blocks="\n".join(blocks),
        instruction_block=instruction_block,
    )
