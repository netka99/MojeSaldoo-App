"""
Management command: check_zus_constants
========================================
Displays current statutory ZUS/PIT constants from services.py
and instructions for yearly update.

Usage:
    python manage.py check_zus_constants

Run every January after ZUS/GUS announces new rates.
"""
import sys

from django.core.management.base import BaseCommand

from apps.cash_flow.services import (
    _HEALTH_LINIOWY_MAX_MONTHLY,
    _MIN_HEALTH_2026,
    _PIT_FREE_MONTHLY,
    _RYCZALT_HEALTH_TIER1,
    _RYCZALT_HEALTH_TIER2,
    _RYCZALT_HEALTH_TIER3,
    _ZUS_FULL_SOCIAL_NO_SICK,
    _ZUS_FULL_SOCIAL_SICK,
    _ZUS_PREF_SOCIAL_NO_SICK,
    _ZUS_PREF_SOCIAL_SICK,
)

SEP = "=" * 60
SEP2 = "-" * 60


class Command(BaseCommand):
    help = "Shows current statutory ZUS/PIT constants and yearly update instructions."

    def handle(self, *args, **options):
        # Force UTF-8 on Windows so Polish chars don't crash colorama
        if sys.platform == "win32":
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")

        rows = [
            ("ZUS spoleczny - pelny  Z chorobowym",       _ZUS_FULL_SOCIAL_SICK),
            ("ZUS spoleczny - pelny  BEZ chorobowego",    _ZUS_FULL_SOCIAL_NO_SICK),
            ("ZUS spoleczny - prefer. Z chorobowym",      _ZUS_PREF_SOCIAL_SICK),
            ("ZUS spoleczny - prefer. BEZ chorobowego",   _ZUS_PREF_SOCIAL_NO_SICK),
            ("Skladka zdrowotna - minimum",               _MIN_HEALTH_2026),
            ("Skladka zdrowotna - ryczalt tier1 (<60k)",  _RYCZALT_HEALTH_TIER1),
            ("Skladka zdrowotna - ryczalt tier2 (60-300k)", _RYCZALT_HEALTH_TIER2),
            ("Skladka zdrowotna - ryczalt tier3 (>300k)", _RYCZALT_HEALTH_TIER3),
            ("Kwota wolna PIT (miesiecznie)",             _PIT_FREE_MONTHLY),
            ("Limit odliczenia zdrowotnej liniowy/mies.", _HEALTH_LINIOWY_MAX_MONTHLY),
        ]

        print(f"\n{SEP}")
        print("  STALE USTAWOWE ZUS/PIT -- aktualne wartosci w kodzie")
        print(SEP)
        for label, value in rows:
            print(f"  {label:<50}  {value:>9} PLN")
        print(SEP2)
        print("  JAK ZAKTUALIZOWAC (co roku w styczniu):\n")
        print("  1. Sprawdz nowe stawki:")
        print("     -> zus.pl/baza-wiedzy/skladki (wysokosc skladek)")
        print("     -> stat.gov.pl (srednie wynagrodzenie Q4 poprzedniego roku)\n")
        print("  2. Zaktualizuj stale w pliku:")
        print("     backend/apps/cash_flow/services.py  (linia ~23)\n")
        print("  3. Wzory (opisane w komentarzu przy stalych):")
        print("     _MIN_HEALTH_*    = min_wynagrodzenie x 9%")
        print("     _ZUS_FULL_*      = progn_sr_wynagrodzenie x stawka_ZUS")
        print("     _RYCZALT_TIER*   = % x sr_wynagrodzenie_Q4\n")
        print("  4. Uruchom testy:")
        print("     python manage.py test apps.cash_flow.tests.test_dashboard")
        print(f"{SEP}\n")
