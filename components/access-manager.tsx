"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronRight,
  CirclePlus,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "next-i18next/client";

import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
import type {
  AccessRuleCondition,
  AccessRuleOperator,
  AppPermission,
  ResourceRulePermission,
} from "@/lib/access-control-contract";
import { fetchJson } from "@/lib/client-types";

type PermissionDescriptor = {
  key: AppPermission;
  label: string;
  description: string;
};

type PermissionGroup = {
  key: string;
  label: string;
  description: string;
  permissions: PermissionDescriptor[];
};

type AccessRole = {
  key: string;
  name: string;
  description: string;
  permissions: AppPermission[];
  isSystem: boolean;
  memberCount: number;
  createdAt?: string;
  updatedAt?: string;
};

type InventoryAccessRule = {
  id: string;
  name: string;
  description: string;
  roleKey: string;
  permissions: ResourceRulePermission[];
  conditions: AccessRuleCondition[];
  enabled: boolean;
  priority: number;
  createdAt?: string;
  updatedAt?: string;
};

type AccessResponse = {
  roles: AccessRole[];
  rules: InventoryAccessRule[];
  permissionGroups: PermissionGroup[];
  resourceRulePermissions: ResourceRulePermission[];
};

type RoleDraft = {
  key: string;
  name: string;
  description: string;
  permissions: AppPermission[];
};

type RuleConditionValueType = "text" | "number" | "boolean";

type RuleConditionDraft = {
  field: string;
  operator: AccessRuleOperator;
  value: string;
  valueType: RuleConditionValueType;
};

type RuleDraft = {
  name: string;
  description: string;
  roleKey: string;
  permissions: ResourceRulePermission[];
  conditions: RuleConditionDraft[];
  enabled: boolean;
  priority: number;
};

const emptyRoleDraft: RoleDraft = {
  key: "",
  name: "",
  description: "",
  permissions: [],
};

const emptyCondition = (): RuleConditionDraft => ({
  field: "tags",
  operator: "contains",
  value: "",
  valueType: "text",
});

const emptyRuleDraft = (roleKey = ""): RuleDraft => ({
  name: "",
  description: "",
  roleKey,
  permissions: [],
  conditions: [emptyCondition()],
  enabled: true,
  priority: 100,
});

const ruleFields = [
  "id",
  "name",
  "type",
  "status",
  "sku",
  "location",
  "serialNumber",
  "priority",
  "tags",
  "categories",
  "createdBy",
] as const;

const ruleOperators: AccessRuleOperator[] = [
  "equals",
  "not_equals",
  "contains",
  "starts_with",
  "exists",
  "not_exists",
];

const inputClass =
  "mt-1.5 h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted focus:border-focus focus:ring-4 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted";

const textareaClass = `${inputClass} h-auto min-h-20 resize-y py-2.5 leading-5`;

function slug(value: string) {
  const normalized = value
    .trim()
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/[-_]{2,}/g, "-")
    .slice(0, 64);
  return normalized;
}

function translationSlug(value: string) {
  return value.replace(/[.-]/g, "_");
}

function isUnaryOperator(operator: AccessRuleOperator) {
  return operator === "exists" || operator === "not_exists";
}

function inferConditionValueType(
  field: string,
  value: AccessRuleCondition["value"],
): RuleConditionValueType {
  if (field === "priority" || typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "text";
}

function serializeConditionValue(condition: RuleConditionDraft) {
  const value = condition.value.trim();
  if (condition.field === "priority" || condition.valueType === "number") {
    return Number(value);
  }
  if (condition.valueType === "boolean") return value === "true";
  return value;
}

function toRuleDraft(rule: InventoryAccessRule): RuleDraft {
  return {
    name: rule.name,
    description: rule.description,
    roleKey: rule.roleKey,
    permissions: [...rule.permissions],
    conditions: rule.conditions.map((condition) => ({
      field: condition.field,
      operator: condition.operator,
      value:
        condition.value === undefined || condition.value === null
          ? ""
          : String(condition.value),
      valueType: inferConditionValueType(condition.field, condition.value),
    })),
    enabled: rule.enabled,
    priority: rule.priority,
  };
}

function rulePayload(draft: RuleDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    roleKey: draft.roleKey,
    permissions: draft.permissions,
    conditions: draft.conditions.map((condition) => ({
      field: condition.field.trim(),
      operator: condition.operator,
      ...(!isUnaryOperator(condition.operator)
        ? {
            value: serializeConditionValue(condition),
          }
        : {}),
    })),
    enabled: draft.enabled,
    priority: Number(draft.priority),
  };
}

