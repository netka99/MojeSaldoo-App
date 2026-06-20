"""
KSeF cryptography and API communication.
Consolidated from ssapi-multi/kseflib.py — no file I/O, no external service dependencies.
All state (tokens, certs) is managed by callers via Django models.
"""

import base64
import datetime
import hashlib
import logging
import os
import re
import time
from dataclasses import dataclass
from typing import Iterable, Literal

import requests
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives import padding as symmetric_padding
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.serialization import Encoding, load_pem_private_key
from cryptography.x509 import Certificate, load_pem_x509_certificate
from lxml import etree
from signxml import methods
from signxml.xades import XAdESSigner

KSEF_API_HOST = "api-test.ksef.mf.gov.pl"
KSEF_API_VERSION = "2"
KSEF_SUCCESS_STATUS_CODE = 200
REQUEST_TIMEOUT = 60  # seconds

challenge_pattern_rxp = re.compile(r"^[A-Z0-9\-]+$")
nip_pattern_rxp = re.compile(r"^[0-9]+$")

logger = logging.getLogger(__name__)

auth_token_request_tmpl = """<?xml version="1.0" encoding="utf-8"?>
<AuthTokenRequest xmlns="http://ksef.mf.gov.pl/auth/token/2.0"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Challenge>$CHALLENGE</Challenge>
  <ContextIdentifier>
    <Nip>$NIP</Nip>
  </ContextIdentifier>
  <SubjectIdentifierType>certificateSubject</SubjectIdentifierType>
</AuthTokenRequest>"""


class TokenNotFoundInResponseError(Exception):
    """The expected token was not found in the KSeF response."""


class InvalidInvoiceStatusError(Exception):
    """An unexpected invoice status was received from KSeF."""

    def __init__(self, status: "InvoiceStatus"):
        self.status = status
        super().__init__(str(status))


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class RemoteCertificate:
    body: str
    usage: list[str]
    valid_from: datetime.datetime
    valid_to: datetime.datetime

    @classmethod
    def from_dict(cls, ns: dict) -> "RemoteCertificate":
        return cls(
            body=ns["certificate"],
            usage=ns["usage"],
            valid_from=datetime.datetime.fromisoformat(ns["validFrom"]),
            valid_to=datetime.datetime.fromisoformat(ns["validTo"]),
        )

    def as_pem_str(self) -> str:
        return f"-----BEGIN CERTIFICATE-----\n{self.body}\n-----END CERTIFICATE-----"


@dataclass
class Challenge:
    body: str
    timestamp: datetime.datetime

    @classmethod
    def from_dict(cls, ns: dict) -> "Challenge":
        return cls(
            body=ns["challenge"],
            timestamp=datetime.datetime.fromisoformat(ns["timestamp"]),
        )


@dataclass
class AuthenticationToken:
    body: str
    valid_until: datetime.datetime

    @classmethod
    def from_dict(cls, ns: dict) -> "AuthenticationToken":
        return cls(
            body=ns["token"],
            valid_until=datetime.datetime.fromisoformat(ns["validUntil"]),
        )


@dataclass
class Reference:
    number: str
    authentication_token: AuthenticationToken

    @classmethod
    def from_dict(cls, ns: dict) -> "Reference":
        return cls(
            number=ns["referenceNumber"],
            authentication_token=AuthenticationToken.from_dict(ns["authenticationToken"]),
        )


@dataclass
class Token:
    token_type: Literal["access", "refresh"] | None
    body: str
    valid_until: datetime.datetime

    @classmethod
    def from_dict(cls, ns: dict, token_type: str | None) -> "Token":
        return cls(
            token_type=token_type,
            body=ns["token"],
            valid_until=datetime.datetime.fromisoformat(ns["validUntil"]),
        )


TokenTuple = tuple["Token | None", "Token | None"]


