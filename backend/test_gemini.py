"""
Quick test: send raw OCR text directly to Gemini and print the response.
Run: python test_gemini.py
"""
import json
import os
import urllib.request
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent / '.env')

API_KEY = os.environ.get("GEMINI_KEY", "")
print(f"Key loaded: {API_KEY[:10]}...{API_KEY[-4:]}")

# Sample text from the Biedronka invoice (same as what was sent)
RAW_TEXT = """
FAKTURA ORYGINAŁ
nr: 2868F00778/0726 Data sprzedaży 2026-07-08
BIEDRONKA "CODZIENNIE NISKIE CENY" 2868 SUWAŁKI
Bocz Bez Kości kg C C 0,686 KG OPUST 4,81 16,99 6,52 0,33 5 6,85
Bocz Bez Kości kg C C 0,682 KG OPUST -4,78 16,99 6,49 0,32 5 6,81
Bocz Bez Kości kg CC 0,564 KG -3,95 16.99 5,36 0,27 5 5,63
SzynkaWpVAC b k kg C C 1,279 KG OPUST -10,23 14,99 8,51 0,43 5 8,94
VAT% Wartość netto Wartość VAT Wartość brutto
5 154,36 7.72 162,08
"""

PROMPT = """Masz tekst polskiego paragonu lub faktury. Wyciągnij pozycje i zwróć TYLKO JSON:
{
  "lines": [
    {"name": "nazwa produktu", "quantity": 1.0, "unit": "szt", "unit_price": "0.00", "vat_rate": 23}
  ]
}
Zasady:
- vat_rate: liczba (A=23, B=8, C=5, D/E/F/G=0)
- unit_price: cena jednostkowa brutto po uwzględnieniu OPUST/rabatu
- Pomiń linie OPUST/RABAT jako osobne pozycje

Tekst:
""" + RAW_TEXT

# Try different model names
MODELS = [
    "gemini-2.5-flash",
    "gemini-3.6-flash",
    "gemini-flash-latest",
]

for model in MODELS:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}"
    payload = json.dumps({
        "contents": [{"parts": [{"text": PROMPT}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1024},
    }).encode()

    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read())
        text_out = body["candidates"][0]["content"]["parts"][0]["text"].strip()
        print(f"\nOK Model {model} WORKS!")
        print(text_out[:500])
        break
    except urllib.error.HTTPError as e:
        body_err = e.read().decode('utf-8', errors='replace')
        print(f"FAIL {model}: HTTP {e.code} {e.reason} - {body_err[:300]}")
    except Exception as e:
        print(f"FAIL {model}: {e}")
