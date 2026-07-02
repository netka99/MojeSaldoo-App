.PHONY: images

default: images

images:
	podman build \
		-f automation/containers/backend/Containerfile \
		-t mojesaldoo-backend:latest \
		.
	podman build \
		-f automation/containers/frontend/Containerfile \
		-t mojesaldoo-frontend:latest \
		.

test:
	 @DJANGO_SECRET_KEY=test-secret podman compose --profile test run --rm --build backend-test


