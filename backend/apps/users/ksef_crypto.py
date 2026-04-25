"""KSeF certificate parsing and private-key encryption (Fernet, key derived from SECRET_KEY)."""

import base64
from dataclasses import dataclass
from datetime import date

from cryptography import x509
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import dsa, ec, rsa
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from django.conf import settings


# Static salt: master key is still Django SECRET_KEY; iteration count adds cost for offline guessing.
_FERNET_SALT = b"mojesaldoo-ksef-cert-fernet-v1"


def get_fernet() -> Fernet:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_FERNET_SALT,
        iterations=600_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(settings.SECRET_KEY.encode("utf-8")))
    return Fernet(key)


def encrypt_private_key_pem(pem_text: str) -> str:
    token = get_fernet().encrypt(pem_text.encode("utf-8"))
    return token.decode("ascii")


def decrypt_private_key_pem(encrypted: str) -> str:
    return get_fernet().decrypt(encrypted.encode("ascii")).decode("utf-8")


@dataclass
class ParsedCertificateBundle:
    certificate_pem: str
    private_key_pem: str
    subject_name: str
    valid_from: date
    valid_until: date


def _public_spki_bytes(public_key) -> bytes:
    return public_key.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )


def public_keys_match(certificate: x509.Certificate, private_key) -> bool:
    cert_k = certificate.public_key()
    priv_k = private_key.public_key()
    c_nums = _public_key_numbers_safe(cert_k)
    p_nums = _public_key_numbers_safe(priv_k)
    if c_nums is not None and p_nums is not None and type(c_nums) is type(p_nums):
        return c_nums == p_nums
    return _public_spki_bytes(cert_k) == _public_spki_bytes(priv_k)


def _public_key_numbers_safe(key):
    if isinstance(key, rsa.RSAPublicKey):
        return key.public_numbers()
    if isinstance(key, ec.EllipticCurvePublicKey):
        return key.public_numbers()
    if isinstance(key, dsa.DSAPublicKey):
        return key.public_numbers()
    return None


def parse_certificate_and_key(
    cert_bytes: bytes,
    key_bytes: bytes,
) -> ParsedCertificateBundle:
    if not cert_bytes.strip() or not key_bytes.strip():
        raise ValueError("Certificate and private key are required.")

    try:
        cert = x509.load_pem_x509_certificate(cert_bytes)
    except Exception as e:
        raise ValueError("Invalid or unreadable certificate PEM file.") from e

    try:
        private_key = serialization.load_pem_private_key(key_bytes, password=None)
    except Exception as e:
        raise ValueError("Invalid or unreadable private key PEM file.") from e

    if not public_keys_match(cert, private_key):
        raise ValueError("Private key does not match the certificate public key.")

    cert_pem = cert.public_bytes(serialization.Encoding.PEM).decode("utf-8")
    key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    not_before = getattr(cert, "not_valid_before_utc", cert.not_valid_before)
    not_after = getattr(cert, "not_valid_after_utc", cert.not_valid_after)
    valid_from = not_before.date()
    valid_until = not_after.date()
    # Prefer RFC 4514; fallback to string representation
    try:
        subject_name = cert.subject.rfc4514_string()
    except Exception:
        subject_name = str(cert.subject)

    if len(subject_name) > 255:
        subject_name = subject_name[:252] + "..."

    return ParsedCertificateBundle(
        certificate_pem=cert_pem,
        private_key_pem=key_pem,
        subject_name=subject_name,
        valid_from=valid_from,
        valid_until=valid_until,
    )
