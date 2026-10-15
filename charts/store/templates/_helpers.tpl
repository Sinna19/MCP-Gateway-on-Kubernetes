{{- define "store.labels" -}}
app.kubernetes.io/part-of: urumi
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Public URL of the shop, e.g. http://shop.localtest.me */}}
{{- define "store.url" -}}
{{- $scheme := ternary "https" "http" .Values.global.ingress.tls -}}
{{- printf "%s://%s.%s" $scheme .Values.wordpress.host .Values.global.domain -}}
{{- end }}

{{/* Env shared by the WordPress Deployment and the setup Job, so both see the same database and config. */}}
{{- define "store.wordpressEnv" -}}
- name: WORDPRESS_DB_HOST
  value: "store-mariadb:3306"
- name: WORDPRESS_DB_NAME
  value: {{ .Values.mariadb.database | quote }}
- name: WORDPRESS_DB_USER
  value: {{ .Values.mariadb.user | quote }}
- name: WORDPRESS_DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.mariadb.existingSecret }}
      key: password
{{- range $env, $key := dict "WORDPRESS_AUTH_KEY" "auth-key" "WORDPRESS_SECURE_AUTH_KEY" "secure-auth-key" "WORDPRESS_LOGGED_IN_KEY" "logged-in-key" "WORDPRESS_NONCE_KEY" "nonce-key" "WORDPRESS_AUTH_SALT" "auth-salt" "WORDPRESS_SECURE_AUTH_SALT" "secure-auth-salt" "WORDPRESS_LOGGED_IN_SALT" "logged-in-salt" "WORDPRESS_NONCE_SALT" "nonce-salt" }}
- name: {{ $env }}
  valueFrom:
    secretKeyRef:
      name: {{ $.Values.wordpress.existingSaltsSecret }}
      key: {{ $key }}
{{- end }}
# Site URL comes from values so local and prod hosts both work. WP_ENVIRONMENT_TYPE=local lets
# Application Passwords work over plain HTTP.
- name: WORDPRESS_CONFIG_EXTRA
  value: |
    define('WP_HOME', '{{ include "store.url" . }}');
    define('WP_SITEURL', '{{ include "store.url" . }}');
    define('WP_ENVIRONMENT_TYPE', '{{ .Values.wordpress.environmentType }}');
{{- end }}
