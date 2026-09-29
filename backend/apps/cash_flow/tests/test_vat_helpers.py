"""Unit tests for shared VAT deduction helpers — never invent 23%."""

from decimal import Decimal

from django.test import SimpleTestCase

from apps.common.vat import deductible_vat, net_from_gross, parse_vat_rate


class ParseVatRateTests(SimpleTestCase):
    def test_parses_percent_and_comma(self):
        self.assertEqual(parse_vat_rate("8%"), Decimal("8"))
        self.assertEqual(parse_vat_rate("23,00"), Decimal("23.00"))

    def test_missing_or_zero_is_none(self):
        self.assertIsNone(parse_vat_rate(None))
        self.assertIsNone(parse_vat_rate(""))
        self.assertIsNone(parse_vat_rate("0"))


class DeductibleVatTests(SimpleTestCase):
    def test_stored_vat_full(self):
        self.assertEqual(
            deductible_vat(stored_vat=Decimal("76.00")),
            Decimal("76.00"),
        )

    def test_passenger_car_half(self):
        self.assertEqual(
            deductible_vat(stored_vat=Decimal("46.00"), vat_deduction="half"),
            Decimal("23.00"),
        )

    def test_private_is_zero(self):
        self.assertEqual(
            deductible_vat(stored_vat=Decimal("23.00"), is_private=True),
            Decimal("0.00"),
        )

    def test_gross_at_eight_percent(self):
        self.assertEqual(
            deductible_vat(gross=Decimal("108.00"), vat_rate="8"),
            Decimal("8.00"),
        )

    def test_missing_rate_does_not_invent_23(self):
        self.assertEqual(
            deductible_vat(gross=Decimal("123.00"), vat_rate=""),
            Decimal("0.00"),
        )

    def test_net_from_gross_keeps_gross_without_rate(self):
        self.assertEqual(net_from_gross(Decimal("50.00"), None), Decimal("50.00"))
        self.assertEqual(net_from_gross(Decimal("108.00"), "8"), Decimal("100.00"))
