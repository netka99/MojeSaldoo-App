"""
KSeF session management endpoints.
These proxy authentication to the SSAPI backend.
"""

import logging
import os
import re
import xml.etree.ElementTree as ET

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.users.permissions import HasCompanyPermission, IsCompanyMember

from django.http import HttpResponse
from django.utils import timezone

from apps.products.models import Product
from apps.suppliers.models import Supplier
from apps.activity.log import log_activity
from apps.activity.models import ActivityLog
from .models import KSeFSession, KSeFProductMapping, ReceivedKSeFInvoice, ReceivedKSeFInvoiceLine
from apps.cash_flow.models import OPEX_CATEGORY_CHOICES
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
        "isPaid": inv.is_paid,
        "dueDate": inv.due_date.isoformat() if inv.due_date else None,
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
            log_activity(
                user=request.user, action="ksef.auth",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_NO_NIP_COMPANY",
                request=request,
            )
            return Response(
                {"detail": "Uzupełnij NIP firmy przed uwierzytelnieniem KSeF."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            tokens, _cookies = ssapi_client.authenticate(nip, passphrase, str(company.id))
        except ValueError as exc:
            if "ksef_auth_in_progress" in str(exc):
                log_activity(
                    user=request.user, action="ksef.auth",
                    status=ActivityLog.STATUS_WARNING, error_code="KSEF_AUTH_IN_PROGRESS",
                    error_detail=str(exc), request=request,
                )
                return Response(
                    {"detail": "Uwierzytelnianie KSeF w trakcie, spróbuj ponownie za chwilę."},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            log_activity(
                user=request.user, action="ksef.auth",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_AUTH_FAILED",
                error_detail=str(exc), request=request,
            )
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            logger.error("KSeF authenticate error: %s", exc)
            log_activity(
                user=request.user, action="ksef.auth",
                status=ActivityLog.STATUS_ERROR, error_code="KSEF_AUTH_FAILED",
                error_detail=str(exc), request=request,
            )
            return Response(
                {"detail": f"Błąd uwierzytelnienia KSeF: {exc}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        log_activity(user=request.user, action="ksef.auth", status=ActivityLog.STATUS_SUCCESS)
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

        is_paid_param = request.query_params.get("is_paid", "").strip().lower()

        qs = ReceivedKSeFInvoice.objects.filter(company=company).select_related("annotation")
        if df:
            qs = qs.filter(issue_date__gte=df)
        if dt:
            qs = qs.filter(issue_date__lte=dt)
        if is_paid_param == "false":
            qs = qs.filter(is_paid=False)
        elif is_paid_param == "true":
            qs = qs.filter(is_paid=True)
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
    Download a received invoice XML — serves from DB cache first, falls back to KSeF API.
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def get(self, request, ksef_reference_number: str):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        # Step 1: serve from DB cache if available (works for demo data too)
        db_invoice = ReceivedKSeFInvoice.objects.filter(
            company=company, ksef_number=ksef_reference_number
        ).first()
        if db_invoice and db_invoice.xml_content:
            xml_bytes = db_invoice.xml_content.encode("utf-8")
            http_resp = HttpResponse(xml_bytes, content_type="application/xml; charset=utf-8")
            http_resp["Content-Disposition"] = f'attachment; filename="{ksef_reference_number}.xml"'
            return http_resp

        # Step 2: fall back to live KSeF API
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

        if db_invoice:
            _store_invoice_xml(db_invoice, xml_bytes, company)

        http_resp = HttpResponse(xml_bytes, content_type="application/xml; charset=utf-8")
        http_resp["Content-Disposition"] = f'attachment; filename="{ksef_reference_number}.xml"'
        return http_resp


class ReceivedInvoiceHtmlView(APIView):
    """
    GET /api/ksef/inbox/<ksef_reference_number>/html/
    Render a KSeF-style HTML preview of a received invoice.
    Serves from DB cache; falls back to live KSeF API if xml_content is missing.
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

        xml_str: str | None = None

        if db_invoice and db_invoice.xml_content:
            xml_str = db_invoice.xml_content
        else:
            nip = (company.nip or "").strip()
            try:
                ksef_sess = KSeFSession.objects.get(company=company)
                if ksef_sess.is_active():
                    xml_bytes = ssapi_client.download_received_invoice(
                        nip=nip,
                        ksef_reference_number=ksef_reference_number,
                        company_id=str(company.id),
                    )
                    xml_str = xml_bytes.decode("utf-8", errors="replace")
                    if db_invoice:
                        _store_invoice_xml(db_invoice, xml_bytes, company)
            except Exception:
                pass

        if not xml_str:
            if db_invoice:
                html = _render_invoice_html_from_db(db_invoice)
                return HttpResponse(html, content_type="text/html; charset=utf-8")
            return Response({"detail": "Brak XML faktury."}, status=status.HTTP_404_NOT_FOUND)

        try:
            html = _render_invoice_html_from_xml(xml_str, ksef_reference_number)
        except Exception as exc:
            logger.error("HTML render failed for %s: %s", ksef_reference_number, exc)
            if db_invoice:
                html = _render_invoice_html_from_db(db_invoice)
            else:
                return Response({"detail": f"Błąd renderowania: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return HttpResponse(html, content_type="text/html; charset=utf-8")


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
            line["existing_pz_documents"] = pz_by_pos.get(line.get("position", i), [])


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
            "position": ln.position,
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
        # Save due_date only if not already set manually
        if not db_invoice.due_date:
            if parsed.get("due_date"):
                db_invoice.due_date = parsed["due_date"]
            elif db_invoice.issue_date:
                # No TerminyPlatnosci in XML — default to 30 days per PL payment terms law
                import datetime as _dt
                db_invoice.due_date = db_invoice.issue_date + _dt.timedelta(days=30)
            update_fields.append("due_date")
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
            position=ln.get("position", i),
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

    # Payment due date: Platnosci > TerminyPlatnosci > Termin (last / latest date wins)
    due_date_parsed = None
    platnosci_el = find(fa, "Platnosci")
    if platnosci_el is not None:
        terminy = platnosci_el.findall(f"{{{ns}}}TerminyPlatnosci")
        dates = []
        for t_el in terminy:
            termin_text = (t_el.find(f"{{{ns}}}Termin") or None)
            if termin_text is not None and termin_text.text:
                try:
                    from datetime import date as _date
                    dates.append(_date.fromisoformat(termin_text.text.strip()[:10]))
                except ValueError:
                    pass
        if dates:
            due_date_parsed = max(dates)  # latest term is the binding one

    # Line items: FaWiersz elements
    lines = []
    for line_idx, row in enumerate(fa.findall(f"{{{ns}}}FaWiersz")):
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
            "position": line_idx,
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
        "due_date": due_date_parsed,
        "suggested_supplier_id": suggested_supplier_id,
        "suggested_supplier_name": suggested_supplier_name,
        "lines": lines,
        "pz_documents": [],  # populated by caller once db_invoice is known
    }


def _html_escape(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _render_invoice_html_from_xml(xml_str: str, ksef_reference_number: str = "") -> str:
    """Parse FA-3 XML and render a KSeF-style HTML invoice preview."""
    import xml.etree.ElementTree as ET
    from decimal import Decimal

    ns = FA3_NS
    root = ET.fromstring(xml_str.encode("utf-8"))

    def find(node, tag):
        return node.find(f"{{{ns}}}{tag}")

    def text(node, tag, default=""):
        el = find(node, tag)
        return (el.text or "").strip() if el is not None else default

    fa = find(root, "Fa")
    podmiot1 = find(root, "Podmiot1")
    podmiot2 = find(root, "Podmiot2")

    invoice_number = text(fa, "P_2") if fa is not None else ""
    issue_date = text(fa, "P_1") if fa is not None else ""
    currency = text(fa, "KodWaluty") if fa is not None else "PLN"
    invoice_type = text(fa, "RodzajFaktury") if fa is not None else "VAT"
    gross_total_str = text(fa, "P_15") if fa is not None else "0.00"

    seller_nip = seller_name = seller_addr = ""
    if podmiot1:
        dane1 = find(podmiot1, "DaneIdentyfikacyjne")
        adres1 = find(podmiot1, "Adres")
        seller_nip = text(dane1, "NIP") if dane1 else ""
        seller_name = text(dane1, "PelnaNazwa") if dane1 else ""
        seller_addr = text(adres1, "AdresL1") if adres1 else ""
        addr_l2 = text(adres1, "AdresL2") if adres1 else ""
        if addr_l2:
            seller_addr = f"{seller_addr}, {addr_l2}"

    buyer_nip = buyer_name = buyer_addr = ""
    if podmiot2:
        dane2 = find(podmiot2, "DaneIdentyfikacyjne")
        adres2 = find(podmiot2, "Adres")
        buyer_nip = text(dane2, "NIP") if dane2 else ""
        buyer_name = text(dane2, "PelnaNazwa") if dane2 else ""
        buyer_addr = text(adres2, "AdresL1") if adres2 else ""

    due_date = ""
    if fa is not None:
        platnosci = find(fa, "Platnosci")
        if platnosci:
            terminy = find(platnosci, "TerminyPlatnosci")
            if terminy:
                due_date = text(terminy, "Termin")

    # Line items
    lines = []
    if fa is not None:
        for wiersz in fa.findall(f"{{{ns}}}FaWiersz"):
            lines.append({
                "nr": text(wiersz, "NrWierszaFa"),
                "name": text(wiersz, "P_7"),
                "unit": text(wiersz, "P_8A"),
                "qty": text(wiersz, "P_8B"),
                "unit_net": text(wiersz, "P_9A"),
                "line_net": text(wiersz, "P_11"),
                "vat_rate": text(wiersz, "P_12"),
            })

    # VAT summary rows from P_13_X / P_14_X
    vat_rows = []
    RATE_LABELS = {1: "23%", 2: "8%", 3: "5%", 4: "0%", 5: "zw", 6: "np"}
    if fa is not None:
        for idx, label in RATE_LABELS.items():
            net_el = fa.find(f"{{{ns}}}P_13_{idx}")
            vat_el = fa.find(f"{{{ns}}}P_14_{idx}")
            if net_el is not None and vat_el is not None:
                net_v = (net_el.text or "0").strip()
                vat_v = (vat_el.text or "0").strip()
                try:
                    gross_v = f"{Decimal(net_v) + Decimal(vat_v):.2f}"
                except Exception:
                    gross_v = "?"
                vat_rows.append({"rate": label, "net": net_v, "vat": vat_v, "gross": gross_v})

    lines_html = ""
    for ln in lines:
        lines_html += f"""
        <tr>
          <td>{_html_escape(ln['nr'])}</td>
          <td>{_html_escape(ln['name'])}</td>
          <td class="num">{_html_escape(ln['unit'])}</td>
          <td class="num">{_html_escape(ln['qty'])}</td>
          <td class="num">{_html_escape(ln['unit_net'])}</td>
          <td class="num">{_html_escape(ln['line_net'])}</td>
          <td class="num">{_html_escape(ln['vat_rate'])}%</td>
        </tr>"""

    vat_rows_html = ""
    for vr in vat_rows:
        vat_rows_html += f"""
        <tr>
          <td>{_html_escape(vr['rate'])}</td>
          <td class="num">{_html_escape(vr['net'])}</td>
          <td class="num">{_html_escape(vr['vat'])}</td>
          <td class="num">{_html_escape(vr['gross'])}</td>
        </tr>"""

    due_row = f"<p><strong>Termin płatności:</strong> {_html_escape(due_date)}</p>" if due_date else ""
    ksef_row = f"<p class='ksef-num'>Numer KSeF: {_html_escape(ksef_reference_number)}</p>" if ksef_reference_number else ""

    return f"""<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>Faktura {_html_escape(invoice_number)}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 32px; max-width: 900px; margin: 0 auto; }}
  .header {{ background: #c0392b; color: white; padding: 12px 20px; border-radius: 4px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }}
  .header h1 {{ font-size: 16px; font-weight: bold; letter-spacing: 1px; }}
  .header .inv-num {{ font-size: 13px; opacity: 0.9; }}
  .parties {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }}
  .party {{ border: 1px solid #ddd; border-radius: 4px; padding: 14px; }}
  .party h2 {{ font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 0.5px; }}
  .party .name {{ font-size: 13px; font-weight: bold; margin-bottom: 4px; }}
  .party .nip {{ color: #555; margin-bottom: 2px; }}
  .meta {{ display: flex; gap: 32px; margin-bottom: 24px; padding: 12px; background: #f9f9f9; border-radius: 4px; }}
  .meta div {{ display: flex; flex-direction: column; gap: 2px; }}
  .meta span.label {{ font-size: 10px; text-transform: uppercase; color: #888; }}
  .meta span.val {{ font-size: 12px; font-weight: bold; }}
  table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }}
  th {{ background: #f0f0f0; text-align: left; padding: 7px 8px; border-bottom: 2px solid #ddd; font-size: 10px; text-transform: uppercase; color: #555; }}
  td {{ padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }}
  tr:last-child td {{ border-bottom: none; }}
  .num {{ text-align: right; }}
  .total-row {{ background: #fef3f3; font-weight: bold; font-size: 14px; }}
  .ksef-num {{ color: #aaa; font-size: 10px; margin-top: 24px; }}
  .print-btn {{
    position: fixed; top: 16px; right: 16px;
    background: #c0392b; color: white; border: none; border-radius: 6px;
    padding: 8px 18px; font-size: 13px; font-weight: bold; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 999;
  }}
  .print-btn:hover {{ background: #a93226; }}
  @media print {{
    body {{ padding: 16px; }}
    .header {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .total-row {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .print-btn {{ display: none; }}
  }}
</style>
</head>
<body>

<button class="print-btn" onclick="window.print()">Drukuj / PDF</button>

<div class="header">
  <h1>Krajowy System e-Faktur</h1>
  <span class="inv-num">Faktura {_html_escape(invoice_type)} &mdash; {_html_escape(invoice_number)}</span>
</div>

<div class="parties">
  <div class="party">
    <h2>Sprzedawca</h2>
    <div class="name">{_html_escape(seller_name)}</div>
    <div class="nip">NIP: {_html_escape(seller_nip)}</div>
    <div>{_html_escape(seller_addr)}</div>
  </div>
  <div class="party">
    <h2>Nabywca</h2>
    <div class="name">{_html_escape(buyer_name)}</div>
    <div class="nip">NIP: {_html_escape(buyer_nip)}</div>
    <div>{_html_escape(buyer_addr)}</div>
  </div>
</div>

<div class="meta">
  <div><span class="label">Data wystawienia</span><span class="val">{_html_escape(issue_date)}</span></div>
  <div><span class="label">Waluta</span><span class="val">{_html_escape(currency)}</span></div>
  {"<div><span class='label'>Termin płatności</span><span class='val'>" + _html_escape(due_date) + "</span></div>" if due_date else ""}
</div>

<table>
  <thead>
    <tr>
      <th>Lp.</th><th>Nazwa towaru/usługi</th><th class="num">J.m.</th>
      <th class="num">Ilość</th><th class="num">Cena netto</th>
      <th class="num">Wartość netto</th><th class="num">VAT</th>
    </tr>
  </thead>
  <tbody>{lines_html}</tbody>
</table>

<table style="width:50%; margin-left: auto;">
  <thead>
    <tr><th>Stawka VAT</th><th class="num">Netto</th><th class="num">VAT</th><th class="num">Brutto</th></tr>
  </thead>
  <tbody>{vat_rows_html}
    <tr class="total-row">
      <td colspan="3" style="text-align:right; padding-right: 12px;">Do zapłaty ({_html_escape(currency)})</td>
      <td class="num">{_html_escape(gross_total_str)}</td>
    </tr>
  </tbody>
</table>

{ksef_row}

</body>
</html>"""


def _render_invoice_html_from_db(db_invoice: "ReceivedKSeFInvoice") -> str:
    """Fallback HTML render using DB fields + cached line items (no XML required)."""
    from decimal import Decimal

    lines = list(db_invoice.lines.order_by("position"))

    lines_html = ""
    for i, ln in enumerate(lines, 1):
        lines_html += f"""
        <tr>
          <td>{ln.position or i}</td>
          <td>{_html_escape(ln.name or '')}</td>
          <td class="num">{_html_escape(ln.unit or 'szt.')}</td>
          <td class="num">{_html_escape(str(ln.quantity or ''))}</td>
          <td class="num">{_html_escape(str(ln.unit_net_price or ''))}</td>
          <td class="num">{_html_escape(str(ln.line_net or ''))}</td>
          <td class="num">{_html_escape(str(ln.vat_rate or '23'))}%</td>
        </tr>"""

    gross = db_invoice.gross_amount or (
        (db_invoice.net_amount or 0) + (db_invoice.vat_amount or 0)
    )
    due_date = db_invoice.due_date.isoformat() if db_invoice.due_date else ""
    ksef_num = db_invoice.ksef_number or ""

    due_html = f"<div><span class='label'>Termin płatności</span><span class='val'>{_html_escape(due_date)}</span></div>" if due_date else ""
    ksef_row = f"<p class='ksef-num'>Numer KSeF: {_html_escape(ksef_num)}</p>" if ksef_num else ""

    return f"""<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8">
<title>Faktura {_html_escape(db_invoice.invoice_number or '')}</title>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 32px; max-width: 900px; margin: 0 auto; }}
  .header {{ background: #c0392b; color: white; padding: 12px 20px; border-radius: 4px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }}
  .header h1 {{ font-size: 16px; font-weight: bold; letter-spacing: 1px; }}
  .header .inv-num {{ font-size: 13px; opacity: 0.9; }}
  .parties {{ display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }}
  .party {{ border: 1px solid #ddd; border-radius: 4px; padding: 14px; }}
  .party h2 {{ font-size: 11px; text-transform: uppercase; color: #888; margin-bottom: 8px; letter-spacing: 0.5px; }}
  .party .name {{ font-size: 13px; font-weight: bold; margin-bottom: 4px; }}
  .party .nip {{ color: #555; margin-bottom: 2px; }}
  .meta {{ display: flex; gap: 32px; margin-bottom: 24px; padding: 12px; background: #f9f9f9; border-radius: 4px; }}
  .meta div {{ display: flex; flex-direction: column; gap: 2px; }}
  .meta span.label {{ font-size: 10px; text-transform: uppercase; color: #888; }}
  .meta span.val {{ font-size: 12px; font-weight: bold; }}
  table {{ width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }}
  th {{ background: #f0f0f0; text-align: left; padding: 7px 8px; border-bottom: 2px solid #ddd; font-size: 10px; text-transform: uppercase; color: #555; }}
  td {{ padding: 6px 8px; border-bottom: 1px solid #eee; vertical-align: top; }}
  tr:last-child td {{ border-bottom: none; }}
  .num {{ text-align: right; }}
  .total-row {{ background: #fef3f3; font-weight: bold; font-size: 14px; }}
  .ksef-num {{ color: #aaa; font-size: 10px; margin-top: 24px; }}
  .print-btn {{
    position: fixed; top: 16px; right: 16px;
    background: #c0392b; color: white; border: none; border-radius: 6px;
    padding: 8px 18px; font-size: 13px; font-weight: bold; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2); z-index: 999;
  }}
  .print-btn:hover {{ background: #a93226; }}
  @media print {{
    body {{ padding: 16px; }}
    .header {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .total-row {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
    .print-btn {{ display: none; }}
  }}
</style>
</head>
<body>

<button class="print-btn" onclick="window.print()">Drukuj / PDF</button>

<div class="header">
  <h1>Krajowy System e-Faktur</h1>
  <span class="inv-num">Faktura {_html_escape(db_invoice.invoice_type or 'VAT')} &mdash; {_html_escape(db_invoice.invoice_number or '')}</span>
</div>

<div class="parties">
  <div class="party">
    <h2>Sprzedawca</h2>
    <div class="name">{_html_escape(db_invoice.seller_name or '')}</div>
    <div class="nip">NIP: {_html_escape(db_invoice.seller_nip or '')}</div>
    <div>{_html_escape(db_invoice.seller_address_l1 or '')}</div>
  </div>
  <div class="party">
    <h2>Nabywca</h2>
    <div class="name">{_html_escape(db_invoice.buyer_name or '')}</div>
    <div class="nip">NIP: {_html_escape(db_invoice.buyer_nip or '')}</div>
    <div></div>
  </div>
</div>

<div class="meta">
  <div><span class="label">Data wystawienia</span><span class="val">{_html_escape(str(db_invoice.issue_date or ''))}</span></div>
  <div><span class="label">Waluta</span><span class="val">{_html_escape(db_invoice.currency or 'PLN')}</span></div>
  {due_html}
</div>

<table>
  <thead>
    <tr>
      <th>Lp.</th><th>Nazwa towaru/usługi</th><th class="num">J.m.</th>
      <th class="num">Ilość</th><th class="num">Cena netto</th>
      <th class="num">Wartość netto</th><th class="num">VAT</th>
    </tr>
  </thead>
  <tbody>{lines_html}</tbody>
</table>

<table style="width:50%; margin-left: auto;">
  <thead>
    <tr><th colspan="3">Podsumowanie</th><th class="num">Kwota</th></tr>
  </thead>
  <tbody>
    <tr><td colspan="3">Wartość netto</td><td class="num">{_html_escape(str(db_invoice.net_amount or ''))}</td></tr>
    <tr><td colspan="3">VAT</td><td class="num">{_html_escape(str(db_invoice.vat_amount or ''))}</td></tr>
    <tr class="total-row">
      <td colspan="3" style="text-align:right; padding-right: 12px;">Do zapłaty ({_html_escape(db_invoice.currency or 'PLN')})</td>
      <td class="num">{_html_escape(str(gross))}</td>
    </tr>
  </tbody>
</table>

{ksef_row}

</body>
</html>"""


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
    GET  /api/ksef/inbox/<ksef_reference_number>/opex/
         Returns invoice-level opex_category + per-line opex categories.
         { opex_category, line_categories: { "0": "fuel"|null, ... } }

    PATCH /api/ksef/inbox/<ksef_reference_number>/opex/
         Body: {
           opex_category?: "fuel"|...|null,   # invoice-level
           line_categories?: { "0": "fuel", "1": null }  # per-line
         }
         No cost_allocation module required — available to all companies.
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def _get_invoice(self, company, ksef_reference_number):
        try:
            return ReceivedKSeFInvoice.objects.get(
                company=company, ksef_number=ksef_reference_number
            )
        except ReceivedKSeFInvoice.DoesNotExist:
            return None

    def get(self, request, ksef_reference_number: str):
        company = request.user.current_company
        invoice = self._get_invoice(company, ksef_reference_number)
        if not invoice:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

        from apps.cost_allocation.models import InvoiceLineAnnotation
        line_anns = InvoiceLineAnnotation.objects.filter(
            line__invoice=invoice,
        ).select_related("line")
        line_categories = {
            str(ann.line.position): ann.opex_category
            for ann in line_anns
            if ann.opex_category is not None
        }
        return Response({
            "ksef_number": invoice.ksef_number,
            "opex_category": invoice.opex_category,
            "line_categories": line_categories,
        })

    def patch(self, request, ksef_reference_number: str):
        from django.utils import timezone as _tz

        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)

        invoice = self._get_invoice(company, ksef_reference_number)
        if not invoice:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

        from apps.cash_flow.models import CompanyOpexCategory
        valid_categories = {c[0] for c in OPEX_CATEGORY_CHOICES} | set(
            CompanyOpexCategory.objects.filter(company=company)
            .exclude(slug='')
            .values_list('slug', flat=True)
        )

        # --- Invoice-level opex_category ---
        if "opex_category" in request.data:
            category = request.data.get("opex_category")
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

        # --- Per-line opex categories ---
        line_categories = request.data.get("line_categories")
        if line_categories and isinstance(line_categories, dict):
            from apps.cost_allocation.models import InvoiceLineAnnotation
            lines_by_position = {
                line.position: line
                for line in invoice.lines.all()
            }
            for pos_str, cat_value in line_categories.items():
                try:
                    pos = int(pos_str)
                except (ValueError, TypeError):
                    continue
                line = lines_by_position.get(pos)
                if not line:
                    continue
                if cat_value is None:
                    InvoiceLineAnnotation.objects.filter(line=line).update(opex_category=None)
                elif cat_value in valid_categories:
                    InvoiceLineAnnotation.objects.update_or_create(
                        line=line,
                        defaults={"opex_category": cat_value},
                    )

        return Response({
            "ksef_number": invoice.ksef_number,
            "opex_category": invoice.opex_category,
        })


# ---------------------------------------------------------------------------
# Mark invoice as paid / unpaid
# ---------------------------------------------------------------------------

class MarkInvoicePaidView(APIView):
    """
    PATCH /api/ksef/inbox/<ksef_reference_number>/mark-paid/
    Body: { is_paid: bool, due_date?: "YYYY-MM-DD" }
    Marks the invoice as paid/unpaid and optionally sets/clears the due date.
    """

    required_permission = 'can_access_ksef_inbox'
    permission_classes = [IsAuthenticated, IsCompanyMember, HasCompanyPermission]

    def patch(self, request, ksef_reference_number):
        company = request.user.current_company
        if not company:
            return Response({"detail": "No active company."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            inv = ReceivedKSeFInvoice.objects.get(company=company, ksef_number=ksef_reference_number)
        except ReceivedKSeFInvoice.DoesNotExist:
            return Response({"detail": "Nie znaleziono faktury."}, status=status.HTTP_404_NOT_FOUND)

        is_paid = request.data.get("is_paid")
        update_fields = []

        if is_paid is not None:
            inv.is_paid = bool(is_paid)
            inv.paid_at = timezone.now() if inv.is_paid else None
            update_fields += ["is_paid", "paid_at"]

        if "due_date" in request.data:
            raw_due = request.data["due_date"]
            if raw_due:
                from datetime import date as _date
                try:
                    inv.due_date = _date.fromisoformat(raw_due[:10])
                except ValueError:
                    return Response({"detail": "Nieprawidłowy format daty (YYYY-MM-DD)."}, status=status.HTTP_400_BAD_REQUEST)
            else:
                inv.due_date = None
            update_fields.append("due_date")

        if update_fields:
            inv.save(update_fields=update_fields)

        return Response({
            "isPaid": inv.is_paid,
            "paidAt": inv.paid_at.isoformat() if inv.paid_at else None,
            "dueDate": inv.due_date.isoformat() if inv.due_date else None,
        })


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
    """Run Google Cloud Vision OCR on an uploaded image. Returns raw text, or empty string on failure.

    Requires the GOOGLE_APPLICATION_CREDENTIALS environment variable to point to a service account
    JSON key file with the 'Cloud Vision API' enabled. Free tier: 1 000 scans/month.
    """
    try:
        from google.cloud import vision  # noqa: PLC0415

        client = vision.ImageAnnotatorClient()
        content = image_file.read()
        image = vision.Image(content=content)
        response = client.document_text_detection(image=image)

        if response.error.message:
            logging.warning("Google Vision API error: %s", response.error.message)
            return ""

        return response.full_text_annotation.text or ""
    except ImportError:
        logging.warning("google-cloud-vision is not installed. Run: pip install google-cloud-vision")
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
    # Try patterns in order of specificity (most specific first):
    # 0. "Numer faktury uproszczonej:\n<number>" — Biedronka simplified VAT invoice (at bottom)
    # 1. "Nr faktury: XXX" or "Faktura VAT: XXX" — explicit label
    # 2. "nr: 2868F00781/0726" — Biedronka thermal (alphanumeric with slashes)
    # 3. Classic Polish: FV/2026/001, FA/2026/001, NNFV/01/00327/05/26
    # 4. Paragon/receipt: "nr:480130" — digits only
    invoice_number = ""

    # Priority 0: Biedronka "Numer faktury uproszczonej" — always wins over generic "nr:"
    m = re.search(r"Numer\s+faktury\s+uproszczonej\s*[:\n]\s*(\S+)", text, re.IGNORECASE)
    if m:
        invoice_number = m.group(1).strip()

    if not invoice_number:
        patterns = [
            r"(?:Nr\s*faktury|Faktura\s*VAT\s*[:\s]*nr|Faktura\s*nr)\s*[:\s]+([A-Z0-9][A-Z0-9/\-]{3,30})",
            r"\bnr\s*[:\.]?\s*([A-Z0-9][A-Z0-9/\-]{4,30})\b",
            r"\b([A-Z]{1,4}[/\-]\d{4}[/\-][\d/\-]+)\b",
            r"\bnr\s*[:\.]?\s*(\d{4,8})\b",
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                candidate = m.group(1).strip().rstrip("-/")
                # Skip if it looks like a NIP or date
                if not re.match(r"^\d{10}$", candidate) and not re.match(r"^\d{4}-\d{2}-\d{2}$", candidate):
                    invoice_number = candidate
                    break

    # Fallback: "Faktury VAT nr\n<number>" — number on next line (Gobarto format)
    if not invoice_number:
        m = re.search(r"Faktury\s+VAT\s+nr\s*\n\s*(\S+)", text, re.IGNORECASE)
        if m:
            invoice_number = m.group(1).strip()

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


# ---------------------------------------------------------------------------
# Multi-format document parser
# ---------------------------------------------------------------------------

# Common skip patterns shared by all parsers
_SKIP_WORDS_RE = re.compile(
    r"RAZEM|SUMA|PTU|SPRZEDA|PARAGON|FISKALN|NIP|NABYWCA|SPRZEDAWCA|FAKTURA"
    r"|DATA\b|TERMIN|DOKUMENT|STRONA|WYDRUK|WAPRO|KARTA|ROZLICZ|BDO|EAO"
    r"|\bLp\.?\b|\bNazwa\b|\bIlo[sś][cć]\b|\bCena\b|\bWarto[sś][cć]\b"
    r"|\bSymbol\b|\bRabat\b|\bNumer\b|transakcj|Sp\.?:|[łl][aą]cznie"
    r"|NOTA\s+ODSETKOW|Kasa\s+Winien|ZAMÓWIENIE\s+NR\s+ZO",
    re.IGNORECASE,
)
_PKWIU_RE = re.compile(r"\(\s*PKWIU[\s\d.]+\)", re.IGNORECASE)
_LOT_RE = re.compile(r"\[L:\d+\]", re.IGNORECASE)
_UNIT_MAP = {
    "kg": "kg", "kgs": "kg",
    "szt": "szt", "szt.": "szt", "sztuk": "szt",
    "op": "op", "op.": "op",
    "l": "l", "litr": "l", "litry": "l",
    "g": "g", "ml": "ml", "m2": "m2", "m²": "m2", "jm": "szt",
}


def _norm_unit(raw: str) -> str:
    s = raw.lower().strip(" .,")
    return _UNIT_MAP.get(s, s or "szt")


def _to_float(s: str) -> float:
    return float(s.strip().replace(" ", "").replace(",", "."))


def _detect_doc_type(text: str) -> str:
    """Detect document type from OCR text structure — NOT by supplier name.

    Detection is based on document keywords and table structure only,
    so it works regardless of which company issued the document.

    Returns: "paragon", "faktura_thermal", "faktura_a4", "wz_delivery_spec",
             "wz_tabular", "wz_multiline", "wz_insert", "zamowienie", or "other".
    """
    # Documents with no product lines — skip immediately
    if re.search(r"NOTA\s+ODSETKOW|Kasa\s+Winien|ZAMÓWIENIE\s+NR", text, re.IGNORECASE):
        return "other"

    # --- WZ / Delivery documents ---

    # "Specyfikacja dostawy do Faktury VAT" — combined WZ+FV delivery spec
    # Structural signal: Lp blocks with qty+unit on separate line, price below
    if re.search(r"Specyfikacja\s+dostawy\s+do\s+Faktury\s+VAT", text, re.IGNORECASE):
        return "wz_delivery_spec"

    # WAPRO Mag / similar — full table on one line per product
    # Signal: "Zadysponowano" column header OR "WAPRO Mag" footer
    if re.search(r"Zadysponowano|WAPRO\s+Mag|Wydrukowano\s+z\s+programu", text, re.IGNORECASE):
        return "wz_tabular"

    # Generic WZ — "Dokument WZ" or "Wydanie zewnętrzne" or "Dokument wydania"
    # with tabular structure (Lp + columns on one line)
    if re.search(r"Dokument\s+WZ|DOKUMENT\s+WYDANIA|Wydanie\s+zewn[eę]trzne", text, re.IGNORECASE):
        # InsERT GT specific: "Wydanie zewnętrzne z VAT" with j.m. column
        if re.search(r"Wydanie\s+zewn[eę]trzne\s+z\s+VAT|InsERT", text, re.IGNORECASE):
            return "wz_insert"
        return "wz_tabular"

    # --- Receipts and invoices ---

    # Fiscal receipt — always has "PARAGON FISKALNY"
    if re.search(r"PARAGON\s+FISKALNY", text):
        return "paragon"

    # Thermal invoice (Biedronka-style): FAKTURA on thermal paper
    # Structural signal: "Nazwa towaru i stawka" header + "CC"/"C" VAT class markers
    if re.search(r"FAKTURA", text, re.IGNORECASE) and re.search(
        r"Nazwa\s+towaru\s+i\s+stawka|\bCC\b", text, re.IGNORECASE
    ):
        return "faktura_thermal"

    # A4 VAT invoice with tabular product lines
    # Structural signal: "Faktura VAT" + standard column headers
    if re.search(r"Faktura\s+VAT|FAKTURA\s+VAT", text, re.IGNORECASE) and re.search(
        r"Cena\s+netto|Warto[sś][cć]\s+netto|Warto[sś][cć]\s+brutto", text, re.IGNORECASE
    ):
        # Check if it's multi-column tabular (one row per product) or multi-line blocks
        # Tabular: Lp + product code + name + unit + numbers all on same line
        if re.search(r"^\d+\s+\d{4,6}\s+\S.+?(KG|SZT|OP)\s+[\d,]+", text, re.IGNORECASE | re.MULTILINE):
            return "faktura_a4"
        return "faktura_a4"  # default for A4 invoices

    return "other"


def _parse_paragon_lines(text: str) -> list:
    """Parse product lines from PARAGON FISKALNY (Biedronka, Carrefour, AS Bylak).

    Two OPUST formats exist on Biedronka receipts:
      Format A — OPUST after price line:
          ProductName C
          2,056 x14,99 30,82C
          OPUST
          -14,39C          ← discount value (skip)
          16,43            ← final price after discount

      Format B — OPUST before price line:
          ProductName C
          OPUST
          1,123 x14,99 16,83C
          8.97             ← final price after discount
    """
    price_seg = re.compile(
        r"([\d,.]+)\s*(kg|szt|l|g|ml|op)?[.,]?\s*[xX×«¥*]\s*([\d,.]+)\s*=?\s+([\d,.\s]+)[A-Za-z]?\s*$",
        re.IGNORECASE,
    )
    amount_re = re.compile(r"^[^0-9]*([\d]+[,.][\d]{2})\s*[A-Za-z]?\s*$")
    opust_re = re.compile(r"^OPUST\s*$|^RABAT\s*$", re.IGNORECASE)
    neg_re = re.compile(r"^\s*-+\s*[\d,.]+\s*[A-Za-z]?\s*$")
    vat_suffix = re.compile(r"\s+[A-Z]{0,2}\.?[A-Z]\s*$")
    skip_re = re.compile(
        r"SUMA|PTU|SPRZEDA|RAZEM|KARTA|PARAGON|NIP|FISKALN|ROZLICZ"
        r"|Udzielono|Numer|BDO|EAO|Nr[\s:]|transakcj|Promoc|Sp:|[łl][aą]cznie",
        re.IGNORECASE,
    )

    raw_lines = [ln.strip() for ln in text.splitlines()]
    non_empty = [(idx, ln) for idx, ln in enumerate(raw_lines) if ln.strip()]
    entries = []
    pending_name: str | None = None
    j = 0

    while j < len(non_empty):
        _idx, line = non_empty[j]

        # Skip summary/footer lines — reset name context
        if skip_re.search(line):
            pending_name = None
            j += 1
            continue

        # OPUST/RABAT is a discount marker — skip it, preserve pending_name
        if opust_re.match(line):
            j += 1
            continue

        # Skip standalone negative numbers (discount values like "-14,39C")
        if neg_re.match(line):
            j += 1
            continue

        m = price_seg.search(line)
        if m:
            qty_raw = m.group(1).replace(",", ".")
            unit = _norm_unit(m.group(2) or "szt")
            price_raw = m.group(3).replace(",", ".")
            total_raw = m.group(4).replace(" ", "").replace(",", ".")
            prefix = vat_suffix.sub("", line[:m.start()]).strip()
            name = prefix if len(prefix) > 2 else pending_name
            try:
                qty = float(qty_raw)
                price = float(price_raw)
                total = float(total_raw)
                if qty > 0 and price > 0 and name:
                    after_discount = total
                    # Look at next line: skip OPUST and negative lines, then check for final price
                    look = j + 1
                    while look < len(non_empty):
                        _, candidate = non_empty[look]
                        if opust_re.match(candidate) or neg_re.match(candidate):
                            look += 1
                            continue
                        am = amount_re.match(candidate)
                        if am:
                            try:
                                candidate_val = _to_float(am.group(1))
                                # Only accept as after-discount if lower than original total
                                if 0 < candidate_val < total:
                                    after_discount = candidate_val
                                    j = look
                            except ValueError:
                                pass
                        break
                    eff_price = round(after_discount / qty, 4) if qty > 0 else price
                    entries.append({
                        "name": name, "quantity": str(qty),
                        "unit": unit, "unit_price": str(eff_price),
                    })
            except ValueError:
                pass
            pending_name = None
        elif re.search(r"[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,}", line) and not re.search(r"\d{4,}", line):
            pending_name = vat_suffix.sub("", line).strip()
        j += 1

    return entries


def _parse_faktura_thermal_lines(text: str) -> list:
    """Parse product lines from Biedronka thermal VAT invoice (multi-line block format).

    OCR splits each product across multiple lines:
        MakaT450PlonNat1kg CC   ← name + VAT class (C/CC/A/B) — block start
        20,000 KG                ← qty + unit
        OPUST                    ← optional discount marker
        1,79                     ← cena brutto
        23,05                    ← wartość netto
        -11.60                   ← opust value (negative)
        1.15 5                   ← kwota VAT + VAT%
        24,20                    ← wartość brutto (final, after discount)

    Strategy: detect block start by VAT class suffix (CC/C/A/B at end of line).
    Collect lines until next block or summary. Extract qty+unit from first numeric line,
    and wartość_brutto = last positive standalone number in block.
    unit_price = wartość_brutto / qty
    """
    # Block start: line ending with VAT class letter(s)
    block_start_re = re.compile(r"^(.+?)\s+(CC?|[AB])\s*$", re.IGNORECASE)
    # qty + unit on same line: "20,000 KG" or "1,000 SZT"
    qty_unit_re = re.compile(
        r"^([\d,]+)\s+(KG|SZT|L|G|ML|OP|OPA|szt\.?|kg)\s*$",
        re.IGNORECASE,
    )
    # Summary/footer — stop collecting
    summary_re = re.compile(
        r"VAT%\s+Warto[sś][cć]|RAZEM|Do\s+zap[łl]aty|S[łl]ownie"
        r"|Nabywca|Sprzedawca|FAKTURA|NIP|Podpis|DZIEKUJEMY|BDO",
        re.IGNORECASE,
    )
    # Standalone number (possibly negative, comma or dot decimal)
    number_re = re.compile(r"^-?([\d]+[,.][\d]+)\s*$")

    # Find product table section: starts after "Nazwa towaru" header, ends at summary
    table_start_re = re.compile(r"Nazwa\s+towaru", re.IGNORECASE)
    table_end_re = re.compile(r"VAT%\s+Warto[sś][cć]\s+netto|RAZEM|Do\s+zap[łl]aty", re.IGNORECASE)

    all_lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    # Find start and end of product table
    start_idx = 0
    for i, ln in enumerate(all_lines):
        if table_start_re.search(ln):
            start_idx = i + 1
            break
    end_idx = len(all_lines)
    for i, ln in enumerate(all_lines[start_idx:], start=start_idx):
        if table_end_re.search(ln):
            end_idx = i
            break

    lines = all_lines[start_idx:end_idx]
    entries = []

    # Split into blocks: each block starts at a block_start line
    blocks: list[tuple[str, str, list[str]]] = []  # (name, vat_class, subsequent_lines)
    current_name: str | None = None
    current_vat: str | None = None
    current_block: list[str] = []

    for line in lines:
        m = block_start_re.match(line)
        if m and not line.upper().startswith("OPUST"):
            if current_name:
                blocks.append((current_name, current_vat or "", current_block))
            current_name = m.group(1).strip()
            current_vat = m.group(2)
            current_block = []
        elif current_name is not None:
            current_block.append(line)

    if current_name:
        blocks.append((current_name, current_vat or "", current_block))

    # Parse each block
    for name, _vat, block_lines in blocks:
        if not block_lines or len(name) < 3:
            continue

        qty: float | None = None
        unit = "szt"
        positive_numbers: list[float] = []

        for bline in block_lines:
            # Try qty + unit
            qm = qty_unit_re.match(bline)
            if qm and qty is None:
                try:
                    qty = _to_float(qm.group(1))
                    unit = _norm_unit(qm.group(2))
                except ValueError:
                    pass
                continue
            # Collect standalone numbers (skip negative — those are opust)
            nm = number_re.match(bline)
            if nm:
                try:
                    val = _to_float(nm.group(1))
                    if val > 0:
                        positive_numbers.append(val)
                except ValueError:
                    pass

        if qty and qty > 0 and positive_numbers:
            # Last positive number in block = wartość brutto after all discounts
            wartość_brutto = positive_numbers[-1]
            eff_price = round(wartość_brutto / qty, 4)
            entries.append({
                "name": name, "quantity": str(qty),
                "unit": unit, "unit_price": str(eff_price),
            })

    return entries


def _parse_faktura_a4_lines(text: str) -> list:
    """Parse product lines from an A4 VAT invoice (BJANEX format) or BJANEX WZ.

    Column order: Lp [Symbol] Nazwa JM Ilość Cena_netto Wartość_netto Cena_brutto Wartość_brutto
    """
    row_re = re.compile(
        r"^\d+\s+"
        r"(?:\d{4,6}\s+)?"
        r"(.+?)\s+"
        r"(KG|SZT|OP|L|G|ML|M2|JM|[A-Z]{1,4})\s+"
        r"([\d,]+)\s+"
        r"([\d,]+)\s+"
        r"([\d,]+)\s+"
        r"([\d,]+)\s+"
        r"([\d,]+)",
        re.IGNORECASE,
    )
    entries = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or _SKIP_WORDS_RE.search(line):
            continue
        line = _PKWIU_RE.sub("", _LOT_RE.sub("", line))
        line = re.sub(r"\s{2,}", " ", line).strip()
        m = row_re.match(line)
        if not m:
            continue
        name = m.group(1).strip()
        if re.search(r"\bNazwa\b|\bSymbol\b|\bLp\b", name, re.IGNORECASE):
            continue
        try:
            qty = _to_float(m.group(3))
            price = _to_float(m.group(4))
            if qty > 0 and price > 0 and len(name) > 1:
                entries.append({
                    "name": name, "quantity": str(qty),
                    "unit": _norm_unit(m.group(2)), "unit_price": str(price),
                })
        except ValueError:
            pass
    return entries


def _parse_wz_wapro_lines(text: str) -> list:
    """Parse WAPRO Mag DOKUMENT WYDANIA WZ.

    WAPRO prints landscape A4. OCR reads column-by-column, producing:
        - Product names first (numbered lines)
        - Then column headers (fragmented)
        - Then all units, quantities, prices in separate blocks

    Also handles pipe-delimited dot-matrix variant (single-line rows).
    """
    all_lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # --- Try single-line tabular first (pipe-delimited or landscape with good OCR) ---
    row_re = re.compile(
        r"^\d+\s+(?:[A-Z0-9]{4,}\s+)?(.+?)\s+"
        r"(OP|SZT\.?|KG|L|G|M2)\s+([\d,]+)\s+[\d,]+\s+\d+\s+([\d,]+)",
        re.IGNORECASE,
    )
    tabular_entries = []
    for raw_line in all_lines:
        line = raw_line.replace("|", " ")
        line = re.sub(r"\s{2,}", " ", line).strip()
        m = row_re.match(line)
        if not m:
            continue
        name = m.group(1).strip()
        if re.search(r"\bNazwa\b|\bLp\b", name, re.IGNORECASE) or len(name) < 2:
            continue
        try:
            qty = _to_float(m.group(3))
            price = _to_float(m.group(4))
            if qty > 0 and price > 0:
                tabular_entries.append({
                    "name": name, "quantity": str(qty),
                    "unit": _norm_unit(m.group(2)), "unit_price": str(price),
                })
        except ValueError:
            pass
    if tabular_entries:
        return tabular_entries

    # --- Column-by-column fallback (landscape OCR) ---
    # Step 1: extract names from numbered lines (before column header block)
    # In WAPRO landscape OCR, names appear BETWEEN "Nazwa artykułu" and "Symbol sww/ku"
    # Find those boundary lines first
    names_start = 0
    names_end = len(all_lines)
    for i, line in enumerate(all_lines):
        if re.search(r"Nazwa\s+artyku", line, re.IGNORECASE):
            names_start = i + 1
        if names_start > 0 and re.search(r"Symbol\s+sww|Zadyspo|Data:\s+\d", line, re.IGNORECASE):
            names_end = i
            break

    name_re = re.compile(r"^(\d+)\s+(.+)$")
    skip_name_re = re.compile(
        r"^LP$|Wystawił|Zatwierdził|Wydał|Odebrał|Wydrukowano|Odbiorca|Sprzedawca"
        r"|Uwagi|NIP:|ul\.|Numer|Magazyn|faktury|telefon",
        re.IGNORECASE,
    )

    names: list[str] = []
    pending_name: str | None = None

    for line in all_lines[names_start:names_end]:
        if skip_name_re.search(line):
            continue
        m = name_re.match(line)
        if m:
            if pending_name:
                names.append(pending_name)
            pending_name = m.group(2).strip()
        elif pending_name:
            # continuation line (e.g. "POLSKA 15KG" after "ZIEMNIAK...")
            pending_name += " " + line.strip()

    if pending_name:
        names.append(pending_name)

    if not names:
        return []

    # Step 2: collect data tokens after "PLN" markers
    pln_count = 0
    data_start = len(all_lines)
    for i, line in enumerate(all_lines):
        if re.match(r"^PLN\s*$", line):
            pln_count += 1
            if pln_count >= 2:
                data_start = i + 1
                break

    data_lines = all_lines[data_start:]

    # Step 3: split into per-product clusters by unit markers
    unit_re = re.compile(r"^(OP|SZT\.?|KG|L|G|M2)\s*$", re.IGNORECASE)
    number_re = re.compile(r"^-?[\d]+[,.][\d]+$")
    int_re = re.compile(r"^\d+$")
    noise_re = re.compile(r"^(X{3,}|\d{4}-\d{2}-\d{2}|Wystawił|Zatwierdził|Wydał|Odebrał|WZ\s)", re.IGNORECASE)

    clusters: list[dict] = []
    current: dict | None = None

    for line in data_lines:
        if noise_re.search(line):
            continue
        if unit_re.match(line):
            if current is not None:
                clusters.append(current)
            current = {"unit": _norm_unit(line), "numbers": [], "ints": []}
        elif current is not None:
            if number_re.match(line):
                try:
                    current["numbers"].append(_to_float(line))
                except ValueError:
                    pass
            elif int_re.match(line):
                v = int(line)
                if v < 1000:
                    current["ints"].append(v)
            # "0,00 5" style lines (rabat + VAT%) — skip

    if current is not None:
        clusters.append(current)

    # Step 4: match names[i] → clusters[i]
    entries = []
    for i, name in enumerate(names):
        if i >= len(clusters):
            break
        c = clusters[i]
        numbers = c["numbers"]
        ints = c["ints"]

        qty: float | None = None
        for v in ints:
            if v not in (5, 8, 23):  # skip VAT rates
                qty = float(v)
                break
        if qty is None and ints:
            qty = float(ints[0])

        price = numbers[0] if numbers else None

        if qty and price and qty > 0 and price > 0 and len(name) > 1:
            entries.append({
                "name": name.strip(),
                "quantity": str(qty),
                "unit": c["unit"],
                "unit_price": str(price),
            })

    return entries


def _parse_wz_gobarto_lines(text: str) -> list:
    """Parse product lines from Gobarto Specyfikacja dostawy (multi-line block format).

    OCR splits each product across multiple lines:
        1                          ← Lp (block start)
        601-6122 PODGARDLE WP B/S  ← Kod + Nazwa
        / PKWIU                    ← noise
        02031959                   ← PCN code (skip)
        7,12 KG                    ← Ilość + j.m.
        6,99                       ← Cena jedn. netto
        49,77                      ← Wartość netto
        5%                         ← VAT%
        (L: 2620300000)            ← lot number (skip)

    Strategy: block starts with standalone Lp digit(s).
    Extract: Kod+Nazwa from next text line, qty+unit from "N,NN KG" line, price = first standalone number.
    """
    all_lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    # Find product table: between column header and summary
    start_idx = 0
    for i, ln in enumerate(all_lines):
        if re.search(r"Nazwa\s+towaru|Lp\s+Kod", ln, re.IGNORECASE):
            start_idx = i + 1
            break
    end_idx = len(all_lines)
    for i, ln in enumerate(all_lines[start_idx:], start=start_idx):
        if re.search(r"Razem\s+j\.m\.|Forma\s+p[łl]atn|Razem\s+do\s+zap", ln, re.IGNORECASE):
            end_idx = i
            break

    lines = all_lines[start_idx:end_idx]

    # Qty+unit pattern: "7,12 KG"
    qty_unit_re = re.compile(r"^([\d,]+)\s+(KG|SZT|OP|L|G|M2|[A-Z]{1,4})\s*$", re.IGNORECASE)
    # Standalone number (price): "6,99" or "49,77"
    number_re = re.compile(r"^([\d]+[,.][\d]+)\s*$")
    # Lp line: just digits
    lp_re = re.compile(r"^\d+$")
    # Kod + Nazwa: starts with product code like "601-6122"
    kod_nazwa_re = re.compile(r"^([\w-]{5,})\s+(.+)$")
    # Skip patterns
    skip_re = re.compile(r"^[/\\]|PKWIU|PCN|\(L:|^\d{6,}$|^%$", re.IGNORECASE)

    # Build blocks
    blocks: list[dict] = []
    current: dict | None = None

    for line in lines:
        if skip_re.search(line):
            continue
        if lp_re.match(line):
            if current:
                blocks.append(current)
            current = {"name": "", "qty": None, "unit": "kg", "numbers": []}
            continue
        if current is None:
            continue

        # Try qty+unit
        qm = qty_unit_re.match(line)
        if qm and current["qty"] is None:
            try:
                current["qty"] = _to_float(qm.group(1))
                current["unit"] = _norm_unit(qm.group(2))
            except ValueError:
                pass
            continue

        # Try name (Kod + Nazwa)
        if not current["name"]:
            km = kod_nazwa_re.match(line)
            if km:
                current["name"] = _LOT_RE.sub("", km.group(2)).strip()
                continue
            # Plain name line
            if re.search(r"[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]{3,}", line) and not number_re.match(line):
                current["name"] = _LOT_RE.sub("", line).strip()
                continue

        # Collect standalone numbers
        nm = number_re.match(line)
        if nm:
            try:
                current["numbers"].append(_to_float(nm.group(1)))
            except ValueError:
                pass

    if current:
        blocks.append(current)

    # Extract entries from blocks
    entries = []
    for b in blocks:
        name = b["name"]
        qty = b["qty"]
        numbers = b["numbers"]
        if not name or not qty or not numbers or qty <= 0:
            continue
        price = numbers[0]  # first number = cena jedn. netto
        if price > 0 and len(name) > 1:
            entries.append({
                "name": name, "quantity": str(qty),
                "unit": b["unit"], "unit_price": str(price),
            })
    return entries


def _parse_wz_insert_lines(text: str) -> list:
    """Parse product lines from Subiekt GT / InsERT GT 'Wydanie zewnętrzne'.

    Column order: Lp | Nazwa | Ilość | j.m. | Cena | Wartość netto | Koszt
    Numbers use comma decimal separator.

    Special: 'Rozbicie kompletu' sub-rows appear indented under the main item —
    skip these (they are components, not separate products).

    Example:
        1  Zestaw kosmetyków    1,000  szt.  272,50  272,50  299,93
        Rozbicie kompletu:Symbol towaru  Nazwa towaru  Ilość  J.m.   ← skip header
            BAREG200  Balsam do ciała...  1,000  szt.                ← skip sub-row
        2  Puder w kamieniu 07  1,000  szt.   35,00   35,00   63,00
    """
    row_re = re.compile(
        r"^(\d+)\s+"                        # Lp
        r"(.+?)\s+"                         # Nazwa
        r"([\d,]+)\s+"                      # Ilość
        r"(szt\.?|kg\.?|op\.?|l|g|m2?)\s+"  # j.m.
        r"([\d,]+)\s+"                      # Cena
        r"([\d,]+)",                        # Wartość netto
        re.IGNORECASE,
    )
    skip_re = re.compile(
        r"Rozbicie\s+kompletu|Symbol\s+towaru|Nazwa\s+towaru|Razem|Słownie"
        r"|Wystawił|Odebrał|Podpis|Sprzedawca|Odbiorca|NIP|Wydanie\s+zewn",
        re.IGNORECASE,
    )

    entries = []
    seen: set[str] = set()
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or skip_re.search(line):
            continue
        m = row_re.match(line)
        if not m:
            continue
        name = m.group(2).strip()
        if name in seen or len(name) < 2:
            continue
        try:
            qty = _to_float(m.group(3))
            price = _to_float(m.group(5))
            if qty > 0 and price > 0:
                seen.add(name)
                entries.append({
                    "name": name, "quantity": str(qty),
                    "unit": _norm_unit(m.group(4)), "unit_price": str(price),
                })
        except ValueError:
            pass
    return entries


def _parse_lines(text: str) -> list:
    """Detect document type and dispatch to the appropriate line parser.

    Returns [{name, quantity, unit, unit_price}] for all supported formats.
    """
    doc_type = _detect_doc_type(text)
    if doc_type == "paragon":
        return _parse_paragon_lines(text)
    if doc_type == "faktura_thermal":
        return _parse_faktura_thermal_lines(text)
    if doc_type in ("faktura_a4", "wz_tabular"):
        return _parse_faktura_a4_lines(text)
    if doc_type == "wz_delivery_spec":
        return _parse_wz_gobarto_lines(text)
    if doc_type == "wz_insert":
        return _parse_wz_insert_lines(text)
    return []


def _parse_lines_with_gemini(text: str) -> list:
    """Use Gemini Flash to extract product lines from OCR text.

    Requires GEMINI_API_KEY environment variable.
    Returns [{name, quantity, unit, unit_price}] or [] on failure.
    Retries up to 3 times on 429 with 10s backoff.
    """
    import json  # noqa: PLC0415
    import time  # noqa: PLC0415

    api_key = os.environ.get("GEMINI_API_KEY", "")
    logging.info("Gemini API key prefix: %s", api_key[:20] if api_key else "MISSING")
    if not api_key:
        return []
    try:
        from google import genai  # noqa: PLC0415
        client = genai.Client(api_key=api_key)

        # Short prompt to minimize token usage
        prompt = (
            "Wyciągnij pozycje towarowe z poniższego tekstu OCR (faktura/paragon).\n"
            "Zwróć TYLKO czysty JSON:\n"
            '[{"name": "...", "quantity": "...", "unit": "...", "unit_price": "..."}]\n'
            "Zasady:\n"
            "- name: nazwa bez kodów/PKWiU\n"
            "- quantity: liczba z kropką (np. '2.056')\n"
            "- unit: lowercase (szt, kg, op, l, g)\n"
            "- unit_price: cena po rabacie za jednostkę z kropką\n"
            "- Pomiń nagłówki, podsumowania, linie OPUST/RABAT. Jeśli brak pozycji, zwróć [].\n\n"
            f"Tekst OCR:\n{text[:3000]}"
        )

        for attempt in range(3):
            try:
                response = client.models.generate_content(
                    model="gemini-flash-latest",
                    contents=prompt,
                )
                raw = response.text.strip()
                if raw.startswith("```"):
                    raw = re.sub(r"^```[a-z]*\n?", "", raw)
                    raw = re.sub(r"\n?```$", "", raw)
                result = json.loads(raw)
                return result if isinstance(result, list) else []
            except Exception as exc:  # noqa: BLE001
                if "429" in str(exc) and attempt < 2:
                    logging.warning("Gemini 429, retry %d/3 in 10s", attempt + 1)
                    time.sleep(10)
                else:
                    raise
    except Exception as exc:  # noqa: BLE001
        logging.warning("Gemini parsing failed: %s", exc)
        return []


def _parse_lines(text: str) -> tuple[list, bool]:
    """Detect document type, parse with regex, fallback to Gemini if 0 results.

    Returns (lines, used_gemini).
    """
    doc_type = _detect_doc_type(text)

    if doc_type == "paragon":
        result = _parse_paragon_lines(text)
    elif doc_type == "faktura_thermal":
        result = _parse_faktura_thermal_lines(text)
    elif doc_type in ("faktura_a4", "wz_tabular"):
        result = _parse_faktura_a4_lines(text)
    elif doc_type == "wz_delivery_spec":
        result = _parse_wz_gobarto_lines(text)
    elif doc_type == "wz_insert":
        result = _parse_wz_insert_lines(text)
    else:
        result = []

    if not result:
        logging.info("Regex returned 0 lines for doc_type=%s, trying Gemini", doc_type)
        result = _parse_lines_with_gemini(text)
        return result, True

    return result, False


# Aliases for backward compatibility
def _parse_receipt_lines(text: str) -> list:
    lines, _ = _parse_lines(text)
    return lines


def _parse_invoice_lines(text: str) -> list:
    lines, _ = _parse_lines(text)
    return lines


class PaperScanView(APIView):
    """Accept an image upload, run OCR, return extracted invoice fields.

    POST /api/ksef/scan-paper/
    Content-Type: multipart/form-data
    Body: image (file)

    Response: { seller_name, seller_nip, invoice_number, issue_date, total_gross, doc_type, raw_text, lines }
    OCR is best-effort: fields may be empty when extraction fails.
    lines: [{name, quantity, unit, unit_price}] — product lines (may be empty for unknown formats).
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
        parsed["doc_type"] = _detect_doc_type(raw_text)
        lines, used_gemini = _parse_lines(raw_text)
        parsed["lines"] = lines
        if used_gemini:
            logging.warning(
                "GEMINI_USED user=%s doc_type=%s lines=%d",
                request.user,
                parsed.get("doc_type", "?"),
                len(lines),
            )

        return Response(parsed)
