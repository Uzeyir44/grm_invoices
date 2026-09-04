"""
Throttling helpers for the generated-documents API.
"""

from rest_framework.throttling import ScopedRateThrottle


class WriteScopedRateThrottle(ScopedRateThrottle):
    """
    ``ScopedRateThrottle`` that only throttles mutating requests
    (POST/PATCH/PUT/DELETE). Read-only requests (GET/HEAD/OPTIONS) pass
    through untouched, so a cheap list endpoint sharing a view with an
    expensive create endpoint is never rate-limited by the create scope.
    """

    def allow_request(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return super().allow_request(request, view)