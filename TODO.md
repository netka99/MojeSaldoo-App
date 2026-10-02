## GDPR / Prawne

- [ ] **Anonimizacja danych przed wysłaniem do Gemini API**
  - Przed wysłaniem `raw_text` do Gemini: zamień NIP (10 cyfr) i daty na tokeny `[NIP_0]`, `[DATA_0]` itp.
  - Po otrzymaniu odpowiedzi: podstaw oryginalne wartości z powrotem
  - Zaimplementowane w `backend/apps/ksef/views.py` → funkcja `anonymize_for_llm()`

- [ ] **Regulamin / Polityka prywatności — wzmianka o AI**
  - Dodać klauzulę: *"Treść skanowanych dokumentów (po anonimizacji danych osobowych) może być przetwarzana przez zewnętrzne modele AI (Google Gemini) w celu automatycznego rozpoznawania struktury dokumentu. Dane osobowe (NIP, nazwy firm) nie są przesyłane do zewnętrznych systemów AI."*
  - Wymagane: podpisanie DPA (Data Processing Agreement) z Google → console.cloud.google.com → IAM → Data Processing Terms

- [ ] **Limit użycia AI per user**
  - Wolny plan: 50 skanów/miesiąc z LLM fallback, powyżej tylko regex
  - Śledzenie w modelu `Company` lub osobnej tabeli `AiUsage`

- [ ] **Logowanie wywołań AI**
  - Logować: user_id, company_id, doc_type, timestamp, użyty model — BEZ treści dokumentu
  - Cel: audyt GDPR na żądanie użytkownika ("jakie dane przetwarzałeś o mnie?")

---

1.Testing:
    - PZ-KOR - create KOR invoice from supplier
    - removing an account


---

## Testowanie manualne — Faktury ZAL / ROZ

Faktury zaliczkowe (ZAL) i rozliczeniowe (ROZ) są w pełni zaimplementowane.
Poniżej instrukcja jak to przetestować ręcznie.

### Wymagania wstępne
- Zaloguj się jako firma z wypełnionym NIP
- Miej aktywnego klienta z NIP-em

### Krok 1: Wystaw fakturę zaliczkową (ZAL)

1. Wejdź na `/invoices/new/manual`
2. W prawym górnym rogu zmień typ faktury z `Podstawowa` na `Zaliczkowa`
3. Wybierz klienta
4. Dodaj pozycję (np. "Zaliczka na usługę", cena 500 zł, VAT 23%)
5. Ustaw daty i metodę płatności
6. Kliknij **Wystaw fakturę** → zostaniesz przeniesiony na stronę faktury
7. Zweryfikuj:
   - Faktura ma typ `ZAL` (widoczny w sekcji KSeF opcje)
   - Status: `Szkic` → kliknij **Wystaw** → status zmienia się na `Wystawiona`

### Krok 2: Wystaw fakturę rozliczeniową (ROZ)

1. Wejdź na `/invoices/new/manual`
2. Zmień typ faktury na `Rozliczeniowa`
3. Wybierz **tego samego klienta** co przy ZAL
4. W sekcji **"Faktury zaliczkowe (ZAL) do rozliczenia"** powinna pojawić się lista dostępnych ZAL
   - Zaznacz checkboxem fakturę zaliczkową z Kroku 1
5. Dodaj pozycję rozliczeniową (np. "Rozliczenie usługi", cena 300 zł — może być mniej niż ZAL)
6. Kliknij **Wystaw fakturę**
7. Zweryfikuj na stronie faktury:
   - Typ: `ROZ`
   - Sekcja **"Faktury zaliczkowe"** wyświetla powiązaną ZAL z numerem i kwotą
   - KSeF XML (pobierz przez przycisk XML): powinien zawierać blok `<Rozliczenie>` z `<Obciazenia>` i `<Odliczenia>`

### Przypadki błędów (powinny być blokowane)

- **ROZ bez ZAL**: przycisk "Wystaw fakturę" jest wyszarzony gdy nie wybrano żadnej ZAL (przy typie ROZ)
- **ROZ kwota > ZAL suma**: backend zwróci błąd 400 — np. ZAL = 100 zł, ROZ pozycja = 200 zł
- **ZAL z innego klienta**: nie pojawi się na liście do wyboru
- **ZAL już rozliczona**: nie pojawi się na liście (endpoint `/api/invoices/available-zal/` wyklucza)

### Weryfikacja w panelu KSeF

1. Wystaw ZAL → kliknij "Wyślij do KSeF" → brak błędu o "zablokowanym typie ZAL"
2. Wystaw ROZ (z przypisaną ZAL) → pobierz XML → sprawdź w XML:
   ```xml
   <Rozliczenie>
     <Obciazenia>
       <WartoscObciazen>300.00</WartoscObciazen>
     </Obciazenia>
     <Odliczenia>
       <NrFaZaliczkowej>ZAL/2026/...</NrFaZaliczkowej>
       <WartoscOdliczen>500.00</WartoscOdliczen>
     </Odliczenia>
     <P_15ZAL>0</P_15ZAL>
   </Rozliczenie>
   ```
