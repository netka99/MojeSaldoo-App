"""
KSeF session management endpoints.
These proxy authentication to the SSAPI backend.
"""

import logging
import re
import xml.etree.ElementTree as ET

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.permissions import HasCompanyPermission, IsCompanyMember

from django.http import HttpResponse

from apps.products.models import Product
from apps.suppliers.models import Supplier
from .models import KSeFSession, KSeFProductMapping, ReceivedKSeFInvoice, ReceivedKSeFInvoiceLine
from . import ssapi_client

FA3_NS = "http://crd.gov.pl/wzor/2025/06/25/13775/"


def _annotation_status(inv: "ReceivedKSeFInvoice") -> str | None:
    """Return the accounting_status from InvoiceAnnotation if it exists, else None."""
    try:
        return inv.annotation.accounting_status
    except Exception:
        return None


def _invoice_to_dict(inv: "ReceivedKSeFInvoice", pz_docs=None) -> dict:
    """Serialize a ReceivedKSeFInvoice to the same shape the KSeF API returns.

    pz_docs: pre-fetched list of linked DeliveryDocument objects (avoids N+1 queries).
    When None, fetches lazily (single invoice use).
    """
    if pz_docs is None:
        pz_docs = list(inv.pz_documents.only("id", "document_number").all())

    return {
        "id": str(inv.id),
        "ksefNumber": inv.ksef_number,
        "invoiceNumber": inv.invoice_number,
        "issueDate": inv.issue_date.isoformat() if inv.issue_date else None,
        "invoicingDate": inv.invoicing_date.isoformat() if inv.invoicing_date else None,
        "seller": {"nip": inv.seller_nip, "name": inv.seller_name},
        "buyer": {"nip": inv.buyer_nip, "name": inv.buyer_name},
        "netAmount": float(inv.net_amount) if inv.net_amount is not None else None,
        "grossAmount": float(inv.gross_amount) if inv.gross_amount is not None else None,
        "vatAmount": float(inv.vat_amount) if inv.vat_amount is not None else None,
        "currency": inv.currency,
        "invoiceType": inv.invoice_type,
        "originalKsefNumber": inv.original_ksef_number or None,
        "firstSeenAt": inv.first_seen_at.isoformat(),
        "annotationStatus": _annotation_status(inv),
        "opex_category": inv.opex_category,
        "opex_tagged_at": inv.opex_tagged_at.isoformat() if inv.opex_tagged_at else None,
        "pzDocuments": [
            {"id": str(d.id), "documentNumber": d.document_number, "status": d.status}
            for d in pz_docs
        ],
    }

logger = logging.getLogger(__name__)


