from rest_framework import serializers

from apps.common.serializers import UUIDModelSerializer

from .models import CostProject, InvoiceAnnotation, InvoiceLineAnnotation, InvoiceLineAnnotationSplit


class CostProjectSerializer(UUIDModelSerializer):
    class Meta:
        model = CostProject
        fields = ["id", "name", "code", "color", "is_active", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]


class InvoiceAnnotationSerializer(UUIDModelSerializer):
    """Full invoice annotation including per-line annotations keyed by line position."""

    line_annotations = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceAnnotation
        fields = [
            "id",
            "accounting_status",
            "accounting_notes",
            "exported_at",
            "updated_at",
            "line_annotations",
        ]
        read_only_fields = ["exported_at", "updated_at"]

    def get_line_annotations(self, obj) -> dict:
        """Return {position: {isPrivate, note, splits: [{id, project, projectName, percentage, note}]}}"""
        result = {}
        for line in (
            obj.invoice.lines
            .prefetch_related("annotation__splits__project", "annotation__project")
            .all()
        ):
            try:
                ann = line.annotation
                splits = [
                    {
                        "id": str(s.id),
                        "project": str(s.project_id) if s.project_id else None,
                        "projectName": s.project.name if s.project else None,
                        "percentage": str(s.percentage),
                        "quantity": str(s.quantity) if s.quantity is not None else None,
                        "note": s.note,
                    }
                    for s in ann.splits.all()
                ]
                # Back-compat: if no splits but legacy project set, synthesise a 100% split
                if not splits and ann.project_id:
                    splits = [{
                        "id": None,
                        "project": str(ann.project_id),
                        "projectName": ann.project.name if ann.project else None,
                        "percentage": "100",
                        "quantity": None,
                        "note": "",
                    }]
                result[str(line.position)] = {
                    "isPrivate": ann.is_private,
                    "note": ann.note,
                    "splits": splits,
                }
            except InvoiceLineAnnotation.DoesNotExist:
                result[str(line.position)] = {
                    "isPrivate": False,
                    "note": "",
                    "splits": [],
                }
        return result
