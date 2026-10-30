# Instrukcje konfiguracji MojeSaldoo

Plik dla Ciebie (właścicielki aplikacji) i jako baza pod manual użytkownika.
Każdy przypadek opisuje: co ustawić, gdzie w UI, co to robi.

---

## Przypadek 1 — Piekarnia / produkcja na bieżąco (np. siostra)

**Profil:** Firma produkuje codziennie z surowców (ziemniaki, mięso → kartacze, babka).
Wyroby nie leżą na półce — są pieczone pod zamówienie i od razu wywożone.
Chce widzieć koszt wytworzenia, ale nie prowadzi ewidencji stanów gotowych wyrobów.

### Co włączyć w Ustawienia → Moduły

| Moduł | Stan | Dlaczego |
|-------|------|----------|
| Produkty i koszty | ✅ zawsze włączony | katalog i koszty |
| Wiele magazynów | ❌ wyłączony | jedna lokalizacja |
| Zamówienia | ✅ włączony | sklepy zamawiają dzień wcześniej |
| Dostawa i WZ | ✅ włączony | WZ do każdego sklepu |
| Produkcja | ✅ włączony | zlecenia i koszty wytworzenia |
| Zakupy | ✅ włączony | PZ od dostawców surowców |
| Fakturowanie | ✅ włączony | faktura zbiorcza co 2 tygodnie |

### Jak skonfigurować produkty

**Surowce (ziemniaki, mięso, jajka):**
- Produkty → Nowy produkt
- Typ: `🧱 Surowiec`
- Śledzenie partii (FIFO): **włączone** — żeby system wiedział ile kosztuje kg ziemniaka
- Produkt do sprzedaży: **wyłączone** — surowiec nie trafia na faktury

**Wyroby gotowe (kartacze, babka ziemniaczana):**
- Produkty → Nowy produkt
- Typ: `📦 Wyrób gotowy`
- Śledzenie partii (FIFO): **wyłączone** — nie trzyma stanów, produkuje na bieżąco
- Produkt do sprzedaży: **włączone** — trafia na WZ i faktury

### Codzienny flow

```
1. Sklepy dzwonią → wpisuje Zamówienia (ZAM) dla każdego sklepu
2. Ekran Produkcja → "Co wyprodukować" → widzi: 35 kartaczy, 3 babki
   → klika "+ Zlecenie" → system odpisuje surowce i liczy koszt
3. Wyjeżdża → WZ per sklep (z zamówienia)
4. Następny dzień → zwroty ZW do tych samych WZ
5. Co 2 tygodnie → Faktura zbiorcza per sklep z WZ-ów
```

### Co widzi na ekranie Produkcja

- Zamówiono: 35 szt. — bez "niedoboru" (bo wyroby nie mają stanu)
- Koszt produkcji: np. 48 zł (wyliczony z FIFO surowców)
- Przycisk `+ Zlecenie` zawsze aktywny

---

## Przypadek 2 — Producent z magazynem wyrobów (dżemy, kosmetyki, świece)

**Profil:** Firma produkuje partie, trzyma gotowy towar na magazynie.
Wydaje z magazynu gdy klient zamawia. Chce widzieć stan i niedobory.

### Co włączyć w Ustawienia → Moduły

| Moduł | Stan | Dlaczego |
|-------|------|----------|
| Produkty i koszty | ✅ zawsze włączony | — |
| Wiele magazynów | ❌ wyłączony | jedna lokalizacja wystarczy |
| Produkcja | ✅ włączony | receptury i zlecenia |
| Zakupy | ✅ włączony | PZ surowców |
| Zamówienia | ✅ włączony | — |
| Dostawa i WZ | ✅ włączony | — |
| Fakturowanie | ✅ włączony | — |

### Jak skonfigurować produkty

**Surowce (słoiki, owoce, wosk):**
- Typ: `🧱 Surowiec`
- Śledzenie partii (FIFO): **włączone**
- Produkt do sprzedaży: **wyłączone**

**Wyroby gotowe (dżem truskawkowy 250g):**
- Typ: `📦 Wyrób gotowy`
- Śledzenie partii (FIFO): **włączone** — system śledzi ile jest na stanie
- Produkt do sprzedaży: **włączone**