@dataclass
class Session:
    reference_number: str
    valid_until: datetime.datetime

    @classmethod
    def from_dict(cls, ns: dict) -> "Session":
        return cls(
            reference_number=ns["referenceNumber"],
            valid_until=datetime.datetime.fromisoformat(ns["validUntil"]),
        )


@dataclass
class InvoiceStatus:
    reference_number: str
    ksef_number: str | None
    invoice_number: str | None
    status_code: int
    status_description: str
    upo_download_url: str | None

    @classmethod
    def from_dict(cls, data: dict) -> "InvoiceStatus":
        status_info = data["status"]
        return cls(
            reference_number=data["referenceNumber"],
            ksef_number=data.get("ksefNumber"),
            invoice_number=data.get("invoiceNumber"),
            status_code=status_info["code"],
            status_description=status_info["description"],
            upo_download_url=data.get("upoDownloadUrl"),
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _timed_request(method, url: str, **kwargs) -> requests.Response:
    kwargs.setdefault("timeout", REQUEST_TIMEOUT)
    t0 = time.time()
    method_name = getattr(method, "__name__", "?").upper()
    logger.debug("-> %s %s", method_name, url)
    resp = method(url, **kwargs)
    logger.debug(
        "<- %s %s status=%d in %.3fs",
        method_name, url, resp.status_code, time.time() - t0,
    )
    return resp


# ---------------------------------------------------------------------------
# Key / certificate loaders (from bytes, not files)
# ---------------------------------------------------------------------------

def load_private_key_from_pem(
    pem_bytes: bytes,
    password: bytes | None = None,
) -> RSAPrivateKey | EllipticCurvePrivateKey:
    """Load a private key from PEM bytes. Pass password if the key is encrypted."""
    return load_pem_private_key(pem_bytes, password=password, backend=default_backend())


def load_certificate_from_pem(pem_bytes: bytes) -> Certificate:
    """Load a certificate from PEM bytes."""
    return load_pem_x509_certificate(pem_bytes, backend=default_backend())


# ---------------------------------------------------------------------------
# KSeF API functions
# ---------------------------------------------------------------------------

def get_public_certificates() -> tuple[RemoteCertificate, RemoteCertificate]:
    """Fetch KSeF encryption certificates (auth cert + invoice cert)."""
    url = f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}/security/public-key-certificates"
    response = _timed_request(requests.get, url, headers={"Content-Type": "application/json"})
    if response.status_code != 200:
        raise Exception("Failed to get public certificates")
    certs = (RemoteCertificate.from_dict(ns) for ns in response.json())
    auth_cert = next(certs)
    invoice_cert = next(certs)
    try:
        next(certs)
    except StopIteration:
        return (auth_cert, invoice_cert)
    raise Exception("Unsupported: more than two certificates returned by KSeF.")


def get_auth_challenge() -> Challenge:
    """Request an authentication challenge from KSeF."""
    url = f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}/auth/challenge"
    response = _timed_request(requests.post, url)
    response.raise_for_status()
    return Challenge.from_dict(response.json())


def create_auth_token_request_document(challenge: Challenge, nip: str) -> str:
    """Build the XML auth token request body."""
    if not challenge_pattern_rxp.match(challenge.body):
        raise ValueError(f"Invalid challenge body: {challenge.body}")
    if not nip_pattern_rxp.match(nip):
        raise ValueError(f"Invalid NIP: {nip}")
    doc = auth_token_request_tmpl.replace("$CHALLENGE", challenge.body)
    return doc.replace("$NIP", nip)


def sign_auth_token_request(
    request_doc: str,
    key: RSAPrivateKey | EllipticCurvePrivateKey,
    cert: Certificate,
) -> str:
    """Sign the auth token request XML with XAdES-BES (enveloped)."""
    cert_pem = cert.public_bytes(encoding=Encoding.PEM)
    parser = etree.XMLParser(ns_clean=True, resolve_entities=False, no_network=True)
    root = etree.fromstring(request_doc.encode(), parser)
    signature_algorithm = "ecdsa-sha256" if hasattr(key, "curve") else "rsa-sha256"
    signer = XAdESSigner(
        method=methods.enveloped,
        signature_algorithm=signature_algorithm,
        digest_algorithm="sha256",
        c14n_algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    )
    signed_root = signer.sign(root, key=key, cert=cert_pem.decode())
    return etree.tostring(signed_root, encoding="unicode")


