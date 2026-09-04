"""
Application-level request-resource guards.

A reverse proxy may not be present (or may not enforce body-size limits), so
Django itself rejects oversized request bodies up front instead of allowing a
huge body to reach serializers, storage, or document generation.
"""

from django.conf import settings
from django.http import JsonResponse


class RequestBodySizeLimitMiddleware:
    """
    Reject requests whose ``Content-Length`` exceeds
    ``MAX_REQUEST_BODY_SIZE`` with ``413 Payload Too Large`` before any
    serializer/view work happens.

    The limit is read from settings on every request, so it stays consistent
    with the configured environment. This is an application-level guard and is
    not a substitute for a web-server/proxy body cap; requests without a
    ``Content-Length`` (e.g. chunked transfer) are the server's responsibility.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        max_body_bytes = getattr(settings, "MAX_REQUEST_BODY_SIZE", None)
        if max_body_bytes is not None:
            content_length = request.META.get("CONTENT_LENGTH")
            if (
                content_length is not None
                and content_length.isdigit()
                and int(content_length) > max_body_bytes
            ):
                return JsonResponse(
                    {"detail": "Request body too large."},
                    status=413,
                )
        return self.get_response(request)