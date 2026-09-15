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
    "KSEF_VALIDATION_FAILED": {
        "title": "Faktura nie przeszła walidacji FA-3",
        "description": "Dane faktury nie spełniają wymagań schematu FA-3 przed wysyłką do KSeF.",
        "action_hint": "Popraw wskazane pola faktury (NIP, daty, stawki VAT) i wyślij ponownie.",
        "action_url": "/invoices/{object_id}",
    },
    "KSEF_SYNC_FAILED": {
        "title": "Nie udało się pobrać faktur z KSeF",
        "description": "Synchronizacja skrzynki odbiorczej KSeF zakończyła się błędem.",
        "action_hint": "Sprawdź sesję KSeF i spróbuj ponownie. Jeśli problem się powtarza, skontaktuj się z supportem i podaj datę oraz kod błędu.",
        "action_url": "/ksef",
    },
    "KSEF_DOWNLOAD_FAILED": {
        "title": "Nie udało się pobrać pliku z KSeF",
        "description": "Pobranie XML lub podglądu faktury z KSeF nie powiodło się.",
        "action_hint": "Zaloguj się ponownie do KSeF i spróbuj otworzyć fakturę jeszcze raz.",
        "action_url": "/ksef",
    },
    "KSEF_OCR_FAILED": {
        "title": "Nie udało się odczytać faktury papierowej",
        "description": "Skan faktury nie został rozpoznany (format pliku, rozmiar lub limit zapytań).",
        "action_hint": "Użyj czytelnego zdjęcia JPG/PNG (max. dozwolony rozmiar) i spróbuj ponownie za chwilę.",
        "action_url": "/ksef/scan-paper",
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
    "ORDER_STOCK_SHORTFALL": {
        "title": "Za mało towaru na stanie",
        "description": "Nie można potwierdzić zamówienia, bo na magazynie głównym brakuje produktów.",
        "action_hint": "Przyjmij dostawę (PZ), zmniejsz ilości na zamówieniu albo włącz ujemny stan na magazynie głównym.",
        "action_url": "/orders/{object_id}",
    },
    # ── Warehouse / delivery ─────────────────────────────────────────────────
    "STOCK_SHORTFALL": {
        "title": "Za mało towaru na stanie",
        "description": "Operacja magazynowa wymaga większej ilości niż jest dostępna.",
        "action_hint": "Sprawdź stany w Magazynach, przyjmij PZ albo zmniejsz ilość na dokumencie.",
        "action_url": "/delivery",
    },
    "DELIVERY_WRONG_STATUS": {
        "title": "Dokument w niewłaściwym statusie",
        "description": "Tej operacji nie można wykonać na dokumencie w obecnym statusie (np. szkic zamiast zapisany).",
        "action_hint": "Sprawdź status dokumentu WZ/PZ i wykonaj brakujący krok (zapisz, rozpocznij dostawę, zakończ).",
        "action_url": "/delivery/{object_id}",
    },
    "PZ_NO_WAREHOUSE": {
        "title": "Brak magazynu przy tworzeniu PZ",
        "description": "Aby utworzyć przyjęcie towaru (PZ), trzeba wybrać magazyn docelowy.",
        "action_hint": "Wybierz magazyn i utwórz PZ ponownie.",
        "action_url": "/purchase-documents",
    },
    "PZ_DUPLICATE": {
        "title": "PZ dla tej faktury już istnieje",
        "description": "Dla tej faktury zakupowej jest już utworzone przyjęcie towaru.",
        "action_hint": "Otwórz istniejący dokument PZ zamiast tworzyć nowy.",
        "action_url": "/delivery",
    },
    "PZ_MATCH_FAILED": {
        "title": "Nie udało się powiązać linii PZ z fakturą",
        "description": "Potwierdzenie zgodności linii faktury zakupowej z PZ nie powiodło się.",
        "action_hint": "Sprawdź ilości i produkty na fakturze oraz na PZ, potem potwierdź powiązanie ponownie.",
        "action_url": "/purchase-documents/{object_id}",
    },
    "PURCHASE_DOC_LOCKED": {
        "title": "Dokument zakupu zablokowany",
        "description": "Tego dokumentu zakupu nie można zmienić, bo jest powiązany lub zamknięty.",
        "action_hint": "Odłącz PZ albo otwórz dokument w statusie, który pozwala na edycję.",
        "action_url": "/purchase-documents/{object_id}",
    },
    "PRODUCTION_NO_WAREHOUSE": {
        "title": "Brak magazynu do zakończenia produkcji",
        "description": "Zakończenie zlecenia produkcji wymaga aktywnego magazynu głównego (RW surowców i PW wyrobów).",
        "action_hint": "Utwórz magazyn główny, a następnie zakończ zlecenie ponownie.",
        "action_url": "/warehouses",
    },
    "CERTIFICATE_INVALID": {
        "title": "Nieprawidłowy certyfikat KSeF",
        "description": "Wgrany plik certyfikatu lub klucza nie mógł zostać odczytany.",
        "action_hint": "Wgraj certyfikat .p12/.crt i klucz w formacie obsługiwanym przez KSeF.",
        "action_url": "/settings/certificate",
    },
    "PERMISSION_DENIED": {
        "title": "Brak uprawnień",
        "description": "Twoje konto nie ma uprawnienia do wykonania tej operacji.",
        "action_hint": "Poproś administratora firmy o nadanie uprawnienia albo wykonaj operację na koncie z odpowiednią rolą.",
        "action_url": "/settings/team",
    },
    "IMPORT_ROW_ERRORS": {
        "title": "Import zakończony z błędami w wierszach",
        "description": "Plik został wczytany, ale część wierszy nie mogła zostać zapisana.",
        "action_hint": "Pobierz szablon, popraw wskazane wiersze i wgraj plik ponownie.",
        "action_url": None,
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


def get_error_info(error_code: str, error_detail: str = "") -> dict:
    """Return human-readable info for a given error_code.

    When ``error_detail`` is present it is appended so the user sees the real
    reason (KSeF reject text, stock shortfall, FA-3 validation) instead of
    only the catalog sentence.
    """
    detail = (error_detail or "").strip()
    catalog = ERROR_MESSAGES.get(error_code)
    if catalog is None:
        return {
            "title": "Nieznany błąd" if error_code else "Błąd operacji",
            "description": detail or "Wystąpił nieoczekiwany błąd.",
            "action_hint": (
                "Sprawdź szczegóły i spróbuj ponownie. Jeśli problem się powtarza, "
                "skontaktuj się z supportem i podaj kod błędu oraz datę i godzinę."
            ),
            "action_url": None,
        }

    description = catalog["description"]
    if detail and detail not in description:
        description = f"{description} Szczegóły: {detail}"

    return {
        "title": catalog["title"],
        "description": description,
        "action_hint": catalog["action_hint"],
        "action_url": catalog["action_url"],
    }
