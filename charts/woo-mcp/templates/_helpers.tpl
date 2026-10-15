{{- define "woo-mcp.labels" -}}
app.kubernetes.io/part-of: urumi
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}
