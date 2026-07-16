{{/*
Expand the name of the chart.
*/}}
{{- define "1xsecret.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to
this (by the DNS naming spec). If the release name contains the chart name
it will be used as a full name.
*/}}
{{- define "1xsecret.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "1xsecret.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "1xsecret.labels" -}}
helm.sh/chart: {{ include "1xsecret.chart" . }}
{{ include "1xsecret.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels.
*/}}
{{- define "1xsecret.selectorLabels" -}}
app.kubernetes.io/name: {{ include "1xsecret.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
The name of the ServiceAccount to use.
*/}}
{{- define "1xsecret.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "1xsecret.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
The resolved container image reference.
*/}}
{{- define "1xsecret.image" -}}
{{- printf "%s:%s" .Values.image.repository (default .Chart.AppVersion .Values.image.tag) }}
{{- end }}

{{/*
Migration Job / hook resource name. Budgets for the "-migrate" suffix so the
name stays within the 63-char DNS label limit even for long release names
(a fullname truncated at 63 + "-migrate" would otherwise overflow and the
pre-install/pre-upgrade hook Job would fail to create).
*/}}
{{- define "1xsecret.migrateName" -}}
{{- printf "%s-migrate" (include "1xsecret.fullname" . | trunc 55 | trimSuffix "-") }}
{{- end }}

{{/*
Name of the Secret holding the database connection string: the
user-provided existing Secret (recommended; e.g. CloudNativePG's
`<cluster>-app`) or the chart-rendered dev Secret `<fullname>-db`.
Used identically by the Deployment and the migration Job.
*/}}
{{- define "1xsecret.databaseSecretName" -}}
{{- if .Values.database.existingSecret.name }}
{{- .Values.database.existingSecret.name }}
{{- else }}
{{- printf "%s-db" (include "1xsecret.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Key inside the database Secret that holds the connection string
(`uri` for CloudNativePG-generated Secrets, `DATABASE_URL` for the
chart-rendered dev Secret).
*/}}
{{- define "1xsecret.databaseSecretKey" -}}
{{- if .Values.database.existingSecret.name }}
{{- .Values.database.existingSecret.key | default "DATABASE_URL" }}
{{- else }}
{{- "DATABASE_URL" }}
{{- end }}
{{- end }}

{{/*
DATABASE_URL env entry shared by the Deployment and the migration Job.
*/}}
{{- define "1xsecret.databaseUrlEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "1xsecret.databaseSecretName" . }}
      key: {{ include "1xsecret.databaseSecretKey" . }}
{{- end }}

{{/*
Name of the ConfigMap holding the legal markdown documents.
*/}}
{{- define "1xsecret.legalConfigMapName" -}}
{{- if .Values.legal.existingConfigMap }}
{{- .Values.legal.existingConfigMap }}
{{- else }}
{{- printf "%s-legal" (include "1xsecret.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Name of the ConfigMap holding the partial message overrides.
*/}}
{{- define "1xsecret.messagesConfigMapName" -}}
{{- if .Values.branding.messagesExistingConfigMap }}
{{- .Values.branding.messagesExistingConfigMap }}
{{- else }}
{{- printf "%s-messages" (include "1xsecret.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Whether any message-override ConfigMap should be mounted.
*/}}
{{- define "1xsecret.hasMessageOverrides" -}}
{{- if or .Values.branding.messageOverrides .Values.branding.messagesExistingConfigMap }}true{{- end }}
{{- end }}

{{/*
Whether the PodDisruptionBudget should be rendered. `enabled: auto`
creates it whenever more than one replica is configured.
*/}}
{{- define "1xsecret.pdbEnabled" -}}
{{- $enabled := .Values.podDisruptionBudget.enabled }}
{{- if kindIs "bool" $enabled }}
{{- ternary "true" "" $enabled }}
{{- else if eq ($enabled | toString) "auto" }}
{{- $replicas := ternary .Values.autoscaling.minReplicas .Values.replicaCount .Values.autoscaling.enabled }}
{{- ternary "true" "" (gt (int $replicas) 1) }}
{{- end }}
{{- end }}
