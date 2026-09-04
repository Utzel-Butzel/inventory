"use client";

import {
  Archive,
  Building2,
  Edit3,
  LoaderCircle,
  Mail,
  MessageSquareText,
  Package,
  Plus,
  Truck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useController, useForm, useWatch } from "react-hook-form";

import {
  Field,
  FormActions,
  Input,
  SearchInput,
  Select,
  Textarea,
} from "@/components/form-controls";
import { CommentsThread } from "@/components/resource-comments";
import { OrganizationLink as Link } from "@/components/organization-routing";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  IconButton,
  Skeleton,
  cn,
} from "@/components/ui";
import { fetchJson } from "@/lib/client-types";
import type { ContactRole } from "@/lib/contact-contract";

type LinkedResource = {
  id: string;
  name: string;
  sku: string | null;
  type: string;
};

type Contact = {
  id: string;
  name: string;
  company: string | null;
  roles: ContactRole[];
  email: string | null;
  phone: string | null;
  website: string | null;
  customerNumber: string | null;
  supplierNumber: string | null;
  taxId: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  tags: string[];
  notes: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  resources: LinkedResource[];
  movementCount: number;
  commentCount: number;
};

type ContactForm = {
  name: string;
  company: string;
  roles: ContactRole[];
  email: string;
  phone: string;
  website: string;
  customerNumber: string;
  supplierNumber: string;
  taxId: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  state: string;
  countryCode: string;
  tags: string;
  notes: string;
};

function emptyForm(): ContactForm {
  return {
    name: "",
    company: "",
    roles: ["customer"],
    email: "",
    phone: "",
    website: "",
    customerNumber: "",
    supplierNumber: "",
    taxId: "",
    addressLine1: "",
    addressLine2: "",
    postalCode: "",
    city: "",
    state: "",
    countryCode: "",
    tags: "",
    notes: "",
  };
}

function formFromContact(contact: Contact): ContactForm {
  return {
    name: contact.name,
    company: contact.company ?? "",
    roles: contact.roles,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    website: contact.website ?? "",
    customerNumber: contact.customerNumber ?? "",
    supplierNumber: contact.supplierNumber ?? "",
    taxId: contact.taxId ?? "",
    addressLine1: contact.addressLine1 ?? "",
    addressLine2: contact.addressLine2 ?? "",
    postalCode: contact.postalCode ?? "",
    city: contact.city ?? "",
    state: contact.state ?? "",
    countryCode: contact.countryCode ?? "",
    tags: contact.tags.join(", "),
    notes: contact.notes,
  };
}

function address(contact: Contact) {
  return [
    contact.addressLine1,
    contact.addressLine2,
    [contact.postalCode, contact.city].filter(Boolean).join(" "),
    contact.state,
    contact.countryCode,
  ]
    .filter(Boolean)
    .join(", ");
}

