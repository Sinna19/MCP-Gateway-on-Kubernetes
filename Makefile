SHELL := bash
NS := urumi

# ENV picks the cluster. local = k3d (default kubeconfig), prod = the VPS through the SSH tunnel (ADR 024).
# Every kubectl/helm call below names its context, so the default context is never used.
ENV ?= local
ifeq ($(ENV),prod)
KUBE_CONTEXT := urumi-vps
export KUBECONFIG := $(shell cygpath -m ~/.kube/urumi-vps.yaml)
# Domain = first word after "domain:" in values-prod.yaml (a trailing comment is cut off).
PROD_DOMAIN := $(shell sed -n "s/^  domain: *\([^ ]*\).*/\1/p" deploy/values-prod.yaml)
export GATEWAY_URL := https://app.$(PROD_DOMAIN)
else ifeq ($(ENV),local)
KUBE_CONTEXT := k3d-urumi
else
$(error ENV must be local or prod)
endif
export KUBE_CONTEXT
VALUES := deploy/values-$(ENV).yaml
KUBECTL := kubectl --context $(KUBE_CONTEXT)
HELM := helm --kube-context $(KUBE_CONTEXT)
CHARTS := store woo-mcp gateway upstreams dashboard platform
TS_SERVICES := woo-mcp gateway fx-mcp notes-mcp
TS_PROJECTS := $(addprefix services/,$(TS_SERVICES)) apps/dashboard

.NOTPARALLEL:
.PHONY: cluster-up cluster-down images deps secrets deploy register lint test dod rotate-key

# These manage the local k3d cluster only. On prod they refuse: deleting the namespace or its TLS Secrets
# would burn Let's Encrypt rate limits (5 duplicate certs per week on the shared sslip.io domain).
cluster-up:
ifeq ($(ENV),prod)
	@echo "REFUSING: cluster-up is local only (ENV=prod)" >&2; exit 1
endif
	scripts/cluster-up.sh

cluster-down:
ifeq ($(ENV),prod)
	@echo "REFUSING: never tear down the VPS release or namespace: it holds the Let's Encrypt certificates (rate limit, ADR 024)" >&2; exit 1
endif
	scripts/cluster-down.sh

# Tag = hash of the service directory in git, so it changes only when the service changes.
# Commit service and dashboard changes before `make images` or `make deploy`, or the tag (and the running pod) stays the same.
WOO_MCP_TAG := $(shell git rev-parse --short HEAD:services/woo-mcp)
GATEWAY_TAG := $(shell git rev-parse --short HEAD:services/gateway)
FX_MCP_TAG := $(shell git rev-parse --short HEAD:services/fx-mcp)
NOTES_MCP_TAG := $(shell git rev-parse --short HEAD:services/notes-mcp)
DASHBOARD_TAG := $(shell git rev-parse --short HEAD:apps/dashboard)

# Build service images and import them into k3d (cached builds are fast).
images:
ifeq ($(ENV),prod)
	@echo "images for prod need scripts/push-images.sh (session 2)" >&2; exit 1
endif
	docker build -q -t urumi/woo-mcp:$(WOO_MCP_TAG) services/woo-mcp
	k3d image import -c urumi urumi/woo-mcp:$(WOO_MCP_TAG)
	docker build -q -t urumi/gateway:$(GATEWAY_TAG) services/gateway
	k3d image import -c urumi urumi/gateway:$(GATEWAY_TAG)
	docker build -q -t urumi/fx-mcp:$(FX_MCP_TAG) services/fx-mcp
	k3d image import -c urumi urumi/fx-mcp:$(FX_MCP_TAG)
	docker build -q -t urumi/notes-mcp:$(NOTES_MCP_TAG) services/notes-mcp
	k3d image import -c urumi urumi/notes-mcp:$(NOTES_MCP_TAG)
	docker build -q -t urumi/dashboard:$(DASHBOARD_TAG) apps/dashboard
	k3d image import -c urumi urumi/dashboard:$(DASHBOARD_TAG)

deps:
	$(HELM) dependency update charts/platform >/dev/null

secrets:
	scripts/secrets.sh

deploy: deps secrets images
	$(HELM) upgrade --install platform charts/platform -n $(NS) --create-namespace -f $(VALUES) \
	  --set woo-mcp.image.tag=$(WOO_MCP_TAG) --set gateway.image.tag=$(GATEWAY_TAG) \
	  --set upstreams.fx.image.tag=$(FX_MCP_TAG) --set upstreams.notes.image.tag=$(NOTES_MCP_TAG) \
	  --set dashboard.image.tag=$(DASHBOARD_TAG)
	$(KUBECTL) -n $(NS) rollout status statefulset/gateway-postgres --timeout=180s
	$(KUBECTL) -n $(NS) rollout status deploy/gateway --timeout=180s
	$(KUBECTL) -n $(NS) rollout status deploy/fx-mcp --timeout=180s
	$(KUBECTL) -n $(NS) rollout status deploy/notes-mcp --timeout=180s
	$(KUBECTL) -n $(NS) rollout status deploy/dashboard --timeout=180s
	scripts/wait-setup.sh

# Registers fx and notes in the running gateway through its API. Run after make deploy.
register:
	scripts/register-upstreams.sh

# Prints failures only, then a one-line summary. eslint/tsc get added with the first TS service.
lint: deps
	@fail=0; \
	for c in $(CHARTS); do \
	  out=$$(helm lint charts/$$c -f charts/platform/values.yaml -f deploy/values-local.yaml --set image.tag=lint --set fx.image.tag=lint --set notes.image.tag=lint 2>&1) || { echo "$$out" | tail -20; fail=1; }; \
	done; \
	for v in local prod; do \
	  out=$$(helm template platform charts/platform -f deploy/values-$$v.yaml --set woo-mcp.image.tag=lint --set gateway.image.tag=lint --set upstreams.fx.image.tag=lint --set upstreams.notes.image.tag=lint --set dashboard.image.tag=lint 2>&1 >/dev/null) || { echo "$$out" | tail -20; fail=1; }; \
	done; \
	d=$$(sed -n 's/^  domain: *\([^ ]*\).*/\1/p' deploy/values-prod.yaml); \
	case "$$d" in '' | *' '*) echo "values-prod.yaml: global.domain empty or has spaces"; fail=1;; esac; \
	for s in $(TS_PROJECTS); do \
	  out=$$(npm --prefix $$s run lint 2>&1) || { echo "$$out" | tail -20; fail=1; }; \
	done; \
	if [ $$fail = 0 ]; then echo "lint: ok"; else echo "lint: FAILED"; exit 1; fi

# Dot reporter prints failures only. Add each TS service to TS_SERVICES.
test:
	@fail=0; \
	for s in $(TS_PROJECTS); do \
	  out=$$(npm --prefix $$s test 2>&1) || { echo "$$out" | tail -30; fail=1; }; \
	done; \
	if [ $$fail = 0 ]; then echo "test: ok"; else echo "test: FAILED"; exit 1; fi

dod:
	scripts/dod-check.sh

# Re-encrypts the stored upstream credentials under a new CREDENTIALS_KEY (ADR 023). The gateway is down ~30s.
rotate-key:
	scripts/rotate-credentials-key.sh