class KSeFSessionView(APIView):
    """
    GET  /api/ksef/session/       — check active session for current company
    POST /api/ksef/session/       — authenticate (NIP + passphrase), store session
    DELETE /api/ksef/session/     — clear stored session
    """

    required_permission = 'can_manage_invoices'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def get(self, request):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            ksef_sess = KSeFSession.objects.get(company=company)
        except KSeFSession.DoesNotExist:
            return Response({"active": False, "tokens": []})

        if not ksef_sess.is_active():
            return Response({"active": False, "tokens": []})

        tokens = ssapi_client.check_session(str(company.id))
        return Response({
            "active": len(tokens) > 0,
            "tokens": tokens,
            "access_valid_until": (
                ksef_sess.access_valid_until.isoformat() if ksef_sess.access_valid_until else None
            ),
        })

    def post(self, request):
        """Authenticate with KSeF via SSAPI. Body: {nip, passphrase}"""
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        passphrase = request.data.get("passphrase", "").strip()
        if not passphrase:
            return Response(
                {"detail": "'passphrase' is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # NIP comes from the company record, not from the request body
        nip = (company.nip or "").strip()
        if not nip:
            return Response(
                {"detail": "Uzupełnij NIP firmy przed uwierzytelnieniem KSeF."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            tokens, _cookies = ssapi_client.authenticate(nip, passphrase, str(company.id))
        except ValueError as exc:
            if "ksef_auth_in_progress" in str(exc):
                return Response(
                    {"detail": "Uwierzytelnianie KSeF w trakcie, spróbuj ponownie za chwilę."},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            logger.error("KSeF authenticate error: %s", exc)
            return Response(
                {"detail": f"Błąd uwierzytelnienia KSeF: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        ksef_sess = KSeFSession.objects.get(company=company)
        return Response({
            "active": True,
            "tokens": tokens,
            "access_valid_until": (
                ksef_sess.access_valid_until.isoformat() if ksef_sess.access_valid_until else None
            ),
        })

    def delete(self, request):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)
        KSeFSession.objects.filter(company=company).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReceivedInvoicesView(APIView):
    """
    GET /api/ksef/inbox/
    Sync new invoices from KSeF into local DB, then return from DB.
    Params: date_from, date_to (YYYY-MM-DD or ISO 8601), page, page_size
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def get(self, request):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        nip = (company.nip or "").strip()

        date_from = request.query_params.get("date_from", "").strip()
        date_to = request.query_params.get("date_to", "").strip()

        try:
            page = max(1, int(request.query_params.get("page", 1)))
            page_size = min(int(request.query_params.get("page_size", 20)), 100)
        except ValueError:
            page, page_size = 1, 50

        # Serve from DB instantly — dates are optional filters
        from datetime import date as date_type
        df, dt = None, None
        if date_from:
            try:
                df = date_type.fromisoformat(date_from[:10])
            except ValueError:
                pass
        if date_to:
            try:
                dt = date_type.fromisoformat(date_to[:10])
            except ValueError:
                pass

        qs = ReceivedKSeFInvoice.objects.filter(company=company).select_related("annotation")
        if df:
            qs = qs.filter(issue_date__gte=df)
        if dt:
            qs = qs.filter(issue_date__lte=dt)
        qs = qs.order_by("-issue_date", "-first_seen_at")

        total = qs.count()
        offset = (page - 1) * page_size
        page_qs = list(qs.prefetch_related("pz_documents")[offset: offset + page_size])

        # Build pz_docs map per invoice to avoid N+1
        pz_map: dict = {}
        for inv in page_qs:
            pz_map[inv.pk] = list(inv.pz_documents.all())

        invoices = [_invoice_to_dict(inv, pz_docs=pz_map.get(inv.pk, [])) for inv in page_qs]

        return Response({
            "invoices": invoices,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_more": offset + page_size < total,
            "new_count": 0,
            "sync_error": None,
        })

    @staticmethod
    def _sync_from_ksef(company, nip, date_from, date_to) -> int:
        """Pull all pages from KSeF for the given date range and upsert into DB.
        Downloads XML for newly seen invoices so they're available without a session.
        Returns new count."""
        company_id = str(company.id)
        page_offset = 0
        page_size = 100
        total_new = 0
        while True:
            result = ssapi_client.query_received_invoices(
                nip=nip,
                date_from=date_from,
                date_to=date_to,
                company_id=company_id,
                page_offset=page_offset,
                page_size=page_size,
            )
            invoices = result.get("invoices", [])
            if not invoices:
                break
            new_count, new_objects = ReceivedKSeFInvoice.upsert_from_ksef(company, invoices)
            total_new += new_count

            # Download and store XML for newly seen invoices
            for obj in new_objects:
                try:
                    xml_bytes = ssapi_client.download_received_invoice(
                        nip=nip,
                        ksef_reference_number=obj.ksef_number,
                        company_id=company_id,
                    )
                    _store_invoice_xml(obj, xml_bytes, company)
                except Exception as exc:
                    logger.warning("Sync: failed to download XML for %s: %s", obj.ksef_number, exc)

            if not result.get("hasMore", False):
                break
            page_offset += page_size
        return total_new


class ReceivedInvoicesSyncView(APIView):
    """
    POST /api/ksef/inbox/sync/
    Sync new invoices from KSeF into local DB for the given date range.
    Body: { date_from: "YYYY-MM-DD", date_to: "YYYY-MM-DD" }
    Returns: { new_count, total }
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def post(self, request):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        nip = (company.nip or "").strip()
        if not nip:
            return Response({"detail": "Uzupełnij NIP firmy."}, status=status.HTTP_400_BAD_REQUEST)

        date_from = request.data.get("date_from", "").strip()
        date_to = request.data.get("date_to", "").strip()
        if not date_from or not date_to:
            return Response({"detail": "Wymagane: date_from, date_to."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            ksef_sess = KSeFSession.objects.get(company=company)
        except KSeFSession.DoesNotExist:
            return Response({"detail": "Brak aktywnej sesji KSeF."}, status=status.HTTP_401_UNAUTHORIZED)

        if not ksef_sess.is_active():
            return Response({"detail": "Sesja KSeF wygasła."}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            new_count = ReceivedInvoicesView._sync_from_ksef(company, nip, date_from, date_to)
        except Exception as exc:
            logger.error("KSeF sync failed: %s", exc)
            return Response({"detail": f"Błąd synchronizacji: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

        total = ReceivedKSeFInvoice.objects.filter(company=company).count()
        return Response({"new_count": new_count, "total": total})


class ReceivedInvoiceDownloadView(APIView):
    """
    GET /api/ksef/inbox/<ksef_reference_number>/xml/
    Download a received invoice XML from KSeF.
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def get(self, request, ksef_reference_number: str):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        nip = (company.nip or "").strip()

        try:
            ksef_sess = KSeFSession.objects.get(company=company)
        except KSeFSession.DoesNotExist:
            return Response({"detail": "Brak aktywnej sesji KSeF."}, status=status.HTTP_401_UNAUTHORIZED)

        if not ksef_sess.is_active():
            return Response({"detail": "Sesja KSeF wygasła."}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            xml_bytes = ssapi_client.download_received_invoice(
                nip=nip,
                ksef_reference_number=ksef_reference_number,
                company_id=str(company.id),
            )
        except Exception as exc:
            logger.error("KSeF download received invoice failed (ref: %s): %s", ksef_reference_number, exc)
            return Response({"detail": f"Błąd pobierania: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

        http_resp = HttpResponse(xml_bytes, content_type="application/octet-stream")
        http_resp["Content-Disposition"] = f'attachment; filename="{ksef_reference_number}.xml"'
        return http_resp


class ReceivedInvoiceParseView(APIView):
    """
    GET /api/ksef/inbox/<ksef_reference_number>/parse/
    Download invoice XML from KSeF, parse FA-3 line items, and attempt product/supplier auto-match.
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def get(self, request, ksef_reference_number: str):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        db_invoice = ReceivedKSeFInvoice.objects.filter(
            company=company, ksef_number=ksef_reference_number
        ).prefetch_related("lines").first()

        # Step 1: lines already cached in DB — instant, no session needed
        if db_invoice and db_invoice.lines_cached:
            return Response(_invoice_parsed_from_db(db_invoice, company))

        # Step 2: XML stored in DB — parse it, no session needed
        if db_invoice and db_invoice.xml_content:
            try:
                result = _parse_fa3_invoice(db_invoice.xml_content.encode("utf-8"), company)
                # Update address + correction fields if not yet stored
                update_fields = []
                if not db_invoice.seller_address_l1 and result.get("seller_address_l1"):
                    db_invoice.seller_address_l1 = result["seller_address_l1"][:512]
                    db_invoice.seller_address_l2 = result.get("seller_address_l2", "")[:512]
                    db_invoice.seller_country = result.get("seller_country", "")[:10]
                    update_fields += ["seller_address_l1", "seller_address_l2", "seller_country"]
                if result.get("invoice_type") and not db_invoice.invoice_type:
                    db_invoice.invoice_type = result["invoice_type"][:50]
                    update_fields.append("invoice_type")
                if result.get("original_ksef_number") and not db_invoice.original_ksef_number:
                    db_invoice.original_ksef_number = result["original_ksef_number"][:255]
                    update_fields.append("original_ksef_number")
                if update_fields:
                    db_invoice.save(update_fields=update_fields)
                _cache_invoice_lines(db_invoice, ksef_reference_number, company, result)
                _enrich_result_with_pz(result, db_invoice)
                return Response(result)
            except Exception as exc:
                logger.warning("Parse from stored XML failed for %s: %s — falling back to KSeF", ksef_reference_number, exc)

        # Step 3: download from KSeF (requires active session)
        nip = (company.nip or "").strip()
        try:
            ksef_sess = KSeFSession.objects.get(company=company)
        except KSeFSession.DoesNotExist:
            return Response({"detail": "Brak aktywnej sesji KSeF."}, status=status.HTTP_401_UNAUTHORIZED)

        if not ksef_sess.is_active():
            return Response({"detail": "Sesja KSeF wygasła."}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            xml_bytes = ssapi_client.download_received_invoice(
                nip=nip,
                ksef_reference_number=ksef_reference_number,
                company_id=str(company.id),
            )
        except Exception as exc:
            logger.error("KSeF parse: download failed (ref: %s): %s", ksef_reference_number, exc)
            return Response({"detail": f"Błąd pobierania XML: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

        try:
            result = _parse_fa3_invoice(xml_bytes, company)
        except Exception as exc:
            logger.error("KSeF parse: XML parsing failed (ref: %s): %s", ksef_reference_number, exc)
            return Response({"detail": f"Błąd parsowania XML: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Store XML + address + lines for future requests (no session needed next time)
        if db_invoice:
            _store_invoice_xml(db_invoice, xml_bytes, company)
            _enrich_result_with_pz(result, db_invoice)
        else:
            _cache_invoice_lines(None, ksef_reference_number, company, result)

        return Response(result)


def _enrich_result_with_pz(result: dict, db_invoice: "ReceivedKSeFInvoice") -> None:
    """Mutates a parsed-invoice result dict to add PZ tracking fields."""
    pz_docs = list(db_invoice.pz_documents.only("id", "document_number", "status").all())
    result["pz_documents"] = [
        {"id": str(d.id), "documentNumber": d.document_number, "status": d.status}
        for d in pz_docs
    ]
    if pz_docs:
        pz_by_pos = _pz_info_by_line_position(db_invoice)
        for i, line in enumerate(result.get("lines", [])):
            line["existing_pz_documents"] = pz_by_pos.get(i, [])


def _pz_info_by_line_position(db_invoice: "ReceivedKSeFInvoice") -> dict:
    """
    Returns a dict mapping invoice line position → list of {id, documentNumber}
    for all PZ documents that took items from that line.
    """
    from apps.delivery.models import DeliveryItem

    pz_items = (
        DeliveryItem.objects.filter(
            delivery_document__ksef_invoice=db_invoice,
            ksef_invoice_line_position__isnull=False,
        )
        .select_related("delivery_document")
        .only("ksef_invoice_line_position", "delivery_document__id", "delivery_document__document_number", "delivery_document__status")
    )

    by_pos: dict = {}
    seen: set = set()
    for item in pz_items:
        pos = item.ksef_invoice_line_position
        doc = item.delivery_document
        key = (pos, str(doc.id))
        if key in seen:
            continue
        seen.add(key)
        by_pos.setdefault(pos, []).append(
            {"id": str(doc.id), "documentNumber": doc.document_number, "status": doc.status}
        )
    return by_pos


def _invoice_parsed_from_db(db_invoice: "ReceivedKSeFInvoice", company) -> dict:
    """Serve parsed invoice data from DB cache — no KSeF call needed."""
    suggested_supplier_id = None
    suggested_supplier_name = None
    if db_invoice.seller_nip:
        supplier = Supplier.objects.filter(nip=db_invoice.seller_nip, company=company).first()
        if supplier:
            suggested_supplier_id = str(supplier.id)
            suggested_supplier_name = supplier.name

    # Pre-load all mappings for this seller in one query
    mappings = {}
    if db_invoice.seller_nip:
        for m in KSeFProductMapping.objects.filter(
            company=company, seller_nip=db_invoice.seller_nip
        ).select_related("product"):
            mappings[m.invoice_line_name.lower()] = m.product

    # Per-line PZ info (which PZ documents already took this line)
    pz_by_pos = _pz_info_by_line_position(db_invoice)

    lines = []
    for ln in db_invoice.lines.all():
        # Mapping table takes priority over name-based match
        product = mappings.get(ln.name.lower())
        if product is None:
            product = Product.objects.filter(name__iexact=ln.name, company=company).first()
        lines.append({
            "name": ln.name,
            "unit": ln.unit,
            "quantity": float(ln.quantity),
            "unit_net_price": float(ln.unit_net_price),
            "vat_rate": ln.vat_rate,
            "line_net": float(ln.line_net),
            "suggested_product_id": str(product.id) if product else None,
            "suggested_product_name": product.name if product else None,
            "existing_pz_documents": pz_by_pos.get(ln.position, []),
        })

    return {
        "invoice_number": db_invoice.invoice_number,
        "issue_date": db_invoice.issue_date.isoformat() if db_invoice.issue_date else "",
        "seller_nip": db_invoice.seller_nip,
        "seller_name": db_invoice.seller_name,
        "seller_country": db_invoice.seller_country,
        "seller_address_l1": db_invoice.seller_address_l1,
        "seller_address_l2": db_invoice.seller_address_l2,
        "suggested_supplier_id": suggested_supplier_id,
        "suggested_supplier_name": suggested_supplier_name,
        "lines": lines,
        "pz_documents": [
            {"id": str(d.id), "documentNumber": d.document_number, "status": d.status}
            for d in db_invoice.pz_documents.only("id", "document_number", "status").all()
        ],
    }


def _store_invoice_xml(db_invoice: "ReceivedKSeFInvoice", xml_bytes: bytes, company) -> None:
    """
    Store raw XML and parse address + lines into DB.
    Called after first download — makes subsequent expands session-free.
    """
    xml_str = xml_bytes.decode("utf-8", errors="replace")
    update_fields = ["xml_content"]
    db_invoice.xml_content = xml_str
    try:
        parsed = _parse_fa3_invoice(xml_bytes, company)
        db_invoice.seller_address_l1 = parsed.get("seller_address_l1", "")[:512]
        db_invoice.seller_address_l2 = parsed.get("seller_address_l2", "")[:512]
        db_invoice.seller_country = parsed.get("seller_country", "")[:10]
        update_fields += ["seller_address_l1", "seller_address_l2", "seller_country"]
        # Persist invoice type + correction reference extracted from XML
        if parsed.get("invoice_type"):
            db_invoice.invoice_type = parsed["invoice_type"][:50]
            update_fields.append("invoice_type")
        if parsed.get("original_ksef_number"):
            db_invoice.original_ksef_number = parsed["original_ksef_number"][:255]
            update_fields.append("original_ksef_number")
        db_invoice.save(update_fields=update_fields)
        if not db_invoice.lines_cached:
            _cache_invoice_lines(db_invoice, db_invoice.ksef_number, company, parsed)
    except Exception as exc:
        logger.warning("_store_invoice_xml: parse failed for %s: %s", db_invoice.ksef_number, exc)
        db_invoice.save(update_fields=update_fields)


def _cache_invoice_lines(db_invoice, ksef_number: str, company, parsed: dict) -> None:
    """Save parsed line items to DB so future calls are served from cache."""
    if db_invoice is None:
        # Invoice not in DB yet (e.g. manually downloaded without prior sync)
        db_invoice = ReceivedKSeFInvoice.objects.filter(
            company=company, ksef_number=ksef_number
        ).first()
    if db_invoice is None:
        return
    if db_invoice.lines_cached:
        return
    ReceivedKSeFInvoiceLine.objects.bulk_create([
        ReceivedKSeFInvoiceLine(
            invoice=db_invoice,
            position=i,
            name=ln["name"],
            unit=ln["unit"],
            quantity=ln["quantity"],
            unit_net_price=ln["unit_net_price"],
            vat_rate=ln["vat_rate"],
            line_net=ln["line_net"],
        )
        for i, ln in enumerate(parsed.get("lines", []))
    ])


def _parse_fa3_invoice(xml_bytes: bytes, company) -> dict:
    """Parse FA-3 XML and return structured invoice data with product/supplier suggestions."""
    ns = FA3_NS
    root = ET.fromstring(xml_bytes)

    def find(node, tag):
        return node.find(f"{{{ns}}}{tag}")

    def text(node, tag, default=""):
        el = find(node, tag)
        return (el.text or "").strip() if el is not None else default

    # Header: Fa element
    fa = find(root, "Fa")
    if fa is None:
        raise ValueError("Brak elementu Fa w dokumencie XML")

    invoice_number = text(fa, "P_2")
    issue_date = text(fa, "P_1")

    # Invoice type (RodzajFaktury): VAT | KOR | ZAL | ROZ | UPR | KOR_ZAL | KOR_ROZ
    invoice_type = text(fa, "RodzajFaktury") or "VAT"

    # For correction invoices: reference to the original invoice (DaneFaKorygowanej)
    # An invoice can correct multiple originals (up to 50 000), we only need the first KSeF ref.
    original_ksef_number = ""
    kor_ref_el = find(fa, "DaneFaKorygowanej")
    if kor_ref_el is not None:
        # Only populated when NrKSeF == "1" (original was in KSeF)
        nr_ksef_flag = (kor_ref_el.find(f"{{{ns}}}NrKSeF") or None)
        if nr_ksef_flag is not None and (nr_ksef_flag.text or "").strip() == "1":
            original_ksef_number = text(kor_ref_el, "NrKSeFFaKorygowanej")

    # Seller: Podmiot1 > DaneIdentyfikacyjne + Adres
    seller_node = find(root, "Podmiot1")
    seller_nip = ""
    seller_name = ""
    seller_country = ""
    seller_address_l1 = ""
    seller_address_l2 = ""
    if seller_node is not None:
        dane = find(seller_node, "DaneIdentyfikacyjne")
        if dane is not None:
            seller_nip = text(dane, "NIP")
            seller_name = text(dane, "PelnaNazwa") or text(dane, "Nazwa")
        adres = find(seller_node, "Adres")
        if adres is not None:
            seller_country = text(adres, "KodKraju")
            seller_address_l1 = text(adres, "AdresL1")
            seller_address_l2 = text(adres, "AdresL2")

    # Try to find matching supplier by NIP
    suggested_supplier_id = None
    suggested_supplier_name = None
    if seller_nip:
        supplier = Supplier.objects.filter(nip=seller_nip, company=company).first()
        if supplier:
            suggested_supplier_id = str(supplier.id)
            suggested_supplier_name = supplier.name

    # Pre-load product mappings for this seller in one query
    mappings = {}
    if seller_nip:
        for m in KSeFProductMapping.objects.filter(
            company=company, seller_nip=seller_nip
        ).select_related("product"):
            mappings[m.invoice_line_name.lower()] = m.product

    # Line items: FaWiersz elements
    lines = []
    for row in fa.findall(f"{{{ns}}}FaWiersz"):
        def t(tag):
            el = row.find(f"{{{ns}}}{tag}")
            return (el.text or "").strip() if el is not None else ""

        name = t("P_7")
        unit = t("P_8A")
        try:
            quantity = float(t("P_8B") or 0)
        except ValueError:
            quantity = 0.0
        try:
            unit_net_price = float(t("P_9A") or 0)
        except ValueError:
            unit_net_price = 0.0
        vat_rate = t("P_12")
        try:
            line_net = float(t("P_11") or 0) or round(quantity * unit_net_price, 2)
        except ValueError:
            line_net = round(quantity * unit_net_price, 2)

        # Mapping table takes priority over name-based match
        suggested_product_id = None
        suggested_product_name = None
        if name:
            product = mappings.get(name.lower())
            if product is None:
                product = Product.objects.filter(name__iexact=name, company=company).first()
            if product:
                suggested_product_id = str(product.id)
                suggested_product_name = product.name

        lines.append({
            "name": name,
            "unit": unit,
            "quantity": quantity,
            "unit_net_price": unit_net_price,
            "vat_rate": vat_rate,
            "line_net": line_net,
            "suggested_product_id": suggested_product_id,
            "suggested_product_name": suggested_product_name,
            "existing_pz_documents": [],
        })

    return {
        "invoice_number": invoice_number,
        "issue_date": issue_date,
        "invoice_type": invoice_type,
        "original_ksef_number": original_ksef_number,
        "seller_nip": seller_nip,
        "seller_name": seller_name,
        "seller_country": seller_country,
        "seller_address_l1": seller_address_l1,
        "seller_address_l2": seller_address_l2,
        "suggested_supplier_id": suggested_supplier_id,
        "suggested_supplier_name": suggested_supplier_name,
        "lines": lines,
        "pz_documents": [],  # populated by caller once db_invoice is known
    }


class KSeFProductMappingView(APIView):
    """
    POST /api/ksef/product-mappings/
    Save product mappings for a seller so future imports auto-fill them.
    Body: { seller_nip: str, mappings: [{invoice_line_name: str, product_id: str}] }
    Idempotent — upserts on (company, seller_nip, invoice_line_name).
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def post(self, request):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        seller_nip = (request.data.get("seller_nip") or "").strip()[:20]
        mappings = request.data.get("mappings") or []

        if not seller_nip:
            return Response({"detail": "seller_nip required."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(mappings, list):
            return Response({"detail": "mappings must be a list."}, status=status.HTTP_400_BAD_REQUEST)

        saved = 0
        for item in mappings:
            name = (item.get("invoice_line_name") or "").strip()
            product_id = (item.get("product_id") or "").strip()
            if not name or not product_id:
                continue
            try:
                product = Product.objects.get(uuid=product_id, company=company)
            except (Product.DoesNotExist, Exception):
                continue
            KSeFProductMapping.objects.update_or_create(
                company=company,
                seller_nip=seller_nip,
                invoice_line_name=name,
                defaults={"product": product},
            )
            saved += 1

        return Response({"saved": saved})


class InvoiceOpexTagView(APIView):
    """
    PATCH /api/ksef/inbox/<ksef_reference_number>/opex/
    Body: { opex_category: "utilities"|"rent"|"services"|"transport"|"marketing"|"other"|null }

    Tags or clears the OPEX category on a received KSeF invoice.
    Setting opex_category=null clears the tag.
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def patch(self, request, ksef_reference_number: str):
        from django.utils import timezone as _tz

        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            invoice = ReceivedKSeFInvoice.objects.get(
                company=company, ksef_number=ksef_reference_number
            )
        except ReceivedKSeFInvoice.DoesNotExist:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

        category = request.data.get("opex_category")
        valid_categories = {c[0] for c in ReceivedKSeFInvoice.OPEX_CATEGORY_CHOICES}

        if category is None:
            invoice.opex_category = None
            invoice.opex_tagged_at = None
        elif category in valid_categories:
            invoice.opex_category = category
            invoice.opex_tagged_at = _tz.now()
        else:
            return Response(
                {"opex_category": f"Must be one of: {', '.join(sorted(valid_categories))} or null."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice.save(update_fields=["opex_category", "opex_tagged_at"])
        return Response({
            "ksef_number": invoice.ksef_number,
            "opex_category": invoice.opex_category,
            "opex_tagged_at": invoice.opex_tagged_at,
        })


# ---------------------------------------------------------------------------
# KOR match helper — finds the original PZ for a correction invoice
# ---------------------------------------------------------------------------

class KorMatchView(APIView):
    """
    GET /api/ksef/inbox/<ksef_reference_number>/kor-match/

    For a KOR invoice, returns the linked original ReceivedKSeFInvoice and any
    active PZ documents attached to it — ready to pre-fill a PZ-KOR flow.

    Response shape:
    {
        "original_ksef_number": "...",
        "original_invoice": { ksefNumber, invoiceNumber, issueDate, seller },
        "pz_documents": [{ id, documentNumber, status, items: [...] }],
        "matched": true|false   // false when original not found or has no PZ
    }
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def get(self, request, ksef_reference_number: str):
        from apps.delivery.serializers import DeliveryDocumentSerializer

        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            kor_invoice = ReceivedKSeFInvoice.objects.get(
                company=company, ksef_number=ksef_reference_number
            )
        except ReceivedKSeFInvoice.DoesNotExist:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

        if not kor_invoice.original_ksef_number:
            return Response(
                {"detail": "This invoice has no original KSeF reference. Download and parse XML first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        original = ReceivedKSeFInvoice.objects.filter(
            company=company, ksef_number=kor_invoice.original_ksef_number
        ).prefetch_related("pz_documents__items__product").first()

        if not original:
            return Response({
                "original_ksef_number": kor_invoice.original_ksef_number,
                "original_invoice": None,
                "pz_documents": [],
                "matched": False,
            })

        active_pzs = [
            d for d in original.pz_documents.all()
            if d.status not in ("cancelled",)
        ]

        pz_list = []
        for pz in active_pzs:
            items = []
            for item in pz.items.select_related("product").all():
                items.append({
                    "id": str(item.id),
                    "productId": str(item.product_id) if item.product_id else None,
                    "productName": item.product.name if item.product else item.product_name or "",
                    "quantity": float(item.quantity_actual or item.quantity_ordered or 0),
                    "unitCost": float(item.unit_cost or 0),
                    "unit": item.unit or "",
                })
            pz_list.append({
                "id": str(pz.id),
                "documentNumber": pz.document_number,
                "status": pz.status,
                "issueDate": pz.issue_date.isoformat() if pz.issue_date else None,
                "items": items,
            })

        return Response({
            "original_ksef_number": kor_invoice.original_ksef_number,
            "original_invoice": {
                "ksefNumber": original.ksef_number,
                "invoiceNumber": original.invoice_number,
                "issueDate": original.issue_date.isoformat() if original.issue_date else None,
                "seller": {"nip": original.seller_nip, "name": original.seller_name},
            },
            "pz_documents": pz_list,
            "matched": len(pz_list) > 0,
        })


# ---------------------------------------------------------------------------
# Paper invoice scanner (OCR)
# ---------------------------------------------------------------------------

def _ocr_image(image_file) -> str:
    """Run Tesseract OCR on an uploaded image. Returns raw text, or empty string if unavailable."""
    try:
        import pytesseract  # noqa: PLC0415
        from PIL import Image  # noqa: PLC0415

        # On Windows, Tesseract is rarely on PATH — point directly to the binary.
        import os, sys  # noqa: PLC0415
        if sys.platform == "win32":
            for candidate in [
                r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                r"C:\Tesseract-OCR\tesseract.exe",
            ]:
                if os.path.isfile(candidate):
                    pytesseract.pytesseract.tesseract_cmd = candidate
                    break

        img = Image.open(image_file)
        return pytesseract.image_to_string(img, lang="pol+eng")
    except ImportError:
        return ""
    except Exception as exc:  # noqa: BLE001
        logging.warning("OCR failed: %s", exc)
        return ""


def _parse_invoice_fields(text: str) -> dict:
    """Best-effort extraction of Polish invoice/receipt header fields from OCR text.

    Handles both VAT invoices (faktury) and fiscal receipts (paragony).
    """
    # --- Seller NIP ---
    # "NIP NABYWCY" is the buyer NIP — skip it and take the seller NIP that appears first.
    seller_nip = ""
    seller_nip_match = re.search(
        r"NIP\s*:?\s*(?!NABYWCY)(\d[\d\s\-]{7,11}\d)",
        text,
        re.IGNORECASE,
    )
    if seller_nip_match:
        seller_nip = re.sub(r"[\s\-]", "", seller_nip_match.group(1))[:10]
    else:
        # Fallback: first bare 10-digit sequence
        nip_match = re.search(r"\b(\d{10})\b", text)
        if nip_match:
            seller_nip = nip_match.group(1)

    # --- Document number ---
    # VAT invoice: FV/2026/001, FA/2026/001, etc.
    inv_match = re.search(
        r"(?:Faktura\s*VAT|Faktura|Nr\s*faktury|Numer)\s*[:\s]*([A-Z]{1,3}[/\-]\d{4}[/\-]\d+|[A-Z]{2,4}\s+\d{4}/\d+)",
        text,
        re.IGNORECASE,
    )
    if inv_match:
        invoice_number = inv_match.group(1).strip()
    else:
        # Paragon/receipt: "nr:480130" or "nr : 299183"
        nr_match = re.search(r"\bnr\s*[:\.]?\s*(\d{4,8})\b", text, re.IGNORECASE)
        invoice_number = nr_match.group(1) if nr_match else ""

    # --- Issue date ---
    # DD.MM.YYYY (invoices) — take priority
    date_match = re.search(r"\b(\d{2})[.](\d{2})[.](\d{4})\b", text)
    if date_match:
        issue_date = f"{date_match.group(3)}-{date_match.group(2)}-{date_match.group(1)}"
    else:
        # ISO YYYY-MM-DD (paragony show date like "2026-06-10 18:47")
        # Require year 20xx and valid month/day ranges to avoid barcode false-positives.
        iso_match = re.search(
            r"\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b", text
        )
        issue_date = f"{iso_match.group(1)}-{iso_match.group(2)}-{iso_match.group(3)}" if iso_match else ""

    # --- Total gross ---
    # Invoices: "Do zapłaty", "Razem brutto", "Łącznie"
    # Receipts: "SUMA PLN" — value may be on the same line or the next non-empty line
    total_match = re.search(
        r"(?:Do\s*zap[łl]aty|Razem\s*brutto|[ŁL][ąa]cznie|Suma\s*brutto|SUMA\s+PLN|Suma\s+PLN|Kwota\s+do\s+zap[łl]aty)"
        r"[\s\n]*[:\s]?\s*([\d\s]+[,.]\s?\d{2})",
        text,
        re.IGNORECASE | re.MULTILINE,
    )
    if total_match:
        raw = total_match.group(1).replace(" ", "").replace(",", ".")
        try:
            float(raw)
            total_gross = raw
        except ValueError:
            total_gross = ""
    else:
        total_gross = ""

    # Fallback: if SUMA PLN found but value missing (OCR failure),
    # sum up individual line totals — the last number on each product price line.
    # e.g. "2,144kg. x18,99  40,71C" → 40.71
    if not total_gross and re.search(r"SUMA\s+PLN", text, re.IGNORECASE):
        line_total_re = re.compile(
            r"\d+[,.]\d*\s*(?:kg|szt|l|g)?[.,]?\s*[xX]\s*[\d,.]+\s+([\d,.\s]+)[A-Za-z]?$",
            re.IGNORECASE,
        )
        running = 0.0
        for ln in text.splitlines():
            m = line_total_re.search(ln.strip())
            if m:
                try:
                    running += float(m.group(1).replace(" ", "").replace(",", "."))
                except ValueError:
                    pass
        if running > 0:
            total_gross = f"{running:.2f}"

    # --- Seller name ---
    # Look for lines containing common Polish company legal-form keywords.
    name_match = re.search(
        r"^(.{3,80}(?:Sp\.?\s*z\s*o\.?o\.?|\bS\.?\s*A\.?\b|S-ka\s+jawna|spółka\s+jawna|partnerska|komandytowa|\bLtd\.?\b|\bGmbH\b|S-ka).{0,40})$",
        text,
        re.MULTILINE,  # no IGNORECASE — avoids "sa" in "Visa"
    )
    seller_name = name_match.group(1).strip() if name_match else ""

    return {
        "seller_name": seller_name,
        "seller_nip": seller_nip,
        "invoice_number": invoice_number,
        "issue_date": issue_date,
        "total_gross": total_gross,
    }


def _parse_receipt_lines(text: str) -> list:
    """Extract product lines from a Polish fiscal receipt (paragon) OCR text.

    Handles:
      1. Name on own line, qty+price on next (As Bylak format):
            FILETY ŚLEDZIOWE ALA MATJAS KGC
                            2,144kg. x18,99  40,71C
      2. Name + qty+price on same line (Biedronka inline format):
            Ogórek grunt luz   C   2,690 x9,99  26,87C
      3. Discounts (OPUST) — effective price = after-discount amount / qty:
            Zestaw do kiszenia  C   2 x4,99  9,98C
            OPUST                          -3,00C
                                            6,98      ← actual paid
    Returns list of dicts: [{name, quantity, unit, unit_price}]
    """
    raw_lines = [ln.strip() for ln in text.splitlines()]

    # Core price segment: qty [unit] x unit_price  line_total[VAT_letter]
    # Multiply sign may be x, X, ×, «, ¥, * (OCR variants)
    price_seg = re.compile(
        r"([\d,]+)\s*(kg|szt|l|g|ml|op)?[.,]?\s*[xX×«¥\*]\s*([\d,]+)\s+([\d,.\s]+)[A-Za-z]?\s*$",
        re.IGNORECASE,
    )
    # After-discount amount line: may have noise prefix like ": " or "ee " or "j "
    # We just need a decimal number somewhere on the line, nothing else substantial
    amount_re = re.compile(r"^[^0-9]*([\d]+[,.][\d]{2})\s*[A-Za-z]?\s*$")
    # Opust/rabat line
    opust_re = re.compile(r"^OPUST|^RABAT", re.IGNORECASE)
    # Lines to skip entirely
    skip_re = re.compile(
        r"OPUST|RABAT|SUMA|PTU|SPRZEDA|RAZEM|KARTA|PARAGON|NIP|FISKALN|ROZLICZ"
        r"|Udzielono|Numer|BDO|EAO|Nr\s|transakcj|Promoc|Sp:|łącznie",
        re.IGNORECASE,
    )
    # VAT category suffix: trailing " C", " A", " KGC", " KG.C" etc.
    vat_suffix = re.compile(r"\s+[A-Z]{0,2}\.?[A-Z]\s*$")

    # --- Pass 1: collect raw parsed entries with lookahead for OPUST ---
    # Each entry: {name, qty, unit, list_price, line_total}
    entries = []
    pending_name: str | None = None
    i = 0

    non_empty = [(idx, ln) for idx, ln in enumerate(raw_lines) if ln.strip()]

    j = 0
    while j < len(non_empty):
        _idx, line = non_empty[j]

        if skip_re.search(line) and not opust_re.match(line):
            pending_name = None
            j += 1
            continue

        m = price_seg.search(line)
        if m:
            qty_raw = m.group(1).replace(",", ".")
            unit = (m.group(2) or "").lower().strip(".") or "szt"
            price_raw = m.group(3).replace(",", ".")
            total_raw = m.group(4).replace(" ", "").replace(",", ".")

            prefix = vat_suffix.sub("", line[:m.start()]).strip()
            name = prefix if len(prefix) > 2 else pending_name

            try:
                qty = float(qty_raw)
                price = float(price_raw)
                total = float(total_raw)
                if qty > 0 and price > 0 and name:
                    # Look ahead: is the next non-empty line an OPUST?
                    after_discount = total  # default = no discount
                    if j + 1 < len(non_empty):
                        _, next_line = non_empty[j + 1]
                        if opust_re.match(next_line):
                            # Skip OPUST line, then read the actual paid amount
                            if j + 2 < len(non_empty):
                                _, amt_line = non_empty[j + 2]
                                am = amount_re.match(amt_line)
                                if am:
                                    try:
                                        after_discount = float(am.group(1).replace(",", "."))
                                        j += 2  # skip OPUST + amount lines
                                    except ValueError:
                                        pass
                    # Effective unit price = actual paid / qty
                    eff_price = round(after_discount / qty, 4) if qty > 0 else price
                    entries.append({
                        "name": name,
                        "quantity": str(qty),
                        "unit": unit,
                        "unit_price": str(eff_price),
                    })
            except ValueError:
                pass
            pending_name = None

        elif re.search(r"[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,}", line) and not re.search(r"\d{4,}", line):
            pending_name = vat_suffix.sub("", line).strip()
        # else: keep pending_name (may be noise between name and price line)

        j += 1

    return entries


class PaperScanView(APIView):
    """Accept an image upload, run OCR, return extracted invoice fields.

    POST /api/ksef/scan-paper/
    Content-Type: multipart/form-data
    Body: image (file)

    Response: { seller_name, seller_nip, invoice_number, issue_date, total_gross, raw_text, lines }
    OCR is best-effort: fields may be empty when extraction fails.
    lines: [{name, quantity, unit_price}] — product lines parsed from receipt (may be empty).
    """

    required_permission = 'can_manage_invoices'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def post(self, request):
        image_file = request.FILES.get("image")
        if not image_file:
            return Response({"detail": "No image provided."}, status=status.HTTP_400_BAD_REQUEST)

        raw_text = _ocr_image(image_file)
        parsed = _parse_invoice_fields(raw_text)
        parsed["raw_text"] = raw_text
        parsed["lines"] = _parse_receipt_lines(raw_text)

        return Response(parsed)
