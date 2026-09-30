"""Stable platform labels for account-imported image groups."""

ACCOUNT_GROUP_PREFIXES = (
    ("psn_import_", "PS", ("PS", "PSN", "PlayStation"), "PSN"),
    ("xbox:", "Xbox", ("Xbox",), "Xbox"),
    ("nintendo:", "Nintendo", ("Nintendo",), "Nintendo"),
    ("steam_import_", "Steam", ("Steam",), "Steam"),
)


def format_account_group_name(group_id: str, name: str | None) -> str:
    """Prefix account groups, including legacy names, without changing custom groups."""
    for id_prefix, label, aliases, legacy_label in ACCOUNT_GROUP_PREFIXES:
        if not group_id.startswith(id_prefix):
            continue
        account_id = group_id[len(id_prefix):]
        display = (name or "").strip()
        for alias in aliases:
            if display.casefold().startswith(alias.casefold() + ":"):
                display = display[len(alias) + 1:].strip()
                break
        if display == f"{legacy_label} {account_id[:8]}":
            display = account_id[:8]
        return f"{label}:{display or account_id[:8]}"
    return name or ""
