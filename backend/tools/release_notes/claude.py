"""AI generation logic for Release Notes."""

import pathlib

import ai as _ai

PROMPTS_DIR = pathlib.Path(__file__).parent / "prompts"

SIZE_INSTRUCTIONS = {
    "tiny": "Exactly 1 sentence.",
    "small": "2–3 sentences maximum.",
    "medium": "1–2 short paragraphs.",
    "full": "2–4 comprehensive paragraphs.",
}


def _format_issue(i: dict) -> str:
    lines = [
        f"[{i['key']}] {i['type']} | {i['priority']} | {i['status']}",
        f"Summary: {i['summary']}",
    ]
    if i.get("biz_context"):
        lines.append(f"Business context: {i['biz_context']}")
    if i.get("description"):
        lines.append(f"Description: {i['description']}")
    if i.get("steps_actual_expected"):
        lines.append(f"Steps / actual / expected: {i['steps_actual_expected']}")
    if i.get("expected_behavior"):
        lines.append(f"Expected behavior: {i['expected_behavior']}")
    return "\n".join(lines)


DEFAULTS = {"short": "tiny", "full": "small", "biz": "small"}

SECTION_LABELS = {
    "short": "Short Description",
    "full": "Full Description",
    "biz": "Business Justification",
}


def _issue_lines(issues: list) -> str:
    return "\n\n".join(_format_issue(i) for i in issues)


def build_prompt(version_info: dict, issues: list, sizes: dict) -> str:
    merged = {**DEFAULTS, **sizes}
    template = (PROMPTS_DIR / "release_notes.txt").read_text()
    return template.format(
        version_name=version_info["name"],
        project=version_info.get("project", ""),
        release_date=version_info.get("releaseDate") or "TBD",
        description=version_info.get("description") or "(none)",
        issue_count=len(issues),
        issue_lines=_issue_lines(issues),
        short_instruction=SIZE_INSTRUCTIONS.get(merged["short"], ""),
        full_instruction=SIZE_INSTRUCTIONS.get(merged["full"], ""),
        biz_instruction=SIZE_INSTRUCTIONS.get(merged["biz"], ""),
    )


def regenerate_section(
    config: dict,
    version_info: dict,
    issues: list,
    section: str,
    current_text: str,
    instruction: str,
) -> str:
    size_key = DEFAULTS.get(section, "small")
    instruction_block = (
        f"Additional instructions: {instruction}\n\n" if instruction.strip() else ""
    )
    template = (PROMPTS_DIR / "regenerate_section.txt").read_text()
    prompt = template.format(
        version_name=version_info["name"],
        project=version_info.get("project", ""),
        release_date=version_info.get("releaseDate") or "TBD",
        issue_count=len(issues),
        issue_lines=_issue_lines(issues),
        section_label=SECTION_LABELS.get(section, section),
        size_instruction=SIZE_INSTRUCTIONS.get(size_key, ""),
        current_text=current_text,
        instruction_block=instruction_block,
    )
    return _ai.complete(
        config,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1024,
    ).strip()


def generate_with_ai(
    config: dict, version_info: dict, issues: list, sizes: dict
) -> dict:
    prompt = build_prompt(version_info, issues, sizes)
    text = _ai.complete(
        config,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=4096,
    )

    def extract(t, start, end=None):
        lines, result, active = t.split("\n"), [], False
        for line in lines:
            if start in line:
                active = True
                continue
            if end and end in line:
                break
            if active:
                result.append(line)
        return "\n".join(result).strip()

    return {
        "prompt": prompt,
        "shortDescription": extract(
            text, "<<<SHORT_DESCRIPTION>>>", "<<<FULL_DESCRIPTION>>>"
        ),
        "fullDescription": extract(
            text, "<<<FULL_DESCRIPTION>>>", "<<<BUSINESS_JUSTIFICATION>>>"
        ),
        "businessJustification": extract(text, "<<<BUSINESS_JUSTIFICATION>>>"),
    }
