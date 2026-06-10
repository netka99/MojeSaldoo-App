"""
HTTP client for SSAPI — the existing KSeF communication backend.
SSAPI handles: KSeF authentication, XML encryption, invoice submission, status polling.
Django only proxies data to/from SSAPI; it never talks to KSeF directly.
"""

import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

SSAPI_BASE_URL: str = getattr(settings, "SSAPI_BASE_URL", "")
TIMEOUT = 60  # seconds


def _base_url() -> str:
    if not SSAPI_BASE_URL:
        raise RuntimeError(
            "SSAPI_BASE_URL is not configured in Django settings. "
            "Add SSAPI_BASE_URL = 'https://...' to your settings.py."
        )
    return SSAPI_BASE_URL.rstrip("/")


def check_session(cookies: dict, nip: str = "") -> list:
    """
    GET /ksef-authentications?nip=...
    Returns list of active token objects, e.g.:
      [{"token_type": "access", "valid_until": "2026-06-10T12:00:00"}]
    Returns empty list if no active session.
    Raises requests.HTTPError on unexpected errors.
    """
    resp = requests.get(
        f"{_base_url()}/ksef-authentications",
        params={"nip": nip} if nip else {},
        cookies=cookies,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def authenticate(nip: str, passphrase: str) -> tuple[list, dict]:
    """
    POST /ksef-authentications
    Triggers full KSeF auth challenge/token flow on SSAPI side.

    Returns:
        (tokens, cookies_dict) where tokens is the JSON body (list of token objects)
        and cookies_dict maps cookie names to values for use in subsequent requests.

    Raises:
        ValueError: if SSAPI returns 422 (auth in progress, caller should retry)
        requests.HTTPError: on other HTTP errors
    """
    sess = requests.Session()
    resp = sess.post(
        f"{_base_url()}/ksef-authentications",
        json={"nip": nip, "passphrase": passphrase},
        timeout=TIMEOUT,
    )
    if resp.status_code == 422:
        raise ValueError("ksef_auth_in_progress")
    resp.raise_for_status()

    cookies = dict(sess.cookies)
    logger.info("KSeF auth successful for NIP %s, cookies: %s", nip, list(cookies.keys()))
    return resp.json(), cookies


def send_invoice(
    invoice_base64: str,
    nip: str,
    shop: str,
    total_gross_cents: int,
    cookies: dict,
) -> dict:
    """
    POST /invoices
    Submits Base64-encoded FA-3 XML to SSAPI for KSeF submission.

    Returns SSAPI response dict, e.g.:
        {"referenceNumber": "20260605-KZ-ABCD1234", "status": "sent"}

    Raises requests.HTTPError on failure.
    """
    resp = requests.post(
        f"{_base_url()}/invoices",
        json={
            "invoice": invoice_base64,
            "nip": nip,
            "shop": shop,
            "total_gross_cents": total_gross_cents,
        },
        cookies=cookies,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def push_certificate(nip: str, cert_pem: str, key_pem: str) -> None:
    """
    PUT /user-certificate
    Push PEM certificate and private key to ssapi-multi, scoped by NIP.
    This is called automatically after a Django certificate upload so the
    ssapi-multi filesystem stays in sync without manual curl commands.
    Raises requests.HTTPError on failure.
    """
    import base64 as _b64
    resp = requests.put(
        f"{_base_url()}/user-certificate",
        json={
            "nip": nip,
            "certificate": _b64.b64encode(cert_pem.encode()).decode(),
            "key": _b64.b64encode(key_pem.encode()).decode(),
        },
        timeout=TIMEOUT,
    )
    resp.raise_for_status()


def query_received_invoices(
    nip: str,
    date_from: str,
    date_to: str,
    cookies: dict,
    page_offset: int = 0,
    page_size: int = 50,
) -> dict:
    """
    GET /received-invoices?nip=...&date_from=...&date_to=...
    Returns KSeF response dict with invoiceHeaderList, pageOffset, numberOfElements.
    date_from / date_to: ISO 8601 datetime strings, e.g. "2026-01-01T00:00:00.000Z"
    """
    resp = requests.get(
        f"{_base_url()}/received-invoices",
        params={
            "nip": nip,
            "date_from": date_from,
            "date_to": date_to,
            "page_offset": page_offset,
            "page_size": page_size,
        },
        cookies=cookies,
        timeout=TIMEOUT,
    )
    if not resp.ok:
        # Surface the actual KSeF error from ssapi-multi's response body
        try:
            detail = resp.json().get("detail") or resp.json().get("outcome") or resp.text
        except Exception:
            detail = resp.text
        raise RuntimeError(f"ssapi {resp.status_code}: {detail}")
    return resp.json()


def download_received_invoice(nip: str, ksef_reference_number: str, cookies: dict) -> bytes:
    """
    GET /received-invoices/{ksef_ref}?nip=...
    Returns raw bytes of the invoice XML (may be compressed).
    """
    resp = requests.get(
        f"{_base_url()}/received-invoices/{ksef_reference_number}",
        params={"nip": nip},
        cookies=cookies,
        timeout=TIMEOUT,
    )
    resp.raise_for_status()
    return resp.content


def get_invoice_status(reference_number: str, cookies: dict) -> tuple[int, dict]:
    """
    GET /invoices/{reference_number}
    Polls SSAPI for invoice processing status.

    Returns:
        (http_status_code, response_dict)
        202 = still processing
        200 with data["status"]["code"] == 200 = accepted
    """
    resp = requests.get(
        f"{_base_url()}/invoices/{reference_number}",
        cookies=cookies,
        timeout=TIMEOUT,
    )
    return resp.status_code, resp.json()
