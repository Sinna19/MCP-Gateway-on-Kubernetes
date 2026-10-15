SHELL := bash
NS := urumi
CHARTS := store woo-mcp gateway upstreams platform
TS_SERVICES := woo-mcp gateway

.NOTPARALLEL:
.PHONY: cluster-up cluster-down images deps secrets deploy lint test dod

cluster-up:
	scripts/cluster-up.sh

cluster-down:
	scripts/cluster-down.sh

# Tag = hash of the service directory in git, so it changes only when the service changes.
# Commit service changes before `make deploy`, or the tag (and the running pod) stays the same.
WOO_MCP_TAG := $(shell git rev-parse --short HEAD:services/woo-mcp)
GATEWAY_TAG := $(shell git rev-parse --short HEAD:services/gateway)

# Build service images and import them into k3d (cached builds are fast).
images:
	docker build -q -t urumi/woo-mcp:$(WOO_MCP_TAG) services/woo-mcp
	k3d image import -c urumi urumi/woo-mcp:$(WOO_MCP_TAG)
	docker build -q -t urumi/gateway:$(GATEWAY_TAG) services/gateway
	k3d image import -c urumi urumi/gateway:$(GATEWAY_TAG)

deps:
	helm dependency update charts/platform >/dev/null

secrets:
	scripts/secrets.sh

deploy: deps secrets images
	helm upgrade --install platform charts/platform -n $(NS) --create-namespace -f deploy/values-local.yaml \
	  --set woo-mcp.image.tag=$(WOO_MCP_TAG) --set gateway.image.tag=$(GATEWAY_TAG)
	scripts/wait-setup.sh

# Prints failures only, then a one-line summary. eslint/tsc get added with the first TS service.
lint: deps
	@fail=0; \
	for c in $(CHARTS); do \
	  out=$$(helm lint charts/$$c -f deploy/values-local.yaml --set image.tag=lint 2>&1) || { echo "$$out" | tail -20; fail=1; }; \
	done; \
	for v in local prod; do \
	  out=$$(helm template platform charts/platform -f deploy/values-$$v.yaml --set woo-mcp.image.tag=lint --set gateway.image.tag=lint 2>&1 >/dev/null) || { echo "$$out" | tail -20; fail=1; }; \
	done; \
	for s in $(TS_SERVICES); do \
	  out=$$(npm --prefix services/$$s run lint 2>&1) || { echo "$$out" | tail -20; fail=1; }; \
	done; \
	if [ $$fail = 0 ]; then echo "lint: ok"; else echo "lint: FAILED"; exit 1; fi

# Dot reporter prints failures only. Add each TS service to TS_SERVICES.
test:
	@fail=0; \
	for s in $(TS_SERVICES); do \
	  out=$$(npm --prefix services/$$s test 2>&1) || { echo "$$out" | tail -30; fail=1; }; \
	done; \
	if [ $$fail = 0 ]; then echo "test: ok"; else echo "test: FAILED"; exit 1; fi

dod:
	scripts/dod-check.sh
