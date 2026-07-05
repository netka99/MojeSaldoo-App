.PHONY: images

default:
	@echo Choose a target: images test container-test

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
	@cd backend && make test

container-test:
	 @DJANGO_SECRET_KEY=test-secret podman compose --profile test run --rm --build backend-test