3. Sprawdź pole `<P_15ZAL>` — kwota pozostała do zapłaty po zaliczkach:
   - Przykład: ROZ = 1000 zł, ZAL = 300 zł → `<P_15ZAL>700</P_15ZAL>`
   - Przykład: ROZ = 200 zł, ZAL = 500 zł → `<P_15ZAL>0</P_15ZAL>` (nie może być ujemne)
   - Gdy ZAL była wysłana do KSeF: zamiast `<NrFaZaliczkowej>` pojawia się `<NrKSeFFaZaliczkowej>` z numerem KSeF

---

- Poprawić magazyny, FIFO nie widoczne, lista produktow, lot, data
- Jak rozwiązać wpisywanie faktur z pdf - scan - AI?
- 

- Raporty dla ksiegowych - z jednego miejsca

- warto mieć dokument zamówienia do dostawcy (często oznaczany jako ZD lub PO – Purchase Order), nawet w aplikacji dla małych i mikrofirm. Z punktu widzenia architektury nie jest to zarezerwowane wyłącznie dla korporacji. - zastanowic sie jak

- kontrola nad magazynami

- proforma ksef

2.  Recorded / Replay Testing (E2E Tests)
What you're thinking of is End-to-End (E2E) testing. The idea: you interact with the app like a real user, the tool records those interactions, then replays them automatically on every change.

Best options for your React + Django stack:
Playwright (recommended)

3.  UI/UX Polish
This is broader. The main approaches:

Automated audits (instant wins)
Lighthouse (built into Chrome DevTools) — scores your app on performance, accessibility, best practices
axe DevTools (browser extension) — finds accessibility issues (contrast, missing labels, etc.)
I have Chrome DevTools MCP available — I can run these audits on your running app right now
Manual UX review strategies
Heuristic evaluation — go through Nielsen's 10 usability heuristics against your own screens
User flows — map every key flow (login → create order → invoice) and look for friction points
Mobile responsiveness — test on small screens, your target users (bakeries, van sellers) may use phones
Design consistency
Check spacing, font sizes, button styles are consistent
Color contrast meets WCAG AA (4.5:1 ratio)
Loading states, empty states, error messages all handled

====================================
IDEAS FOR FUTURE REPORTS:
1. The Cash Conversion Cycle Speed (Szybkość Obrotu Gotówką)
Small business owners often look at their invoices and wonder: "Why is my paper profit so high, but I can't afford to pay my suppliers on time?" A CFO looks at the time lag between operational events to pinpoint where cash gets stuck.

How to build it with your modules: Track the timestamps between three existing data points:

Order Created (in your Zamówienia module)

Invoice Issued (in your Fakturowanie module)

Invoice Marked Paid (by the user)

The Pocket Analyst Insight: A simple visual timeline showing their Average Days to Cash. The app reports: "It takes your team an average of 9 days to turn an approved order into an invoice, and clients take another 22 days to pay it. Your cash is locked up for 31 days. Shaving 3 days off your internal fulfillment speed will free up cash immediately."

2. Revenue Concentration Risk (Bezpieczeństwo Przychodów)
A classic business vulnerability occurs when a company relies too heavily on one or two clients. If that major client leaves or delays a payment, the small business can face sudden financial distress.

How to build it with your modules: Analyze your Marża na Klientach data over a rolling 90-day period. Calculate what percentage of total revenue is tied to each individual customer.

The Pocket Analyst Insight: A warning card titled "Revenue Safety Check." If a single client crosses 30% or 40% of their total invoiced volume, the app alerts them: "Client XYZ represents 45% of your total business income this quarter. This concentration leaves your cash flow highly exposed if their payment schedules shift. Consider diversifying your order pipeline."

3. Cost-to-Revenue Elasticity (Elastyczność Kosztowa)
When business sales start climbing, owners are happy and often stop paying close attention to operational expenses. A CFO monitors whether expanding sales are actually being eaten up by faster-growing overhead.

How to build it with your modules: Compare the monthly growth rate of issued sales invoices against the growth rate of incoming KSeF purchase invoices.

The Pocket Analyst Insight: A simple visual trend metric showing Margin Efficiency. The app alerts the user: "Your sales revenue grew by 10% this month, but your operational spending via KSeF grew by 18%. Your business is becoming more expensive to run as it expands—look at your vendor pricing tags to locate the creep."


Rok 2027 (do zrobienia w styczniu 2027)
 Sprawdzić nowe min. wynagrodzenie
 Sprawdzić prognozowane śr. wynagrodzenie ZUS
 Sprawdzić śr. wynagrodzenie Q4 2026 (GUS)
 Zaktualizować services.py
 Przejść testy