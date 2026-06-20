"""
KSeF client — calls crypto.py directly (no external ssapi-multi process needed).

Public interface is unchanged so callers only need to swap `cookies` → `company_id`.
"""

import base64 as _b64
import logging
from datetime import timezone as dt_timezone

import requests as _requests

from . import crypto

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_ksef_session(company_id: str):
    """Return the KSeFSession for a company, raising RuntimeError if missing."""
    from .models import KSeFSession
    try:
        return KSeFSession.objects.get(company_id=company_id)
    except KSeFSession.DoesNotExist:
        raise RuntimeError("Brak sesji KSeF. Najpierw przeprowadź uwierzytelnienie.")


def _build_access_token(ksef_sess) -> crypto.Token:
    """Build a crypto.Token from the stored KSeFSession fields."""
    if not ksef_sess.access_token_body:
        raise RuntimeError("Brak tokena dostępu. Przeprowadź uwierzytelnienie KSeF.")
    if not ksef_sess.is_active():
        raise RuntimeError("Sesja KSeF wygasła. Zaloguj się ponownie.")
    return crypto.Token(
        token_type="access",
        body=ksef_sess.access_token_body,
        valid_until=ksef_sess.access_valid_until,
    )


def _aware(dt):
    """Ensure a datetime is timezone-aware (UTC if naive)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=dt_timezone.utc)
    return dt


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def check_session(company_id: str, nip: str = "") -> list:
    """
    Check whether there is an active KSeF session for a company.
    Returns a list with one token dict when active, empty list when not.
    """
    from .models import KSeFSession
    try:
        ksef_sess = KSeFSession.objects.get(company_id=company_id)
    except KSeFSession.DoesNotExist:
        return []
    if not ksef_sess.is_active():
        return []
    return [{
        "token_type": "access",
        "valid_until": ksef_sess.access_valid_until.isoformat(),
    }]


def authenticate(nip: str, passphrase: str, company_id: str) -> tuple[list, dict]:
    """
    Authenticate with KSeF using the certificate stored in KSeFCertificate.
    Runs the full challenge → sign → auth → redeem flow and persists the
    resulting access/refresh tokens in KSeFSession.

    Returns (tokens_list, {}) — the empty dict replaces the old cookies dict.

    Raises ValueError("ksef_auth_in_progress") if KSeF hasn't yet processed
    the authentication token (caller should retry).
    """
    from .models import KSeFSession
    from apps.users.models import KSeFCertificate
    from apps.users.ksef_crypto import decrypt_private_key_pem

    cert_row = KSeFCertificate.objects.filter(company_id=company_id, is_active=True).first()
    if not cert_row:
        raise ValueError("Brak aktywnego certyfikatu KSeF.")

    key_pem_bytes = decrypt_private_key_pem(cert_row.encrypted_key).encode()
    # Key may be passphrase-protected (originally uploaded encrypted) or plain PKCS8
    try:
        private_key = crypto.load_private_key_from_pem(key_pem_bytes, password=None)
    except TypeError:
        private_key = crypto.load_private_key_from_pem(
            key_pem_bytes,
            password=passphrase.encode() if passphrase else b"",
        )

    certificate = crypto.load_certificate_from_pem(cert_row.certificate_pem.encode())

    challenge = crypto.get_auth_challenge()
    request_doc = crypto.create_auth_token_request_document(challenge, nip)
    signed_doc = crypto.sign_auth_token_request(request_doc, private_key, certificate)
    reference = crypto.authenticate(signed_doc)

    try:
        access_token, refresh_token = crypto.get_tokens(reference.authentication_token)
    except crypto.TokenNotFoundInResponseError:
        raise ValueError("ksef_auth_in_progress")

    access_valid_until = _aware(access_token.valid_until)
    refresh_valid_until = _aware(refresh_token.valid_until) if refresh_token else None

    ksef_sess, _ = KSeFSession.objects.get_or_create(company_id=company_id)
    ksef_sess.access_token_body = access_token.body
    ksef_sess.refresh_token_body = refresh_token.body if refresh_token else ""
    ksef_sess.access_valid_until = access_valid_until
    ksef_sess.refresh_valid_until = refresh_valid_until
    ksef_sess.session_cookies_json = "{}"
    ksef_sess.save()

    logger.info("KSeF authentication succeeded for company %s (NIP %s)", company_id, nip)
    tokens = [{"token_type": "access", "valid_until": access_valid_until.isoformat()}]
    return tokens, {}


def send_invoice(
    invoice_base64: str,
    nip: str,
    shop: str,
    total_gross_cents: int,
    company_id: str,
) -> dict:
    """
    Encrypt and submit a Base64-encoded FA-3 XML invoice to KSeF.
    Stores the submission reference in KSeFSentInvoice for status polling.

    Returns {"outcome": {referenceNumber, ...}}.
    """
    from lxml import etree
    from .models import KSeFSentInvoice

    ksef_sess = _get_ksef_session(company_id)
    access_token = _build_access_token(ksef_sess)

    xml_data = _b64.b64decode(invoice_base64).decode()
    symmetric_key, iv = crypto.create_temporary_symmetric_key()
    _, invoice_cert = crypto.get_public_certificates()
    encrypted_key = crypto.encrypt_key(symmetric_key, invoice_cert)
    session = crypto.open_session(encrypted_key, access_token, iv)
    invoice_data = crypto.encrypt_invoice(xml_data, symmetric_key, iv)
    outcome = crypto.send_encrypted_invoice_data(invoice_data, access_token, session)

    # Extract P_1 (issue date) from XML for QR verification URL
    tree = etree.fromstring(xml_data.encode())
    issue_date_el = tree.find(".//{*}P_1")
    issue_date = issue_date_el.text if issue_date_el is not None else ""

    ref = outcome.get("referenceNumber", "")
    KSeFSentInvoice.objects.create(
        company_id=company_id,
        reference_number=ref,
        session_reference_number=session.reference_number,
        invoice_hash=invoice_data.get("invoiceHash", ""),
        issue_date=issue_date,
        shop=shop,
        total_gross_cents=total_gross_cents,
    )
    logger.info("Invoice sent to KSeF (ref: %s, shop: %s)", ref, shop)
    return {"outcome": outcome}


def push_certificate(nip: str, cert_pem: str, key_pem: str) -> None:
    """
    No-op after consolidation.
    The certificate is already stored in KSeFCertificate and loaded from DB at auth time.
    Kept for call-site compatibility.
    """
    logger.debug("push_certificate: no-op after ssapi-multi consolidation (NIP %s)", nip)


def query_received_invoices(
    nip: str,
    date_from: str,
    date_to: str,
    company_id: str,
    page_offset: int = 0,
    page_size: int = 50,
) -> dict:
    """Query invoices received as buyer for a date range from KSeF."""
    ksef_sess = _get_ksef_session(company_id)
    access_token = _build_access_token(ksef_sess)
    result = crypto.query_received_invoices(access_token, date_from, date_to, page_offset, page_size)
    logger.debug("query_received_invoices keys: %s", list(result.keys()))
    return result


def download_received_invoice(nip: str, ksef_reference_number: str, company_id: str) -> bytes:
    """Download a received invoice XML by KSeF reference number."""
    ksef_sess = _get_ksef_session(company_id)
    access_token = _build_access_token(ksef_sess)
    return crypto.download_received_invoice_xml(ksef_reference_number, access_token)


def get_invoice_status(reference_number: str, company_id: str) -> tuple[int, dict]:
    """
    Poll KSeF for invoice processing status.

    Returns (http_status_code, response_dict):
      202 — still processing (status code 100 or 150)
      200 — accepted (status code 200, ksef_number populated)
      400 — error status from KSeF
      404 — reference not found in local DB
    """
    from .models import KSeFSentInvoice

    ksef_sess = _get_ksef_session(company_id)
    access_token = _build_access_token(ksef_sess)

    sent_inv = KSeFSentInvoice.objects.filter(
        company_id=company_id, reference_number=reference_number
    ).first()
    if not sent_inv:
        return 404, {"detail": f"Nie znaleziono faktury o numerze referencyjnym: {reference_number}"}

    # Serve from cache if already accepted
    if sent_inv.status_code == crypto.KSEF_SUCCESS_STATUS_CODE:
        return 200, {
            "referenceNumber": reference_number,
            "ksefNumber": sent_inv.ksef_number,
            "invoiceNumber": sent_inv.invoice_number,
            "status": {
                "code": sent_inv.status_code,
                "description": sent_inv.status_description,
            },
            "upo": {"xml": None, "hash": None},
            "cached": True,
        }

    try:
        inv_status = crypto.get_invoice_status(
            sent_inv.session_reference_number,
            reference_number,
            access_token,
            allowed_codes=(100, 150, 200),
        )
    except crypto.InvalidInvoiceStatusError as err:
        return 400, {
            "referenceNumber": reference_number,
            "ksefNumber": err.status.ksef_number,
            "invoiceNumber": err.status.invoice_number,
            "status": {
                "code": err.status.status_code,
                "description": err.status.status_description,
            },
        }
    except _requests.HTTPError as exc:
        code = exc.response.status_code if exc.response is not None else 502
        return code, {"detail": str(exc)}

    # Still processing
    if inv_status.status_code in (100, 150):
        return 202, {
            "reason": {
                "status": {
                    "description": inv_status.status_description,
                    "status": inv_status.status_code,
                }
            }
        }

    # Success — close session, retrieve UPO
    try:
        crypto.close_session(sent_inv.session_reference_number, access_token)
    except Exception:
        logger.debug("Session %s already closed", sent_inv.session_reference_number)

    upo_xml, upo_hash = crypto.get_invoice_upo(
        sent_inv.session_reference_number, reference_number, access_token
    )

    sent_inv.ksef_number = inv_status.ksef_number or ""
    sent_inv.invoice_number = inv_status.invoice_number or ""
    sent_inv.status_code = inv_status.status_code
    sent_inv.status_description = inv_status.status_description
    sent_inv.upo_xml = upo_xml or ""
    sent_inv.upo_hash = upo_hash or ""
    sent_inv.save(update_fields=[
        "ksef_number", "invoice_number", "status_code", "status_description",
        "upo_xml", "upo_hash",
    ])

    return 200, {
        "referenceNumber": reference_number,
        "ksefNumber": inv_status.ksef_number,
        "invoiceNumber": inv_status.invoice_number,
        "status": {
            "code": inv_status.status_code,
            "description": inv_status.status_description,
        },
        "upo": {"xml": upo_xml, "hash": upo_hash},
        "cached": False,
    }
