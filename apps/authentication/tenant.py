"""
Tenant-isolation helpers for tenant-owned models (models with a ``company``
foreign key that points to ``companies.Company``).

The authenticated user's company — ``request.user.company`` — is the ONLY
tenant boundary. These helpers never accept a company id from request data;
doing so would let a client pick another tenant's context. The rules they
encode:

    Rule A  Never trust frontend company IDs for authorization.
    Rule B  request.user.company_id is the authoritative tenant boundary.
    Rule C  Querysets are tenant-scoped: Model.objects.filter(company_id=...).
    Rule D  Single-object access is tenant-scoped too; a cross-tenant object
            is indistinguishable from a missing one (HTTP 404).
    Rule E  Nested relationships must reach the tenant boundary through
            their parent chain (use these helpers on each parent level).

Future feature views should prefer queryset scoping (Rules C/D) over
post-fetch filtering: with ``tenant_queryset``/``get_tenant_object_or_404``
a cross-tenant object never reaches the serializer in the first place.
"""

from django.http import Http404


def tenant_queryset(model, company):
    """Return a queryset restricted to rows belonging to ``company``.

    Chainable: add ``.get(...)``, ``.filter(...)``, ``.select_related(...)``,
    etc. on the result.
    """
    return model.objects.all().filter(company_id=company.id)


def get_tenant_object_or_404(model, company, **lookup):
    """Fetch one object that must belong to ``company``.

    The tenant boundary is always applied, even if ``lookup`` happens to
    contain a ``company_id``. If the row does not exist or belongs to another
    company, Http404 is raised — cross-tenant existence is never revealed
    (this is what protects against IDOR by guessing another company's pk).
    """
    filters = dict(lookup)
    filters["company_id"] = company.id
    try:
        return model.objects.get(**filters)
    except model.DoesNotExist:
        raise Http404("No object found matching the query") from None


def belongs_to_company(company, obj):
    """True when ``obj`` belongs to ``company``.

    Works for objects that carry ``company``/``company_id`` directly. For
    nested models the caller must resolve the tenant boundary through the
    parent chain (Rule E) and may then pass the resolved parent here.
    """
    obj_company_id = getattr(obj, "company_id", None)
    if obj_company_id is None:
        return False
    return company is not None and obj_company_id == company.id