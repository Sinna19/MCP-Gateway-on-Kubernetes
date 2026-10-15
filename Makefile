SHELL := bash
NS := urumi
CHARTS := store woo-mcp gateway upstreams platform

.PHONY: cluster-up cluster-down images deps secrets deploy lint test dod

cluster-up:
	scripts/cluster-up.sh

cluster-down:
	scripts/cluster-down.sh

# Build service images and import them into k3d. Nothing to build until Phase 2.
images:
	@echo "images: no services yet"

deps:
	helm dependency update charts/platform >/dev/null

secrets:
	scripts/secrets.sh

deploy: deps secrets
	helm upgrade --install platform charts/platform -n $(NS) --create-namespace -f deploy/values-local.yaml
	scripts/wait-setup.sh

# Prints failures only, then a one-line summary. eslint/tsc get added with the first TS service.
lint: deps
	@fail=0; \
	for c in $(CHARTS); do \
	  out=$$(helm lint charts/$$c -f deploy/values-local.yaml 2>&1) || { echo "$$out" | tail -20; fail=1; }; \
	done; \
	out=$$(helm template platform charts/platform -f deploy/values-local.yaml 2>&1 >/dev/null) || { echo "$$out" | tail -20; fail=1; }; \
	if [ $$fail = 0 ]; then echo "lint: ok"; else echo "lint: FAILED"; exit 1; fi

# No tests until Phase 2/3. Becomes the unit-test runner with a dot reporter.
test:
	@echo "test: no tests yet"

dod:
	scripts/dod-check.sh