function isValidUrl(value: string) {
  if (!value.trim()) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export function ContactsManager({ canManage }: { canManage: boolean }) {
  const { t } = useT("contacts");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | ContactRole>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedResources, setSelectedResources] = useState<LinkedResource[]>([]);
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceResults, setResourceResults] = useState<LinkedResource[]>([]);
  const [searchingResources, setSearchingResources] = useState(false);
  const [commentsContactId, setCommentsContactId] = useState<string | null>(null);
  const {
    control,
    formState: { errors: formErrors },
    handleSubmit,
    register,
    reset,
  } = useForm<ContactForm>({
    defaultValues: emptyForm(),
    mode: "onBlur",
  });
  const {
    field: rolesField,
    fieldState: { error: rolesError },
  } = useController({
    control,
    name: "roles",
    rules: {
      validate: (value) =>
        value.length > 0 || t("validation.roleRequired"),
    },
  });
  const formName = useWatch({ control, name: "name" });
  const roles = rolesField.value;

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJson<{ contacts: Contact[] }>("/api/v1/contacts", {
        cache: "no-store",
      });
      setContacts(payload.contacts ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t("errors.load"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    if (!formOpen) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchingResources(true);
      const params = new URLSearchParams({ page: "1", pageSize: "50" });
      if (resourceQuery.trim()) params.set("q", resourceQuery.trim());
      void fetchJson<{ resources: LinkedResource[] }>(
        `/api/v1/resources?${params.toString()}`,
        { signal: controller.signal },
      )
        .then((payload) => setResourceResults(payload.resources ?? []))
        .catch((searchError: unknown) => {
          if (!(searchError instanceof DOMException && searchError.name === "AbortError")) {
            setResourceResults([]);
          }
        })
        .finally(() => setSearchingResources(false));
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [formOpen, resourceQuery]);

  const filteredContacts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return contacts.filter((contact) => {
      if (roleFilter !== "all" && !contact.roles.includes(roleFilter)) return false;
      if (!normalized) return true;
      return [
        contact.name,
        contact.company,
        contact.email,
        contact.phone,
        contact.customerNumber,
        contact.supplierNumber,
        ...contact.tags,
      ].some((value) => value?.toLocaleLowerCase().includes(normalized));
    });
  }, [contacts, query, roleFilter]);

  const stats = useMemo(
    () => ({
      all: contacts.length,
      customers: contacts.filter((contact) => contact.roles.includes("customer")).length,
      suppliers: contacts.filter((contact) => contact.roles.includes("supplier")).length,
    }),
    [contacts],
  );

  function openCreate() {
    setEditingId(null);
    reset(emptyForm());
    setSelectedResources([]);
    setResourceQuery("");
    setNotice(null);
    setFormOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditingId(contact.id);
    reset(formFromContact(contact));
    setSelectedResources(contact.resources);
    setResourceQuery("");
    setNotice(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditingId(null);
    setError(null);
  }

  function toggleRole(role: ContactRole) {
    const nextRoles = roles.includes(role)
      ? roles.filter((entry) => entry !== role)
      : [...roles, role];
    if (!nextRoles.length) return;
    rolesField.onChange(nextRoles);
    rolesField.onBlur();
  }

  async function saveContact(form: ContactForm) {
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = {
      name: form.name.trim(),
      company: form.company.trim() || null,
      roles: form.roles,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      website: form.website.trim() || null,
      customerNumber: form.customerNumber.trim() || null,
      supplierNumber: form.supplierNumber.trim() || null,
      taxId: form.taxId.trim() || null,
      addressLine1: form.addressLine1.trim() || null,
      addressLine2: form.addressLine2.trim() || null,
      postalCode: form.postalCode.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      countryCode: form.countryCode.trim() || null,
      tags: form.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      notes: form.notes,
      resourceIds: selectedResources.map((resource) => resource.id),
    };
    try {
      await fetchJson(editingId ? `/api/v1/contacts/${editingId}` : "/api/v1/contacts", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      setFormOpen(false);
      setEditingId(null);
      setNotice(t(editingId ? "notices.updated" : "notices.created"));
      await loadContacts();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("errors.save"));
    } finally {
      setSaving(false);
    }
  }

  async function archiveContact(contact: Contact) {
    if (!window.confirm(t("archive.confirm", { name: contact.name }))) return;
    setError(null);
    try {
      await fetchJson(`/api/v1/contacts/${contact.id}`, { method: "DELETE" });
      setNotice(t("notices.archived"));
      await loadContacts();
    } catch (archiveError) {
      setError(
        archiveError instanceof Error ? archiveError.message : t("errors.archive"),
      );
    }
  }

  const selectedIds = new Set(selectedResources.map((resource) => resource.id));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-brand">
            <UsersRound className="size-5" aria-hidden="true" />
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em]">
              {t("eyebrow")}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
            {t("title")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            {t("description")}
          </p>
        </div>
        {canManage ? (
          <Button onClick={openCreate} disabled={formOpen}>
            <Plus className="size-4" aria-hidden="true" />
            {t("actions.new")}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: t("stats.all"), value: stats.all, icon: UsersRound },
          { label: t("stats.customers"), value: stats.customers, icon: UserRound },
          { label: t("stats.suppliers"), value: stats.suppliers, icon: Truck },
        ].map((stat) => (
          <Card key={stat.label} className="flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand">
              <stat.icon className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-2xl font-semibold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted">{stat.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : null}
      {notice ? (
        <Alert tone="success">{notice}</Alert>
      ) : null}

      {formOpen ? (
        <Card className="overflow-hidden">
          <form onSubmit={handleSubmit(saveContact)} noValidate>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {t(editingId ? "form.editTitle" : "form.createTitle")}
                </h2>
                <p className="mt-0.5 text-xs text-muted">{t("form.description")}</p>
              </div>
              <IconButton onClick={closeForm} size="sm" aria-label={t("actions.close")}>
                <X className="size-4" aria-hidden="true" />
              </IconButton>
            </div>

            <div className="space-y-6 p-5">
              <section className="grid gap-4 md:grid-cols-2">
                <Field label={t("fields.name")} error={formErrors.name?.message} required>
                  <Input
                    {...register("name", {
                      required: t("validation.nameRequired"),
                      maxLength: {
                        value: 240,
                        message: t("validation.maxLength", { max: 240 }),
                      },
                    })}
                    autoFocus
                  />
                </Field>
                <Field label={t("fields.company")} error={formErrors.company?.message}>
                  <Input
                    {...register("company", {
                      maxLength: {
                        value: 240,
                        message: t("validation.maxLength", { max: 240 }),
                      },
                    })}
                  />
                </Field>
                <fieldset className="md:col-span-2">
                  <legend className="block text-[12px] font-semibold text-muted-strong">
                    {t("fields.roles")} <span className="text-danger" aria-hidden="true">*</span>
                  </legend>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {(["customer", "supplier"] as const).map((role) => (
                      <button key={role} type="button" onClick={() => toggleRole(role)} aria-pressed={roles.includes(role)} className={cn("inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition", roles.includes(role) ? "border-brand-border bg-brand-soft text-brand" : "border-border bg-surface text-muted-strong hover:border-border-strong")}>
                        {role === "customer" ? <UserRound className="size-4" /> : <Truck className="size-4" />}
                        {t(`roles.${role}`)}
                      </button>
                    ))}
                  </div>
                  {rolesError ? <p className="mt-1.5 text-[12px] leading-4 text-danger" role="alert">{rolesError.message}</p> : null}
                </fieldset>
                <Field label={t("fields.email")} error={formErrors.email?.message}>
                  <Input
                    type="email"
                    {...register("email", {
                      maxLength: {
                        value: 320,
                        message: t("validation.maxLength", { max: 320 }),
                      },
                      pattern: {
                        value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                        message: t("validation.email"),
                      },
                    })}
                  />
                </Field>
                <Field label={t("fields.phone")} error={formErrors.phone?.message}>
                  <Input {...register("phone", { maxLength: { value: 80, message: t("validation.maxLength", { max: 80 }) } })} />
                </Field>
                <Field label={t("fields.website")} error={formErrors.website?.message}>
                  <Input type="url" {...register("website", { maxLength: { value: 2048, message: t("validation.maxLength", { max: 2048 }) }, validate: (value) => isValidUrl(value) || t("validation.website") })} placeholder="https://" />
                </Field>
                <Field label={t("fields.taxId")} error={formErrors.taxId?.message}>
                  <Input {...register("taxId", { maxLength: { value: 80, message: t("validation.maxLength", { max: 80 }) } })} />
                </Field>
                {roles.includes("customer") ? (
                  <Field label={t("fields.customerNumber")} error={formErrors.customerNumber?.message}>
                    <Input {...register("customerNumber", { maxLength: { value: 80, message: t("validation.maxLength", { max: 80 }) } })} />
                  </Field>
                ) : null}
                {roles.includes("supplier") ? (
                  <Field label={t("fields.supplierNumber")} error={formErrors.supplierNumber?.message}>
                    <Input {...register("supplierNumber", { maxLength: { value: 80, message: t("validation.maxLength", { max: 80 }) } })} />
                  </Field>
                ) : null}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-foreground">{t("form.addressTitle")}</h3>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <Field label={t("fields.addressLine1")} error={formErrors.addressLine1?.message}><Input {...register("addressLine1", { maxLength: { value: 240, message: t("validation.maxLength", { max: 240 }) } })} /></Field>
                  <Field label={t("fields.addressLine2")} error={formErrors.addressLine2?.message}><Input {...register("addressLine2", { maxLength: { value: 240, message: t("validation.maxLength", { max: 240 }) } })} /></Field>
                  <Field label={t("fields.postalCode")} error={formErrors.postalCode?.message}><Input {...register("postalCode", { maxLength: { value: 32, message: t("validation.maxLength", { max: 32 }) } })} /></Field>
                  <Field label={t("fields.city")} error={formErrors.city?.message}><Input {...register("city", { maxLength: { value: 120, message: t("validation.maxLength", { max: 120 }) } })} /></Field>
                  <Field label={t("fields.state")} error={formErrors.state?.message}><Input {...register("state", { maxLength: { value: 120, message: t("validation.maxLength", { max: 120 }) } })} /></Field>
                  <Field label={t("fields.countryCode")} error={formErrors.countryCode?.message}><Input className="uppercase" maxLength={2} {...register("countryCode", { pattern: { value: /^[A-Za-z]{2}$/, message: t("validation.countryCode") }, setValueAs: (value: string) => value.toUpperCase().slice(0, 2) })} placeholder="DE" /></Field>
                </div>
              </section>

              <section>
                <div className="flex items-center gap-2">
                  <Package className="size-4 text-brand" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-foreground">{t("form.inventoryTitle")}</h3>
                </div>
                <p className="mt-1 text-xs text-muted">{t("form.inventoryDescription")}</p>
                {selectedResources.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedResources.map((resource) => (
                      <span key={resource.id} className="inline-flex items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs text-foreground">
                        {resource.name}
                        <button type="button" onClick={() => setSelectedResources((current) => current.filter((entry) => entry.id !== resource.id))} className="text-muted hover:text-danger" aria-label={t("actions.removeInventory", { name: resource.name })}>
                          <X className="size-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <SearchInput
                  containerClassName="mt-3"
                  loading={searchingResources}
                  value={resourceQuery}
                  onChange={(event) => setResourceQuery(event.target.value)}
                  placeholder={t("form.inventorySearch")}
                  aria-label={t("form.inventorySearch")}
                />
                <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-border">
                  {searchingResources ? (
                    <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted"><LoaderCircle className="size-4 animate-spin" />{t("form.searchingInventory")}</div>
                  ) : resourceResults.length ? (
                    resourceResults.map((resource) => {
                      const selected = selectedIds.has(resource.id);
                      return (
                        <button key={resource.id} type="button" disabled={selected} onClick={() => setSelectedResources((current) => [...current, resource])} className="flex w-full items-center justify-between border-b border-border px-3 py-2.5 text-left text-sm last:border-b-0 hover:bg-surface-subtle disabled:bg-surface-muted">
                          <span><span className="font-medium text-foreground">{resource.name}</span>{resource.sku ? <span className="ml-2 text-xs text-muted">{resource.sku}</span> : null}</span>
                          <span className="text-xs font-medium text-brand">{selected ? t("form.assigned") : t("form.assign")}</span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-3 py-4 text-xs text-muted">{t("form.noInventory")}</p>
                  )}
                </div>
              </section>

              <section className="grid gap-4 md:grid-cols-2">
                <Field label={t("fields.tags")} error={formErrors.tags?.message}><Input {...register("tags", { validate: { count: (value) => value.split(",").filter((tag) => tag.trim()).length <= 50 || t("validation.tooManyTags"), length: (value) => value.split(",").every((tag) => tag.trim().length <= 80) || t("validation.tagsTooLong") } })} placeholder={t("fields.tagsPlaceholder")} /></Field>
                <Field label={t("fields.notes")} error={formErrors.notes?.message} className="md:row-span-2"><Textarea {...register("notes", { maxLength: { value: 20000, message: t("validation.maxLength", { max: 20000 }) } })} /></Field>
              </section>
            </div>

            <FormActions>
              <Button type="button" variant="secondary" onClick={closeForm}>{t("actions.cancel")}</Button>
              <Button type="submit" disabled={saving || !formName.trim()}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t(editingId ? "actions.save" : "actions.create")}
              </Button>
            </FormActions>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <SearchInput
            containerClassName="flex-1"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            clearLabel={t("filters.clear")}
            placeholder={t("filters.search")}
            aria-label={t("filters.search")}
          />
          <Select className="sm:w-52" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | ContactRole)} aria-label={t("filters.role")}>
            <option value="all">{t("filters.all")}</option>
            <option value="customer">{t("roles.customer")}</option>
            <option value="supplier">{t("roles.supplier")}</option>
          </Select>
        </div>

        {loading ? (
          <div className="space-y-3 p-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
        ) : filteredContacts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead className="bg-surface-subtle text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">
                <tr><th className="px-4 py-3">{t("table.contact")}</th><th className="px-4 py-3">{t("table.roles")}</th><th className="px-4 py-3">{t("table.details")}</th><th className="px-4 py-3">{t("table.inventory")}</th><th className="px-4 py-3 text-right">{t("table.movements")}</th><th className="px-4 py-3 text-right">{t("table.actions")}</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredContacts.map((contact) => (
                  <Fragment key={contact.id}>
                    <tr className="align-top hover:bg-surface-subtle/70">
                      <td className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">{contact.company ? <Building2 className="size-4" /> : <UserRound className="size-4" />}</span>
                          <div><p className="font-semibold text-foreground">{contact.name}</p>{contact.company ? <p className="mt-0.5 text-xs text-muted">{contact.company}</p> : null}{contact.tags.length ? <p className="mt-1 text-[12px] text-muted">{contact.tags.join(" · ")}</p> : null}</div>
                        </div>
                      </td>
                      <td className="px-4 py-4"><div className="flex flex-wrap gap-1.5">{contact.roles.map((role) => <Badge key={role} tone={role === "supplier" ? "brand" : "neutral"}>{t(`roles.${role}`)}</Badge>)}</div></td>
                      <td className="px-4 py-4 text-xs text-muted-strong">
                        {contact.email ? <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 hover:text-brand"><Mail className="size-3.5" />{contact.email}</a> : null}
                        {contact.phone ? <a href={`tel:${contact.phone}`} className="mt-1 block hover:text-brand">{contact.phone}</a> : null}
                        {address(contact) ? <p className="mt-1 max-w-64 leading-5 text-muted">{address(contact)}</p> : null}
                      </td>
                      <td className="px-4 py-4">
                        {contact.resources.length ? <div className="flex max-w-sm flex-wrap gap-1.5">{contact.resources.slice(0, 4).map((resource) => <Link key={resource.id} href={`/inventory/${resource.id}`} className="rounded-lg bg-surface-muted px-2 py-1 text-xs text-foreground hover:text-brand">{resource.name}</Link>)}{contact.resources.length > 4 ? <Badge>+{contact.resources.length - 4}</Badge> : null}</div> : <span className="text-xs text-muted">{t("table.none")}</span>}
                      </td>
                      <td className="px-4 py-4 text-right"><span className="font-semibold text-foreground">{contact.movementCount}</span></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => { const closing = commentsContactId === contact.id; setCommentsContactId(closing ? null : contact.id); if (closing) void loadContacts(); }} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-muted hover:bg-surface-muted hover:text-foreground", commentsContactId === contact.id && "bg-brand-soft text-brand")} aria-expanded={commentsContactId === contact.id} aria-label={t("actions.commentsContact", { name: contact.name })}><MessageSquareText className="size-4" /><span className="text-xs font-semibold">{contact.commentCount}</span></button>
                          {canManage ? <><IconButton size="sm" onClick={() => openEdit(contact)} aria-label={t("actions.editContact", { name: contact.name })}><Edit3 className="size-4" /></IconButton><IconButton size="sm" variant="danger-ghost" onClick={() => void archiveContact(contact)} aria-label={t("actions.archiveContact", { name: contact.name })}><Archive className="size-4" /></IconButton></> : null}
                        </div>
                      </td>
                    </tr>
                    {commentsContactId === contact.id ? (
                      <tr>
                        <td colSpan={6} className="bg-surface-subtle p-4 sm:p-5">
                          <CommentsThread endpoint={`/api/v1/contacts/${contact.id}/comments`} canComment={canManage} embedded />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<UsersRound className="size-5" />} title={query || roleFilter !== "all" ? t("empty.filteredTitle") : t("empty.title")} description={query || roleFilter !== "all" ? t("empty.filteredDescription") : t("empty.description")} action={canManage && !query && roleFilter === "all" ? <Button onClick={openCreate}><Plus className="size-4" />{t("actions.new")}</Button> : undefined} />
        )}
      </Card>
    </div>
  );
}
