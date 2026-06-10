"""Atlassian Document Format → plain text extractor."""


def adf_to_text(node, indent=0) -> str:
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""
    t = node.get("type", "")
    children = node.get("content", [])

    if t == "text":
        marks = {m["type"] for m in node.get("marks", [])}
        text = node.get("text", "")
        if "strong" in marks:
            text = f"**{text}**"
        if "em" in marks:
            text = f"_{text}_"
        return text
    if t == "hardBreak":
        return "\n"
    if t == "mention":
        return node.get("attrs", {}).get("text", "@?")
    if t == "inlineCard":
        return node.get("attrs", {}).get("url", "[link]")

    inner = "".join(adf_to_text(c, indent) for c in children)

    if t == "paragraph":
        return inner.strip() + "\n"
    if t == "heading":
        lvl = node.get("attrs", {}).get("level", 2)
        return "\n" + "#" * lvl + " " + inner.strip() + "\n"
    if t in ("bulletList", "orderedList"):
        lines = []
        for i, item in enumerate(children, 1):
            prefix = f"{i}. " if t == "orderedList" else "• "
            item_text = "".join(adf_to_text(c, indent + 1) for c in item.get("content", []))
            lines.append("  " * indent + prefix + item_text.strip())
        return "\n".join(lines) + "\n"
    if t in ("listItem", "blockquote", "doc"):
        return inner
    if t == "rule":
        return "\n---\n"
    return inner


def field_text(fields: dict, key: str) -> str:
    """Extract plain text from an ADF field or plain string field. Returns '' if absent/empty."""
    val = fields.get(key)
    if not val:
        return ""
    if isinstance(val, dict):
        return adf_to_text(val).strip()
    return str(val).strip()
