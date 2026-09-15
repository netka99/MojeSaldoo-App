"""Turn nested DRF error payloads into a single user-readable sentence."""


def flatten_error_value(value) -> str:
    """Turn nested DRF error payloads (stock arrays, field errors) into one sentence."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, list):
        parts = [flatten_error_value(item) for item in value]
        return "; ".join(part for part in parts if part)
    if isinstance(value, dict):
        if "stock" in value and isinstance(value["stock"], list):
            items = []
            for row in value["stock"]:
                if isinstance(row, dict):
                    name = row.get("product_name") or row.get("product") or "produkt"
                    short = row.get("short_by") or row.get("missing") or ""
                    avail = row.get("quantity_available") or row.get("available") or ""
                    req = (
                        row.get("quantity_requested")
                        or row.get("quantity_to_consume")
                        or row.get("requested")
                        or ""
                    )
                    if short:
                        items.append(
                            f"{name}: brakuje {short} (jest {avail}, potrzeba {req})".strip()
                        )
                    else:
                        items.append(flatten_error_value(row))
                else:
                    items.append(str(row))
            return "Brak stanu: " + "; ".join(items) if items else ""
        skip = {"error_code", "status_code", "code"}
        parts = []
        for key, nested in value.items():
            if key in skip:
                continue
            flattened = flatten_error_value(nested)
            if not flattened:
                continue
            if key in {"detail", "error", "message", "non_field_errors"}:
                parts.append(flattened)
            else:
                parts.append(f"{key}: {flattened}")
        return "; ".join(parts)
    return str(value)
