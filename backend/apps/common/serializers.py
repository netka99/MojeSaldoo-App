"""Shared DRF building blocks for the int-PK / public-uuid model convention.

Every model uses a database auto-increment integer primary key internally, but
exposes a stable, unique ``uuid`` field as its public identifier. The API keeps
that contract: the JSON ``id`` is the object's uuid and relations are referenced
by uuid, while the int PK never leaves the backend.
"""

from rest_framework import serializers


class UUIDRelatedField(serializers.SlugRelatedField):
    """Reference a related object by its public ``uuid`` instead of the int PK.

    Reads serialize to the related object's uuid; writes resolve the uuid back to
    the instance (same as ``PrimaryKeyRelatedField`` otherwise).
    """

    def __init__(self, slug_field="uuid", **kwargs):
        super().__init__(slug_field=slug_field, **kwargs)


class UUIDModelSerializer(serializers.ModelSerializer):
    """ModelSerializer whose public identifier is the model's ``uuid``.

    - ``id`` maps to the model's ``uuid`` (read-only), keeping the int PK internal.
    - Auto-generated relations resolve by uuid via :class:`UUIDRelatedField`.
    """

    serializer_related_field = UUIDRelatedField
    id = serializers.UUIDField(source="uuid", read_only=True)