def authenticate(signed_doc: str) -> Reference:
    """Submit the signed auth request to KSeF and get an auth reference."""
    url = f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}/auth/xades-signature"
    response = _timed_request(
        requests.post, url, data=signed_doc, headers={"Content-Type": "application/xml"}
    )
    response.raise_for_status()
    return Reference.from_dict(response.json())


def get_tokens(auth_token: AuthenticationToken) -> TokenTuple:
    """Redeem an authentication token for access + refresh tokens."""
    url = f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}/auth/token/redeem"
    response = _timed_request(
        requests.post, url, headers={"Authorization": f"Bearer {auth_token.body}"}
    )
    token_ns = response.json()
    try:
        access_token = token_ns["accessToken"]
        refresh_token = token_ns["refreshToken"]
    except KeyError as exc:
        raise TokenNotFoundInResponseError(
            f"Could not find required token in response: {response.text}"
        ) from exc
    return (
        Token.from_dict(access_token, token_type="access"),
        Token.from_dict(refresh_token, token_type="refresh"),
    )


def create_temporary_symmetric_key() -> tuple[bytes, bytes]:
    """Generate a random AES-256 key and IV for invoice encryption."""
    return (os.urandom(32), os.urandom(16))


def encrypt_key(symmetric_key: bytes, public_cert: RemoteCertificate) -> bytes:
    """Encrypt the symmetric key using the KSeF public certificate (RSA-OAEP)."""
    ksef_cert = load_pem_x509_certificate(public_cert.as_pem_str().encode())
    return ksef_cert.public_key().encrypt(
        symmetric_key,
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )


def open_session(encrypted_key: bytes, access_token: Token, iv: bytes) -> Session:
    """Open an online KSeF session for invoice submission."""
    url = f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}/sessions/online"
    session_data = {
        "formCode": {"systemCode": "FA (3)", "schemaVersion": "1-0E", "value": "FA"},
        "encryption": {
            "encryptedSymmetricKey": base64.b64encode(encrypted_key).decode("ascii"),
            "InitializationVector": base64.b64encode(iv).decode("ascii"),
        },
    }
    response = _timed_request(
        requests.post,
        url,
        json=session_data,
        headers={"Authorization": f"Bearer {access_token.body}", "Content-Type": "application/json"},
    )
    response.raise_for_status()
    return Session.from_dict(response.json())


def encrypt_invoice(invoice_xml: str, symmetric_key: bytes, iv: bytes) -> dict:
    """Encrypt invoice XML with AES-256-CBC and return the submission payload."""
    invoice_bytes = invoice_xml.encode()
    clear_hash = hashlib.sha256(invoice_bytes).digest()
    padder = symmetric_padding.PKCS7(128).padder()
    padded_data = padder.update(invoice_bytes) + padder.finalize()
    cipher = Cipher(algorithms.AES(symmetric_key), modes.CBC(iv))
    encryptor = cipher.encryptor()
    encrypted_invoice = encryptor.update(padded_data) + encryptor.finalize()
    encrypted_hash = hashlib.sha256(encrypted_invoice).digest()
    return {
        "invoiceHash": base64.b64encode(clear_hash).decode("ascii"),
        "invoiceSize": len(invoice_bytes),
        "encryptedInvoiceHash": base64.b64encode(encrypted_hash).decode("ascii"),
        "encryptedInvoiceSize": len(encrypted_invoice),
        "encryptedInvoiceContent": base64.b64encode(encrypted_invoice).decode("ascii"),
        "offlineMode": False,
        "hashOfCorrectedInvoice": None,
    }


