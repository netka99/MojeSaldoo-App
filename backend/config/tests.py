from django.test import SimpleTestCase


class HealthCheckTests(SimpleTestCase):
    """The container HEALTHCHECK hits this endpoint; it must need no auth or DB."""

    def test_healthz_returns_ok(self):
        response = self.client.get('/healthz/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})
