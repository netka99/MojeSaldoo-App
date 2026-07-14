"""
Human-readable error code dictionary.

Each entry maps an error_code string to a dict with:
  title        — short headline shown to the user
  description  — plain-language explanation of what went wrong
  action_hint  — what the user should do next
  action_url   — optional deep-link (may contain {object_id} placeholder)
"""

ERROR_MESSAGES: dict[str, dict] = {
    # ── KSeF authentication ──────────────────────────────────────────────────
    "KSEF_NO_NIP_COMPANY": {
        "title": "Brak NIP firmy",
        "description": "Twoja firma nie ma uzupełnionego numeru NIP.",
        "action_hint": "Uzupełnij NIP w ustawieniach firmy przed wysłaniem faktury do KSeF.",
        "action_url": "/settings/company",
    },
    "KSEF_AUTH_FAILED": {
        "title": "Uwierzytelnianie KSeF nieudane",
        "description": "Podane hasło (passphrase) lub certyfikat są nieprawidłowe.",
        "action_hint": "Sprawdź hasło i spróbuj ponownie. Jeśli problem się powtarza, wgraj certyfikat ponownie.",
        "action_url": "/settings/certificate",
    },
    "KSEF_AUTH_IN_PROGRESS": {
        "title": "Uwierzytelnianie KSeF w trakcie",
        "description": "Poprzednie żądanie uwierzytelnienia jest jeszcze przetwarzane.",
        "action_hint": "Poczekaj chwilę i spróbuj ponownie.",
        "action_url": None,
    },
    # ── KSeF send invoice ────────────────────────────────────────────────────
    "KSEF_NO_SESSION": {
        "title": "Brak sesji KSeF",
        "description": "Nie jesteś zalogowany do KSeF. Sesja jest wymagana do wysyłki faktur.",
        "action_hint": "Zaloguj się do KSeF w sekcji Faktury → KSeF przed wysłaniem faktury.",
        "action_url": "/ksef",
    },
    "KSEF_SESSION_EXPIRED": {
        "title": "Sesja KSeF wygasła",
        "description": "Twoja sesja KSeF wygasła i nie można wysłać faktury.",
        "action_hint": "Zaloguj się ponownie do KSeF.",
        "action_url": "/ksef",
    },
    "KSEF_NO_NIP_CUSTOMER": {
        "title": "Brak NIP nabywcy",
        "description": "Klient przypisany do tej faktury nie ma uzupełnionego NIP.",
        "action_hint": "Uzupełnij NIP klienta i wyślij fakturę ponownie.",
        "action_url": "/customers",
    },
    "KSEF_XML_FAILED": {
        "title": "Błąd generowania XML faktury",
        "description": "Nie udało się wygenerować pliku FA-3 dla tej faktury.",
        "action_hint": "Sprawdź czy wszystkie wymagane pola faktury są wypełnione. Skontaktuj się z supportem jeśli problem się powtarza.",
        "action_url": None,
    },
    "KSEF_SEND_FAILED": {
        "title": "Błąd wysyłki do KSeF",
        "description": "Faktura dotarła do systemu SSAPI, ale nie mogła być przekazana do KSeF.",
        "action_hint": "Spróbuj ponownie za kilka minut. Jeśli problem się powtarza, skontaktuj się z supportem.",
        "action_url": None,
    },
    "KSEF_REJECTED": {
        "title": "Faktura odrzucona przez KSeF",
        "description": "KSeF odrzucił fakturę. Sprawdź szczegóły błędu w historii faktury.",
        "action_hint": "Popraw dane faktury i wyślij ponownie. Najczęstsze przyczyny: błędny NIP, brakujące pola, nieprawidłowy format daty.",
        "action_url": "/invoices",
    },
    # ── Server ───────────────────────────────────────────────────────────────
    "SERVER_ERROR": {
        "title": "Nieoczekiwany błąd serwera",
        "description": "Wystąpił błąd po stronie serwera podczas wykonywania operacji.",
        "action_hint": "Spróbuj ponownie. Jeśli problem się powtarza, skontaktuj się z supportem i podaj datę i godzinę błędu.",
        "action_url": None,
    },
    # ── Orders ───────────────────────────────────────────────────────────────
    "ORDER_NO_WAREHOUSE": {
        "title": "Brak magazynu głównego",
        "description": "Firma nie ma skonfigurowanego aktywnego magazynu głównego, który jest wymagany do potwierdzenia zamówienia z pozycjami produktów.",
        "action_hint": "Utwórz magazyn typu 'main' w sekcji Magazyn → Magazyny, lub skontaktuj się z administratorem.",
        "action_url": "/warehouses",
    },
    # ── Invoice ──────────────────────────────────────────────────────────────
    "INVOICE_NOT_DRAFT": {
        "title": "Faktura nie jest szkicem",
        "description": "Wystawić można tylko faktury w statusie 'szkic'.",
        "action_hint": "Sprawdź status faktury. Jeśli faktura jest już wystawiona, nie możesz jej ponownie wystawić.",
        "action_url": "/invoices",
    },
    "INVOICE_WZ_REQUIRED": {
        "title": "Brak dokumentu WZ przed wystawieniem faktury",
        "description": "Ustawienie firmy wymaga zatwierdzonego dokumentu WZ (wydanie towaru) zanim można wystawić fakturę dla tego zamówienia.",
        "action_hint": "Zakończ dostawę (utwórz i zatwierdź dokument WZ), a następnie wróć do wystawiania faktury. Alternatywnie wyłącz wymóg WZ w Ustawienia → Przepływ dokumentów.",
        "action_url": "/delivery",
    },
    "INVOICE_QTY_EXCEEDED": {
        "title": "Ilość na fakturze przekracza dostarczoną",
        "description": "Fakturujesz więcej sztuk produktu niż zostało dostarczone i zaakceptowane w dokumentach WZ.",
        "action_hint": "Sprawdź ilości dostarczone w dokumentach WZ i popraw ilość na fakturze.",
        "action_url": "/invoices",
    },
    "INVOICE_NOT_ISSUED": {
        "title": "Faktura nie jest wystawiona",
        "description": "Do KSeF można wysłać tylko faktury ze statusem 'wystawiona'.",
        "action_hint": "Najpierw wystaw fakturę, a następnie wyślij do KSeF.",
        "action_url": "/invoices",
    },
    "INVOICE_ALREADY_IN_KSEF": {
        "title": "Faktura już w KSeF",
        "description": "Ta faktura została już wysłana lub jest w trakcie przetwarzania przez KSeF.",
        "action_hint": "Sprawdź status faktury. Nie wysyłaj tej samej faktury więcej niż raz.",
        "action_url": "/invoices",
    },
}


def get_error_info(error_code: str) -> dict:
    """Return human-readable info for a given error_code, or a generic fallback."""
    return ERROR_MESSAGES.get(
        error_code,
        {
            "title": "Nieznany błąd",
            "description": "Wystąpił nieoczekiwany błąd.",
            "action_hint": "Spróbuj ponownie lub skontaktuj się z supportem.",
            "action_url": None,
        },
    )