export function AccessManager() {
  const { t } = useT("settings");
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [rules, setRules] = useState<InventoryAccessRule[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroup[]>([]);
  const [resourceRulePermissions, setResourceRulePermissions] = useState<
    ResourceRulePermission[]
  >([]);
  const [activeView, setActiveView] = useState<"roles" | "rules">("roles");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);
  const [roleDraft, setRoleDraft] = useState<RoleDraft>(emptyRoleDraft);
  const [editingRoleKey, setEditingRoleKey] = useState<string | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(emptyRuleDraft());
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const response = await fetchJson<AccessResponse>("/api/access/roles", {
        cache: "no-store",
      });
      setRoles(response.roles);
      setRules(response.rules);
      setPermissionGroups(response.permissionGroups);
      setResourceRulePermissions(response.resourceRulePermissions);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("access.errors.load"),
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const permissionLookup = useMemo(
    () =>
      new Map(
        permissionGroups.flatMap((group) =>
          group.permissions.map((permission) => [permission.key, permission] as const),
        ),
      ),
    [permissionGroups],
  );

  function clearMessages() {
    setError(null);
    setNotice(null);
  }

  function openCreateRole() {
    clearMessages();
    setEditingRoleKey(null);
    setCreatingRole(true);
    setRoleDraft(emptyRoleDraft);
  }

  function openEditRole(role: AccessRole) {
    clearMessages();
    setCreatingRole(false);
    setEditingRoleKey(role.key);
    setRoleDraft({
      key: role.key,
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
    });
  }

  function closeRoleEditor() {
    setCreatingRole(false);
    setEditingRoleKey(null);
    setRoleDraft(emptyRoleDraft);
  }

  async function createRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const key = roleDraft.key.trim();
    if (!key || !roleDraft.name.trim()) {
      setError(t("access.errors.roleRequired"));
      return;
    }
    setSaving("role:new");
    try {
      const response = await fetchJson<{ role: AccessRole }>("/api/access/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...roleDraft,
          key,
          name: roleDraft.name.trim(),
          description: roleDraft.description.trim(),
        }),
      });
      setRoles((current) =>
        [...current, response.role].sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      );
      closeRoleEditor();
      setNotice(t("access.notices.roleCreated", { name: response.role.name }));
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("access.errors.createRole"),
      );
    } finally {
      setSaving(null);
    }
  }

  async function saveRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRoleKey) return;
    clearMessages();
    setSaving(`role:${editingRoleKey}`);
    try {
      const response = await fetchJson<{ role: AccessRole }>(
        `/api/access/roles/${encodeURIComponent(editingRoleKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: roleDraft.name.trim(),
            description: roleDraft.description.trim(),
            permissions: roleDraft.permissions,
          }),
        },
      );
      setRoles((current) =>
        current.map((role) =>
          role.key === editingRoleKey
            ? { ...role, ...response.role, memberCount: role.memberCount }
            : role,
        ),
      );
      closeRoleEditor();
      setNotice(t("access.notices.roleUpdated", { name: response.role.name }));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t("access.errors.updateRole"),
      );
    } finally {
      setSaving(null);
    }
  }

  async function deleteRole(role: AccessRole) {
    if (
      role.isSystem ||
      role.memberCount > 0 ||
      !window.confirm(t("access.roles.deleteConfirm", { name: role.name }))
    ) {
      return;
    }
    clearMessages();
    setSaving(`role:${role.key}`);
    try {
      await fetchJson<never>(`/api/access/roles/${encodeURIComponent(role.key)}`, {
        method: "DELETE",
      });
      setRoles((current) => current.filter((item) => item.key !== role.key));
      setRules((current) => current.filter((rule) => rule.roleKey !== role.key));
      closeRoleEditor();
      setNotice(t("access.notices.roleDeleted", { name: role.name }));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("access.errors.deleteRole"),
      );
    } finally {
      setSaving(null);
    }
  }

  function openCreateRule() {
    clearMessages();
    setEditingRuleId(null);
    setCreatingRule(true);
    setRuleDraft(emptyRuleDraft(roles[0]?.key ?? ""));
  }

  function openEditRule(rule: InventoryAccessRule) {
    clearMessages();
    setCreatingRule(false);
    setEditingRuleId(rule.id);
    setRuleDraft(toRuleDraft(rule));
  }

  function closeRuleEditor() {
    setCreatingRule(false);
    setEditingRuleId(null);
    setRuleDraft(emptyRuleDraft(roles[0]?.key ?? ""));
  }

  function validateRuleDraft() {
    if (!ruleDraft.name.trim() || !ruleDraft.roleKey) {
      return t("access.errors.ruleRequired");
    }
    if (!ruleDraft.permissions.length) return t("access.errors.rulePermission");
    if (!ruleDraft.conditions.length) return t("access.errors.ruleCondition");
    if (
      ruleDraft.conditions.some(
        (condition) =>
          !condition.field.trim() ||
          (!isUnaryOperator(condition.operator) && !condition.value.trim()),
      )
    ) {
      return t("access.errors.conditionIncomplete");
    }
    if (
      ruleDraft.conditions.some(
        (condition) =>
          (condition.field === "priority" || condition.valueType === "number") &&
          !isUnaryOperator(condition.operator) &&
          !Number.isFinite(Number(condition.value)),
      )
    ) {
      return t("access.errors.priorityValue");
    }
    return null;
  }

  async function createRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearMessages();
    const validationError = validateRuleDraft();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving("rule:new");
    try {
      const response = await fetchJson<{ rule: InventoryAccessRule }>(
        "/api/access/rules",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rulePayload(ruleDraft)),
        },
      );
      setRules((current) =>
        [...current, response.rule].sort(
          (left, right) =>
            left.priority - right.priority || left.name.localeCompare(right.name),
        ),
      );
      closeRuleEditor();
      setNotice(t("access.notices.ruleCreated", { name: response.rule.name }));
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : t("access.errors.createRule"),
      );
    } finally {
      setSaving(null);
    }
  }

  async function saveRule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRuleId) return;
    clearMessages();
    const validationError = validateRuleDraft();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(`rule:${editingRuleId}`);
    try {
      const response = await fetchJson<{ rule: InventoryAccessRule }>(
        `/api/access/rules/${encodeURIComponent(editingRuleId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rulePayload(ruleDraft)),
        },
      );
      setRules((current) =>
        current
          .map((rule) => (rule.id === editingRuleId ? response.rule : rule))
          .sort(
            (left, right) =>
              left.priority - right.priority || left.name.localeCompare(right.name),
          ),
      );
      closeRuleEditor();
      setNotice(t("access.notices.ruleUpdated", { name: response.rule.name }));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : t("access.errors.updateRule"),
      );
    } finally {
      setSaving(null);
    }
  }

  async function toggleRule(rule: InventoryAccessRule) {
    clearMessages();
    setSaving(`rule:${rule.id}`);
    try {
      const response = await fetchJson<{ rule: InventoryAccessRule }>(
        `/api/access/rules/${encodeURIComponent(rule.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !rule.enabled }),
        },
      );
      setRules((current) =>
        current.map((item) => (item.id === rule.id ? response.rule : item)),
      );
      setNotice(
        t(
          response.rule.enabled
            ? "access.notices.ruleEnabled"
            : "access.notices.ruleDisabled",
          { name: response.rule.name },
        ),
      );
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : t("access.errors.updateRule"),
      );
    } finally {
      setSaving(null);
    }
  }

  async function deleteRule(rule: InventoryAccessRule) {
    if (!window.confirm(t("access.rules.deleteConfirm", { name: rule.name }))) return;
    clearMessages();
    setSaving(`rule:${rule.id}`);
    try {
      await fetchJson<never>(`/api/access/rules/${encodeURIComponent(rule.id)}`, {
        method: "DELETE",
      });
      setRules((current) => current.filter((item) => item.id !== rule.id));
      if (editingRuleId === rule.id) closeRuleEditor();
      setNotice(t("access.notices.ruleDeleted", { name: rule.name }));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("access.errors.deleteRule"),
      );
    } finally {
      setSaving(null);
    }
  }

  const activeRules = rules.filter((rule) => rule.enabled).length;
  const assignedMembers = roles.reduce((sum, role) => sum + role.memberCount, 0);

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-solid text-on-brand">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">{t("access.overview.title")}</h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
                {t("access.overview.description")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="grid size-10 place-items-center rounded-xl border border-border text-muted transition hover:bg-surface-subtle disabled:opacity-50"
            aria-label={t("access.refresh")}
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          </button>
        </div>

        {error ? (
          <div
            className="flex items-start gap-2 border-t border-danger-border bg-danger-soft px-5 py-3 text-sm text-danger sm:px-6"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? (
          <div
            className="flex items-start gap-2 border-t border-success-border bg-success-soft px-5 py-3 text-sm text-success sm:px-6"
            role="status"
          >
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        ) : null}

        <div className="grid border-t border-border bg-surface-subtle sm:grid-cols-3 sm:divide-x sm:divide-border">
          <SummaryItem
            icon={<BadgeCheck className="size-4" />}
            label={t("access.overview.roles")}
            value={loading ? null : roles.length}
          />
          <SummaryItem
            icon={<Users className="size-4" />}
            label={t("access.overview.members")}
            value={loading ? null : assignedMembers}
          />
          <SummaryItem
            icon={<ListChecks className="size-4" />}
            label={t("access.overview.activeRules")}
            value={loading ? null : activeRules}
          />
        </div>
      </Card>

      <div
        className="inline-flex rounded-xl border border-border bg-surface p-1 shadow-[var(--shadow-sm)]"
        role="tablist"
        aria-label={t("access.tabs.label")}
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "roles"}
          onClick={() => setActiveView("roles")}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[15px] font-semibold transition",
            activeView === "roles"
              ? "bg-brand-soft text-brand"
              : "text-muted-strong hover:bg-surface-muted hover:text-foreground",
          )}
        >
          <KeyRound className="size-4" aria-hidden="true" />
          {t("access.tabs.roles")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "rules"}
          onClick={() => setActiveView("rules")}
          className={cn(
            "inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[15px] font-semibold transition",
            activeView === "rules"
              ? "bg-brand-soft text-brand"
              : "text-muted-strong hover:bg-surface-muted hover:text-foreground",
          )}
        >
          <ListChecks className="size-4" aria-hidden="true" />
          {t("access.tabs.rules")}
          {!loading ? <span className="text-[13px] opacity-70">{rules.length}</span> : null}
        </button>
      </div>

      {activeView === "roles" ? (
        <Card className="overflow-hidden p-0">
          <SectionHeader
            icon={<KeyRound className="size-5" />}
            title={t("access.roles.title")}
            description={t("access.roles.description")}
            action={
              <Button type="button" onClick={creatingRole ? closeRoleEditor : openCreateRole}>
                {creatingRole ? <X className="size-4" /> : <Plus className="size-4" />}
                {creatingRole ? t("access.close") : t("access.roles.add")}
              </Button>
            }
          />

          {creatingRole ? (
            <RoleEditor
              draft={roleDraft}
              setDraft={setRoleDraft}
              permissionGroups={permissionGroups}
              saving={saving === "role:new"}
              mode="create"
              onCancel={closeRoleEditor}
              onSubmit={createRole}
            />
          ) : null}

          {loading && !roles.length ? (
            <LoadingRows />
          ) : roles.length ? (
            <div className="divide-y divide-border">
              {roles.map((role) =>
                editingRoleKey === role.key ? (
                  <RoleEditor
                    key={role.key}
                    draft={roleDraft}
                    setDraft={setRoleDraft}
                    permissionGroups={permissionGroups}
                    saving={saving === `role:${role.key}`}
                    mode="edit"
                    role={role}
                    onCancel={closeRoleEditor}
                    onDelete={() => void deleteRole(role)}
                    onSubmit={saveRole}
                  />
                ) : (
                  <RoleRow
                    key={role.key}
                    role={role}
                    onEdit={() => openEditRole(role)}
                  />
                ),
              )}
            </div>
          ) : (
            <EmptyState
              title={t("access.roles.emptyTitle")}
              description={t("access.roles.emptyDescription")}
              icon={<KeyRound className="size-5" />}
              action={
                <Button type="button" onClick={openCreateRole}>
                  <Plus className="size-4" />
                  {t("access.roles.add")}
                </Button>
              }
            />
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <SectionHeader
            icon={<ListChecks className="size-5" />}
            title={t("access.rules.title")}
            description={t("access.rules.description")}
            action={
              <Button
                type="button"
                onClick={creatingRule ? closeRuleEditor : openCreateRule}
                disabled={!roles.length}
              >
                {creatingRule ? <X className="size-4" /> : <Plus className="size-4" />}
                {creatingRule ? t("access.close") : t("access.rules.add")}
              </Button>
            }
          />

          {creatingRule ? (
            <RuleEditor
              draft={ruleDraft}
              setDraft={setRuleDraft}
              roles={roles}
              permissionLookup={permissionLookup}
              resourceRulePermissions={resourceRulePermissions}
              saving={saving === "rule:new"}
              mode="create"
              onCancel={closeRuleEditor}
              onSubmit={createRule}
            />
          ) : null}

          {loading && !rules.length ? (
            <LoadingRows />
          ) : rules.length ? (
            <div className="divide-y divide-border">
              {rules.map((rule) =>
                editingRuleId === rule.id ? (
                  <RuleEditor
                    key={rule.id}
                    draft={ruleDraft}
                    setDraft={setRuleDraft}
                    roles={roles}
                    permissionLookup={permissionLookup}
                    resourceRulePermissions={resourceRulePermissions}
                    saving={saving === `rule:${rule.id}`}
                    mode="edit"
                    onCancel={closeRuleEditor}
                    onDelete={() => void deleteRule(rule)}
                    onSubmit={saveRule}
                  />
                ) : (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    role={roles.find((role) => role.key === rule.roleKey)}
                    permissionLookup={permissionLookup}
                    saving={saving === `rule:${rule.id}`}
                    onEdit={() => openEditRule(rule)}
                    onToggle={() => void toggleRule(rule)}
                  />
                ),
              )}
            </div>
          ) : (
            <EmptyState
              title={t("access.rules.emptyTitle")}
              description={t("access.rules.emptyDescription")}
              icon={<ListChecks className="size-5" />}
              action={
                roles.length ? (
                  <Button type="button" onClick={openCreateRule}>
                    <Plus className="size-4" />
                    {t("access.rules.add")}
                  </Button>
                ) : undefined
              }
            />
          )}
        </Card>
      )}
    </div>
  );
}

function SummaryItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-b-0 sm:border-b-0 sm:px-6">
      <span className="grid size-8 place-items-center rounded-lg bg-surface text-muted shadow-sm">
        {icon}
      </span>
      <div>
        {value === null ? (
          <Skeleton className="h-5 w-8" />
        ) : (
          <p className="text-lg font-semibold tabular-nums text-foreground">{value}</p>
        )}
        <p className="text-[13px] font-medium text-muted">{label}</p>
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-4 px-5 py-5 sm:px-6">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-8 w-20" />
        </div>
      ))}
    </div>
  );
}

function RoleRow({ role, onEdit }: { role: AccessRole; onEdit: () => void }) {
  const { t } = useT("settings");
  return (
    <div className="flex flex-col gap-4 px-5 py-5 transition hover:bg-surface-subtle/70 sm:flex-row sm:items-center sm:px-6">
      <span
        className={cn(
          "grid size-10 shrink-0 place-items-center rounded-xl",
          role.isSystem
            ? "bg-brand-soft text-brand"
            : "bg-surface-muted text-muted-strong",
        )}
      >
        {role.isSystem ? (
          <LockKeyhole className="size-[18px]" aria-hidden="true" />
        ) : (
          <KeyRound className="size-[18px]" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">{role.name}</h3>
          <Badge tone={role.isSystem ? "brand" : "neutral"}>
            {role.isSystem ? t("access.roles.builtIn") : t("access.roles.custom")}
          </Badge>
        </div>
        <p className="mt-1 line-clamp-2 text-[15px] leading-5 text-muted">
          {role.description || t("access.roles.noDescription")}
        </p>
        <p className="mt-2 font-mono text-[12px] text-muted">{role.key}</p>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {role.permissions.length}
          </p>
          <p className="text-[12px] text-muted">{t("access.roles.permissions")}</p>
        </div>
        <div className="h-8 w-px bg-border" aria-hidden="true" />
        <div className="min-w-14 text-right">
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {role.memberCount}
          </p>
          <p className="text-[12px] text-muted">
            {t("access.roles.members", { count: role.memberCount })}
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="grid size-9 place-items-center rounded-lg border border-border text-muted-strong transition hover:border-border-strong hover:bg-surface hover:text-foreground"
          aria-label={t("access.roles.edit", { name: role.name })}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function RoleEditor({
  draft,
  setDraft,
  permissionGroups,
  saving,
  mode,
  role,
  onCancel,
  onDelete,
  onSubmit,
}: {
  draft: RoleDraft;
  setDraft: React.Dispatch<React.SetStateAction<RoleDraft>>;
  permissionGroups: PermissionGroup[];
  saving: boolean;
  mode: "create" | "edit";
  role?: AccessRole;
  onCancel: () => void;
  onDelete?: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useT("settings");
  const permissionsLocked = mode === "edit" && role?.key === "admin";

  function togglePermission(permission: AppPermission) {
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  const canDelete = Boolean(role && !role.isSystem && role.memberCount === 0);

  return (
    <form
      onSubmit={onSubmit}
      className="border-b border-brand-border bg-brand-soft/30 px-5 py-5 sm:px-6 sm:py-6"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand">
            {mode === "create" ? t("access.roles.newEyebrow") : t("access.roles.editEyebrow")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">
            {mode === "create" ? t("access.roles.newTitle") : role?.name}
          </h3>
          {mode === "edit" && role?.memberCount ? (
            <p className="mt-1 text-xs leading-5 text-warning">
              {t("access.roles.sessionWarning", { count: role.memberCount })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-foreground"
          aria-label={t("access.close")}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs font-semibold text-muted-strong">
          {t("access.roles.name")}
          <input
            required
            maxLength={120}
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                name: event.target.value,
                ...(mode === "create" && !current.key
                  ? { key: slug(event.target.value) }
                  : {}),
              }))
            }
            placeholder={t("access.roles.namePlaceholder")}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-muted-strong">
          {t("access.roles.key")}
          <input
            required
            disabled={mode === "edit"}
            maxLength={64}
            pattern="[a-z][a-z0-9_-]{0,63}"
            value={draft.key}
            onChange={(event) =>
              setDraft((current) => ({ ...current, key: slug(event.target.value) }))
            }
            placeholder={t("access.roles.keyPlaceholder")}
            className={`${inputClass} font-mono`}
          />
        </label>
        <label className="text-xs font-semibold text-muted-strong md:col-span-2">
          {t("access.roles.descriptionLabel")}
          <textarea
            maxLength={1000}
            rows={3}
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({ ...current, description: event.target.value }))
            }
            placeholder={t("access.roles.descriptionPlaceholder")}
            className={textareaClass}
          />
        </label>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {t("access.roles.permissionTitle")}
            </h4>
            <p className="mt-1 text-xs leading-5 text-muted">
              {t("access.roles.permissionDescription")}
            </p>
          </div>
          <p className="text-xs font-semibold tabular-nums text-brand">
            {t("access.roles.selectedPermissions", { count: draft.permissions.length })}
          </p>
        </div>
        <PermissionGrid
          groups={permissionGroups}
          selected={draft.permissions}
          disabled={permissionsLocked}
          onToggle={togglePermission}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-brand-border pt-5">
        {mode === "edit" && role ? (
          <div className="mr-auto">
            <Button
              type="button"
              variant="danger"
              onClick={onDelete}
              disabled={!canDelete || saving}
              title={
                role.isSystem
                  ? t("access.roles.systemDeleteHint")
                  : role.memberCount > 0
                    ? t("access.roles.memberDeleteHint")
                    : undefined
              }
            >
              <Trash2 className="size-4" />
              {t("access.roles.delete")}
            </Button>
          </div>
        ) : null}
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          {t("access.cancel")}
        </Button>
        <Button type="submit" disabled={saving || !draft.name.trim() || !draft.key.trim()}>
          {saving ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : mode === "create" ? (
            <Plus className="size-4" />
          ) : (
            <Save className="size-4" />
          )}
          {saving
            ? t("access.saving")
            : mode === "create"
              ? t("access.roles.create")
              : t("access.roles.save")}
        </Button>
      </div>
    </form>
  );
}

function PermissionGrid({
  groups,
  selected,
  disabled = false,
  onToggle,
}: {
  groups: PermissionGroup[];
  selected: AppPermission[];
  disabled?: boolean;
  onToggle: (permission: AppPermission) => void;
}) {
  const { t } = useT("settings");
  return (
    <div className="mt-4 grid gap-3 xl:grid-cols-3">
      {groups.map((group) => {
        const groupSelected = group.permissions.filter((permission) =>
          selected.includes(permission.key),
        ).length;
        return (
          <fieldset key={group.key} className="rounded-xl border border-border bg-surface p-4">
            <legend className="sr-only">
              {t(`access.permissionGroups.${translationSlug(group.key)}.label`, {
                defaultValue: group.label,
              })}
            </legend>
            <div className="mb-3 flex items-start justify-between gap-3 border-b border-border pb-3">
              <div>
                <p className="text-xs font-semibold text-foreground">
                  {t(`access.permissionGroups.${translationSlug(group.key)}.label`, {
                    defaultValue: group.label,
                  })}
                </p>
                <p className="mt-1 text-[12px] leading-4 text-muted">
                  {t(`access.permissionGroups.${translationSlug(group.key)}.description`, {
                    defaultValue: group.description,
                  })}
                </p>
              </div>
              <Badge tone={groupSelected ? "brand" : "neutral"}>
                {groupSelected}/{group.permissions.length}
              </Badge>
            </div>
            <div className="space-y-1.5">
              {group.permissions.map((permission) => {
                const checked = selected.includes(permission.key);
                const key = translationSlug(permission.key);
                return (
                  <label
                    key={permission.key}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-lg border px-2.5 py-2.5 transition",
                      disabled && "cursor-not-allowed opacity-65",
                      checked
                        ? "border-brand-border bg-brand-soft/60"
                        : "border-transparent hover:border-border hover:bg-surface-subtle",
                    )}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={checked}
                      onChange={() => onToggle(permission.key)}
                      className="mt-0.5 size-4 shrink-0 rounded border-border-strong text-brand"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-foreground">
                        {t(`access.permissions.${key}.label`, {
                          defaultValue: permission.label,
                        })}
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-4 text-muted">
                        {t(`access.permissions.${key}.description`, {
                          defaultValue: permission.description,
                        })}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

function RuleRow({
  rule,
  role,
  permissionLookup,
  saving,
  onEdit,
  onToggle,
}: {
  rule: InventoryAccessRule;
  role?: AccessRole;
  permissionLookup: Map<AppPermission, PermissionDescriptor>;
  saving: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const { t } = useT("settings");
  return (
    <div
      className={cn(
        "px-5 py-5 transition sm:px-6",
        rule.enabled ? "hover:bg-surface-subtle/70" : "bg-surface-subtle opacity-70",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-xl",
            rule.enabled ? "bg-brand-soft text-brand" : "bg-surface-muted text-muted",
          )}
        >
          <ListChecks className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{rule.name}</h3>
            <Badge tone={rule.enabled ? "success" : "neutral"}>
              {rule.enabled ? t("access.rules.enabled") : t("access.rules.disabled")}
            </Badge>
            <Badge tone="brand">{role?.name ?? rule.roleKey}</Badge>
            <span className="text-[12px] font-medium text-muted">
              {t("access.rules.priorityValue", { value: rule.priority })}
            </span>
          </div>
          {rule.description ? (
            <p className="mt-1.5 text-[15px] leading-5 text-muted">{rule.description}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-1.5">
            {rule.permissions.map((permission) => {
              const descriptor = permissionLookup.get(permission);
              return (
                <span
                  key={permission}
                  className="rounded-md bg-surface-muted px-2 py-1 text-[12px] font-semibold text-muted-strong"
                >
                  {t(`access.permissions.${translationSlug(permission)}.label`, {
                    defaultValue: descriptor?.label ?? permission,
                  })}
                </span>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <span className="font-semibold uppercase tracking-[0.1em]">
              {t("access.rules.when")}
            </span>
            {rule.conditions.map((condition, index) => (
              <span key={`${condition.field}-${index}`} className="contents">
                {index > 0 ? (
                  <span className="font-semibold text-brand">{t("access.rules.and")}</span>
                ) : null}
                <span className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-muted-strong">
                  {formatCondition(condition, t)}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            aria-label={
              rule.enabled
                ? t("access.rules.disable", { name: rule.name })
                : t("access.rules.enable", { name: rule.name })
            }
            disabled={saving}
            onClick={onToggle}
            className={cn(
              "relative h-7 w-12 rounded-full border transition disabled:opacity-50",
              rule.enabled
                ? "border-brand-solid bg-brand-solid"
                : "border-border-strong bg-surface-muted",
            )}
          >
            {saving ? (
              <LoaderCircle className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 animate-spin text-on-brand" />
            ) : (
              <span
                className={cn(
                  "absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition",
                  rule.enabled ? "left-[22px]" : "left-0.5",
                )}
              />
            )}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted-strong transition hover:border-border-strong hover:bg-surface hover:text-foreground"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {t("access.rules.edit")}
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleEditor({
  draft,
  setDraft,
  roles,
  permissionLookup,
  resourceRulePermissions,
  saving,
  mode,
  onCancel,
  onDelete,
  onSubmit,
}: {
  draft: RuleDraft;
  setDraft: React.Dispatch<React.SetStateAction<RuleDraft>>;
  roles: AccessRole[];
  permissionLookup: Map<AppPermission, PermissionDescriptor>;
  resourceRulePermissions: ResourceRulePermission[];
  saving: boolean;
  mode: "create" | "edit";
  onCancel: () => void;
  onDelete?: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useT("settings");

  function togglePermission(permission: ResourceRulePermission) {
    setDraft((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((item) => item !== permission)
        : [...current.permissions, permission],
    }));
  }

  function updateCondition(index: number, patch: Partial<RuleConditionDraft>) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, conditionIndex) =>
        conditionIndex === index ? { ...condition, ...patch } : condition,
      ),
    }));
  }

  function updateConditionField(index: number, field: string) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, conditionIndex) => {
        if (conditionIndex !== index) return condition;
        const wasPriority = condition.field === "priority";
        return {
          ...condition,
          field,
          valueType:
            field === "priority"
              ? "number"
              : wasPriority
                ? "text"
                : condition.valueType,
        };
      }),
    }));
  }

  function updateConditionValueType(
    index: number,
    valueType: RuleConditionValueType,
  ) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, conditionIndex) => {
        if (conditionIndex !== index) return condition;
        let value = condition.value;
        if (valueType === "boolean" && value !== "true" && value !== "false") {
          value = "true";
        } else if (valueType === "number" && !Number.isFinite(Number(value))) {
          value = "";
        }
        return { ...condition, valueType, value };
      }),
    }));
  }

  function removeCondition(index: number) {
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.filter((_, conditionIndex) => conditionIndex !== index),
    }));
  }

  return (
    <form
      onSubmit={onSubmit}
      className="border-b border-brand-border bg-brand-soft/30 px-5 py-5 sm:px-6 sm:py-6"
    >
      <datalist id="access-rule-fields">
        {ruleFields.map((field) => (
          <option key={field} value={field} />
        ))}
        <option value="customFields." />
      </datalist>

      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-brand">
            {mode === "create" ? t("access.rules.newEyebrow") : t("access.rules.editEyebrow")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-foreground">
            {mode === "create" ? t("access.rules.newTitle") : draft.name}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
            {t("access.rules.editorDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-foreground"
          aria-label={t("access.close")}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px]">
        <label className="text-xs font-semibold text-muted-strong">
          {t("access.rules.name")}
          <input
            required
            maxLength={160}
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            placeholder={t("access.rules.namePlaceholder")}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-muted-strong">
          {t("access.rules.role")}
          <select
            required
            value={draft.roleKey}
            onChange={(event) =>
              setDraft((current) => ({ ...current, roleKey: event.target.value }))
            }
            className={inputClass}
          >
            <option value="" disabled>
              {t("access.rules.chooseRole")}
            </option>
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-muted-strong">
          {t("access.rules.priority")}
          <input
            type="number"
            min={0}
            max={10000}
            required
            value={draft.priority}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                priority: Number(event.target.value),
              }))
            }
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-muted-strong md:col-span-2 xl:col-span-3">
          {t("access.rules.descriptionLabel")}
          <textarea
            maxLength={1000}
            rows={2}
            value={draft.description}
            onChange={(event) =>
              setDraft((current) => ({ ...current, description: event.target.value }))
            }
            placeholder={t("access.rules.descriptionPlaceholder")}
            className={textareaClass}
          />
        </label>
      </div>

      <div className="mt-6">
        <h4 className="text-sm font-semibold text-foreground">
          {t("access.rules.actionsTitle")}
        </h4>
        <p className="mt-1 text-xs leading-5 text-muted">
          {t("access.rules.actionsDescription")}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {resourceRulePermissions.map((permission) => {
            const descriptor = permissionLookup.get(permission);
            const checked = draft.permissions.includes(permission);
            return (
              <label
                key={permission}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-3 transition",
                  checked
                    ? "border-brand-border bg-brand-soft/70"
                    : "border-border bg-surface hover:border-border-strong",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePermission(permission)}
                  className="mt-0.5 size-4 shrink-0 rounded border-border-strong text-brand"
                />
                <span>
                  <span className="block text-xs font-semibold text-foreground">
                    {t(`access.permissions.${translationSlug(permission)}.label`, {
                      defaultValue: descriptor?.label ?? permission,
                    })}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-4 text-muted">
                    {t(`access.permissions.${translationSlug(permission)}.description`, {
                      defaultValue: descriptor?.description ?? permission,
                    })}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {t("access.rules.conditionsTitle")}
            </h4>
            <p className="mt-1 text-xs leading-5 text-muted">
              {t("access.rules.conditionsDescription")}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={draft.conditions.length >= 12}
            onClick={() =>
              setDraft((current) => ({
                ...current,
                conditions: [...current.conditions, emptyCondition()],
              }))
            }
          >
            <CirclePlus className="size-4" />
            {t("access.rules.addCondition")}
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          {draft.conditions.map((condition, index) => {
            const unary = isUnaryOperator(condition.operator);
            return (
              <div
                key={index}
                className="grid gap-2 rounded-xl border border-border bg-surface p-3 md:grid-cols-[34px_minmax(150px,1fr)_minmax(150px,0.8fr)_minmax(120px,0.6fr)_minmax(150px,1fr)_34px] md:items-end"
              >
                <span className="grid size-8 place-items-center self-center rounded-lg bg-brand-soft text-[12px] font-bold text-brand">
                  {index === 0 ? t("access.rules.if") : t("access.rules.and")}
                </span>
                <label className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                  {t("access.rules.field")}
                  <input
                    required
                    list="access-rule-fields"
                    pattern="(id|name|type|status|sku|location|serialNumber|priority|tags|categories|createdBy|customFields\.[A-Za-z0-9_-]{1,120})"
                    value={condition.field}
                    onChange={(event) => updateConditionField(index, event.target.value)}
                    placeholder={t("access.rules.fieldPlaceholder")}
                    className={`${inputClass} normal-case tracking-normal`}
                  />
                </label>
                <label className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                  {t("access.rules.operator")}
                  <select
                    value={condition.operator}
                    onChange={(event) =>
                      updateCondition(index, {
                        operator: event.target.value as AccessRuleOperator,
                      })
                    }
                    className={`${inputClass} normal-case tracking-normal`}
                  >
                    {ruleOperators.map((operator) => (
                      <option key={operator} value={operator}>
                        {t(`access.operators.${translationSlug(operator)}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {unary ? (
                  <div className="flex h-10 items-center rounded-xl border border-dashed border-border px-3 text-xs text-muted md:col-span-2 md:mt-1.5">
                    {t("access.rules.noValue")}
                  </div>
                ) : (
                  <>
                    <label className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {t("access.rules.valueType")}
                      <select
                        value={condition.valueType}
                        disabled={condition.field === "priority"}
                        onChange={(event) =>
                          updateConditionValueType(
                            index,
                            event.target.value as RuleConditionValueType,
                          )
                        }
                        className={`${inputClass} normal-case tracking-normal`}
                      >
                        <option value="text">{t("access.rules.valueTypes.text")}</option>
                        <option value="number">{t("access.rules.valueTypes.number")}</option>
                        <option value="boolean">{t("access.rules.valueTypes.boolean")}</option>
                      </select>
                    </label>
                    <label className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                      {t("access.rules.value")}
                      {condition.valueType === "boolean" ? (
                        <select
                          required
                          value={condition.value}
                          onChange={(event) =>
                            updateCondition(index, { value: event.target.value })
                          }
                          className={`${inputClass} normal-case tracking-normal`}
                        >
                          <option value="true">{t("access.rules.booleanValues.true")}</option>
                          <option value="false">{t("access.rules.booleanValues.false")}</option>
                        </select>
                      ) : (
                        <input
                          required
                          type={condition.valueType === "number" ? "number" : "text"}
                          step={condition.valueType === "number" ? "any" : undefined}
                          maxLength={condition.valueType === "text" ? 500 : undefined}
                          value={condition.value}
                          onChange={(event) =>
                            updateCondition(index, { value: event.target.value })
                          }
                          placeholder={t("access.rules.valuePlaceholder")}
                          className={`${inputClass} normal-case tracking-normal`}
                        />
                      )}
                    </label>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => removeCondition(index)}
                  disabled={draft.conditions.length === 1}
                  className="grid size-8 place-items-center self-center rounded-lg text-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-30"
                  aria-label={t("access.rules.removeCondition", { number: index + 1 })}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
          <CirclePlus className="size-3" aria-hidden="true" />
          {t("access.rules.customFieldHint")}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-brand-border pt-5">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-strong">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setDraft((current) => ({ ...current, enabled: event.target.checked }))
            }
            className="size-4 rounded border-border-strong text-brand"
          />
          {t("access.rules.enableOnSave")}
        </label>
        {mode === "edit" ? (
          <Button
            type="button"
            variant="danger"
            onClick={onDelete}
            disabled={saving}
            className="sm:ml-auto"
          >
            <Trash2 className="size-4" />
            {t("access.rules.delete")}
          </Button>
        ) : (
          <span className="sm:ml-auto" />
        )}
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          {t("access.cancel")}
        </Button>
        <Button
          type="submit"
          disabled={
            saving ||
            !draft.name.trim() ||
            !draft.roleKey ||
            !draft.permissions.length ||
            !draft.conditions.length
          }
        >
          {saving ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : mode === "create" ? (
            <Plus className="size-4" />
          ) : (
            <Save className="size-4" />
          )}
          {saving
            ? t("access.saving")
            : mode === "create"
              ? t("access.rules.create")
              : t("access.rules.save")}
        </Button>
      </div>
    </form>
  );
}

function formatCondition(
  condition: AccessRuleCondition,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const fieldKey = translationSlug(condition.field);
  const field = condition.field.startsWith("customFields.")
    ? condition.field
    : t(`access.fields.${fieldKey}`, { defaultValue: condition.field });
  const operator = t(`access.operators.${translationSlug(condition.operator)}`);
  if (isUnaryOperator(condition.operator)) return `${field} ${operator}`;
  return `${field} ${operator} “${String(condition.value ?? "")}”`;
}
