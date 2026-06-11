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
    blocks = []

    desc = detail.get("description") or ""
    blocks.append(_block("Description", desc if desc.strip() else "(no description provided)"))

    epic = detail.get("epic")
    if epic:
        body = f"[{epic['key']}] {epic.get('summary') or '(summary not synced)'}"
        if epic.get("description"):
            body += "\n\n" + epic["description"]
        blocks.append(_block("Epic context", body))

    links = detail.get("links") or []
    if links:
        lines = [
            f"- **{l['relation']}** [{l['key']}]"
            + (f" — {l['summary']}" if l.get("summary") else "")
            + (f" *(status: {l['status']})*" if l.get("status") else "")
            for l in links
        ]
        blocks.append(_block("Linked issues", "\n".join(lines)))

    attachments = detail.get("attachments") or []
    if attachments:
        lines = [
            f"- `{a['filename']}` ({a.get('mimeType') or 'unknown type'}{', ' + _human_size(a.get('size')) if a.get('size') else ''})"
            for a in attachments
        ]
        blocks.append(_block(
            "Attachments (filenames only — contents not synced; fetch from Jira if needed)",
            "\n".join(lines),
        ))

    instruction_block = ""
    if instruction.strip():
        instruction_block = f"\n## Additional instructions\n\n{instruction.strip()}\n"

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
