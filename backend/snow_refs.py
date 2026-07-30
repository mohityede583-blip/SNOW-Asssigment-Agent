"""
Helpers for working with ServiceNow reference fields.

A reference field in the SNOW Table API can come back in either of these shapes:
    - a plain string  (when `sysparm_display_value=true`)
    - a dict          (when `sysparm_display_value=false`)
        {
            "link":          "https://dev.../api/now/table/sys_user/<sys_id>",
            "value":         "<sys_id>",
            "display_value": "<human name>"
        }

We persist references in the `incidents` table as JSON strings of the dict
form. The rest of the app consumes the *display* name as a plain string
(e.g. `assigned_to == "Alice Smith"`), so `ref_display()` is the one place
that knows how to unwrap whatever shape happens to come through.
"""

import json


def ref_display(ref, default=None):
    """
    Extract a human-readable string from a reference.

    Accepts:
      - dict   {value, display_value, link}
      - str    a JSON string of such a dict, OR a plain display name
      - None
      - anything else  -> returned unchanged (defensive)
    """
    if ref is None:
        return default

    if isinstance(ref, dict):
        return ref.get("display_value") or ref.get("value") or default

    if isinstance(ref, str):
        # A JSON-encoded dict is the on-disk form for the *_ref columns.
        if ref.startswith("{"):
            try:
                obj = json.loads(ref)
                if isinstance(obj, dict):
                    return obj.get("display_value") or obj.get("value") or default
            except (ValueError, TypeError):
                pass
        # Otherwise it's already a plain display name.
        return ref

    return ref


def as_ref_json(value):
    """
    Build a JSON string of {value, display_value, link} from a SNOW field
    that may be either a plain string, a dict, None, or empty.

    Returns None when there's nothing to store.
    """
    if value is None or value == "":
        return None

    if isinstance(value, dict):
        return json.dumps({
            "value":         value.get("value"),
            "display_value": value.get("display_value") or value.get("value"),
            "link":          value.get("link"),
        })

    # Plain string: no link, no sys_id; just stash the display name.
    return json.dumps({"value": None, "display_value": str(value), "link": None})


def display_value(value, default=None):
    """
    Return the human-readable string for a SNOW field that may be either a
    plain string or a {link, value, display_value} dict. The current API
    calls (with sysparm_display_value=true) always return the display form,
    but the future call shape with display_value=false would return dicts,
    so we handle both.
    """
    return ref_display(value, default=default)