### Codzienny flow

```
1. Produkuje partię → Zlecenie produkcji → wyroby wchodzą do magazynu (PW)
2. Klient zamawia → ZAM → WZ → wyroby schodzą ze stanu
3. Ekran Produkcja pokazuje "niedobór" gdy zamówienia > stan
4. Faktura z WZ-ów
```

### Co widzi na ekranie Produkcja

- Stan: 24 szt. · Zamówiono: 30 szt.
- `niedobór 6 szt.` — czerwony badge
- Przycisk `+ Zlecenie` aktywny gdy jest niedobór

---

## Przypadek 3 — Van selling (handlowiec z busem)

**Profil:** Rano ładuje busa z magazynu, jedzie do klientów, wystawia WZ na miejscu.
Wieczorem rozlicza trasę. Towar kupiony od hurtowni (nie produkuje).

### Co włączyć w Ustawienia → Moduły

| Moduł | Stan | Dlaczego |
|-------|------|----------|
| Produkty i koszty | ✅ — | — |
| Wiele magazynów | ✅ **włączony** | MG (magazyn główny) + van osobno |
| Zamówienia | ✅ — | zbiera zamówienia dzień wcześniej |
| Dostawa i WZ | ✅ — | WZ u klienta |
| Zakupy | ✅ — | PZ od hurtowni |
| Fakturowanie | ✅ — | — |
| Produkcja | ❌ wyłączony | nie produkuje |

### Jak skonfigurować produkty

**Towar (napoje, artykuły spożywcze):**
- Typ: `🛒 Towar handlowy`
- Śledzenie partii (FIFO): **włączone**
- Produkt do sprzedaży: **włączone**

### Codzienny flow

```
1. Rano: MM (przesunięcie) MG → van — towar wychodzi z głównego do vana
2. U klienta: WZ z magazynu van
3. Zwroty: ZW powiązane z WZ
4. Wieczorem: MM-P van → MG (co wróciło)
5. Faktura zbiorcza per klient
```

---

## Przypadek 4 — Tylko fakturowanie (usługi, biuro)

**Profil:** Firma świadczy usługi. Nie ma towaru ani magazynu. Tylko faktury.

### Co włączyć

| Moduł | Stan |
|-------|------|
| Produkty i koszty | ✅ (dla katalogu usług) |
| Fakturowanie | ✅ |
| KSeF | ✅ jeśli wysyła e-faktury |
| Reszta | ❌ wyłączone |

### Jak skonfigurować produkty

- Typ: `🛎️ Usługa`
- Śledzenie partii: automatycznie wyłączone
- Produkt do sprzedaży: **włączone**

---

## Gdzie jest co w UI

| Co | Gdzie |
|----|-------|
| Włączanie modułów | Ustawienia → Moduły |
| Dodanie produktu | Produkty → `+ Nowy produkt` → wybierz typ |
| Zmiana typu produktu | Produkty → kliknij produkt → Edytuj → zmień typ na górze |
| Toggle "Śledzenie partii" | Produkty → Edytuj → przewiń na dół formularza |
| Toggle "Produkt do sprzedaży" | Produkty → Edytuj → przewiń na dół formularza |
| Zlecenie produkcji | Produkcja → `+ Nowe zlecenie` lub z ekranu planowania |
| Korektę stanu (gdy stan się "zamroził") | Produkty → kliknij produkt → `Koryguj stan` |

---

## Czym się różni "Śledzenie partii (FIFO)" od śledzenia stanu

**Śledzenie partii włączone:**
- System pamięta każdą dostawę osobno (partia z 12.10, partia z 20.10)
- Przy zużyciu/sprzedaży odejmuje od najstarszej partii najpierw (FIFO)
- Zna koszt każdej partii → liczy realny koszt wytworzenia

**Śledzenie partii wyłączone:**
- System nie prowadzi stanu tego produktu
- Przy produkcji nie odejmuje wyrobu z magazynu ani nie dodaje
- Używaj dla wyrobów pieczonych/robionych na bieżąco pod zamówienie

> Uwaga: surowce zawsze powinny mieć śledzenie partii włączone —
> inaczej system nie będzie mógł policzyć kosztu wytworzenia.