def send_encrypted_invoice_data(
    encrypted_invoice_data: dict, access_token: Token, session: Session
) -> dict:
    """Submit an encrypted invoice to the open KSeF session."""
    url = (
        f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}"
        f"/sessions/online/{session.reference_number}/invoices"
    )
    response = _timed_request(
        requests.post,
        url,
        json=encrypted_invoice_data,
        headers={"Authorization": f"Bearer {access_token.body}", "Content-Type": "application/json"},
    )
    response.raise_for_status()
    return response.json()


def get_invoice_status(
    session_reference_number: str,
    invoice_reference_number: str,
    access_token: Token,
    allowed_codes: Iterable[int] = (200,),
) -> InvoiceStatus:
    """Poll KSeF for the processing status of a submitted invoice.

    Raises InvalidInvoiceStatusError if status code is not in allowed_codes.
    Status codes: 100 (accepted), 150 (processing), 200 (success), 4xx (error).
    """
    url = (
        f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}"
        f"/sessions/{session_reference_number}/invoices/{invoice_reference_number}"
    )
    response = _timed_request(
        requests.get,
        url,
        headers={"Authorization": f"Bearer {access_token.body}", "Content-Type": "application/json"},
    )
    response.raise_for_status()
    inv_status = InvoiceStatus.from_dict(response.json())
    if inv_status.status_code in allowed_codes:
        return inv_status
    raise InvalidInvoiceStatusError(inv_status)


def close_session(session_reference_number: str, access_token: Token) -> None:
    """Close an online KSeF session. Must be called before retrieving UPO."""
    url = (
        f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}"
        f"/sessions/online/{session_reference_number}/close"
    )
    response = _timed_request(
        requests.post,
        url,
        headers={"Authorization": f"Bearer {access_token.body}", "Content-Type": "application/json"},
    )
    response.raise_for_status()


def get_invoice_upo(
    session_reference_number: str,
    invoice_reference_number: str,
    access_token: Token,
) -> tuple[str, str]:
    """Retrieve the UPO (official receipt XML) for an accepted invoice.

    Returns (upo_xml_content, sha256_hash).
    """
    url = (
        f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}"
        f"/sessions/{session_reference_number}/invoices/{invoice_reference_number}/upo"
    )
    response = _timed_request(
        requests.get,
        url,
        headers={"Authorization": f"Bearer {access_token.body}", "Accept": "application/xml"},
    )
    response.raise_for_status()
    return (response.text, response.headers.get("x-ms-meta-hash", ""))


def query_received_invoices(
    access_token: Token,
    date_from: str,
    date_to: str,
    page_offset: int = 0,
    page_size: int = 50,
) -> dict:
    """Query invoices received as a buyer (subjectType=Subject2) from KSeF.

    date_from / date_to: ISO 8601 datetime strings e.g. "2026-01-01T00:00:00.000Z".
    Returns KSeF response with invoiceHeaderList, pageOffset, numberOfElements.
    """
    url = f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}/invoices/query/metadata"
    payload = {
        "subjectType": "Subject2",
        "dateRange": {"dateType": "Issue", "from": date_from, "to": date_to},
    }
    response = _timed_request(
        requests.post,
        url,
        json=payload,
        params={"pageOffset": page_offset, "pageSize": page_size},
        headers={"Authorization": f"Bearer {access_token.body}", "Content-Type": "application/json"},
    )
    response.raise_for_status()
    return response.json()


def download_received_invoice_xml(ksef_reference_number: str, access_token: Token) -> bytes:
    """Download a received invoice XML by its KSeF reference number."""
    url = f"https://{KSEF_API_HOST}/v{KSEF_API_VERSION}/invoices/ksef/{ksef_reference_number}"
    response = _timed_request(
        requests.get,
        url,
        headers={"Authorization": f"Bearer {access_token.body}"},
    )
    response.raise_for_status()
    return response.content
