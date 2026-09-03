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
  Search,
  Truck,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useT } from "next-i18next/client";
import {
  Fragment,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { CommentsThread } from "@/components/resource-comments";
import { OrganizationLink as Link } from "@/components/organization-routing";
import { Badge, Button, Card, EmptyState, Skeleton, cn } from "@/components/ui";
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

const inputClass =
  "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-foreground outline-none transition placeholder:text-muted hover:border-border-strong focus:border-focus focus:ring-3 focus:ring-focus/10 disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-muted";
const labelClass = "block text-[12px] font-semibold text-muted-strong";

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
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [selectedResources, setSelectedResources] = useState<LinkedResource[]>([]);
  const [resourceQuery, setResourceQuery] = useState("");
  const [resourceResults, setResourceResults] = useState<LinkedResource[]>([]);
  const [searchingResources, setSearchingResources] = useState(false);
  const [commentsContactId, setCommentsContactId] = useState<string | null>(null);

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
    setForm(emptyForm());
    setSelectedResources([]);
    setResourceQuery("");
    setNotice(null);
    setFormOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditingId(contact.id);
    setForm(formFromContact(contact));
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

  function updateField<K extends keyof ContactForm>(key: K, value: ContactForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleRole(role: ContactRole) {
    setForm((current) => {
      const roles = current.roles.includes(role)
        ? current.roles.filter((entry) => entry !== role)
        : [...current.roles, role];
      return roles.length ? { ...current, roles } : current;
    });
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim() || !form.roles.length) return;
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
        <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-xl border border-success-border bg-success-soft px-4 py-3 text-sm text-success">
          {notice}
        </div>
      ) : null}

      {formOpen ? (
        <Card className="overflow-hidden">
          <form onSubmit={saveContact}>
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">
                  {t(editingId ? "form.editTitle" : "form.createTitle")}
                </h2>
                <p className="mt-0.5 text-xs text-muted">{t("form.description")}</p>
              </div>
              <button type="button" onClick={closeForm} className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground" aria-label={t("actions.close")}>
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-6 p-5">
              <section className="grid gap-4 md:grid-cols-2">
                <label className={labelClass}>
                  {t("fields.name")} *
                  <input className={cn(inputClass, "mt-1.5")} value={form.name} onChange={(event) => updateField("name", event.target.value)} required autoFocus />
                </label>
                <label className={labelClass}>
                  {t("fields.company")}
                  <input className={cn(inputClass, "mt-1.5")} value={form.company} onChange={(event) => updateField("company", event.target.value)} />
                </label>
                <div className="md:col-span-2">
                  <span className={labelClass}>{t("fields.roles")} *</span>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {(["customer", "supplier"] as const).map((role) => (
                      <button key={role} type="button" onClick={() => toggleRole(role)} aria-pressed={form.roles.includes(role)} className={cn("inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition", form.roles.includes(role) ? "border-brand-border bg-brand-soft text-brand" : "border-border bg-surface text-muted-strong hover:border-border-strong")}>
                        {role === "customer" ? <UserRound className="size-4" /> : <Truck className="size-4" />}
                        {t(`roles.${role}`)}
                      </button>
                    ))}
                  </div>
                </div>
                <label className={labelClass}>
                  {t("fields.email")}
                  <input type="email" className={cn(inputClass, "mt-1.5")} value={form.email} onChange={(event) => updateField("email", event.target.value)} />
                </label>
                <label className={labelClass}>
                  {t("fields.phone")}
                  <input className={cn(inputClass, "mt-1.5")} value={form.phone} onChange={(event) => updateField("phone", event.target.value)} />
                </label>
                <label className={labelClass}>
                  {t("fields.website")}
                  <input type="url" className={cn(inputClass, "mt-1.5")} value={form.website} onChange={(event) => updateField("website", event.target.value)} placeholder="https://" />
                </label>
                <label className={labelClass}>
                  {t("fields.taxId")}
                  <input className={cn(inputClass, "mt-1.5")} value={form.taxId} onChange={(event) => updateField("taxId", event.target.value)} />
                </label>
                {form.roles.includes("customer") ? (
                  <label className={labelClass}>
                    {t("fields.customerNumber")}
                    <input className={cn(inputClass, "mt-1.5")} value={form.customerNumber} onChange={(event) => updateField("customerNumber", event.target.value)} />
                  </label>
                ) : null}
                {form.roles.includes("supplier") ? (
                  <label className={labelClass}>
                    {t("fields.supplierNumber")}
                    <input className={cn(inputClass, "mt-1.5")} value={form.supplierNumber} onChange={(event) => updateField("supplierNumber", event.target.value)} />
                  </label>
                ) : null}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-foreground">{t("form.addressTitle")}</h3>
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <label className={labelClass}>{t("fields.addressLine1")}<input className={cn(inputClass, "mt-1.5")} value={form.addressLine1} onChange={(event) => updateField("addressLine1", event.target.value)} /></label>
                  <label className={labelClass}>{t("fields.addressLine2")}<input className={cn(inputClass, "mt-1.5")} value={form.addressLine2} onChange={(event) => updateField("addressLine2", event.target.value)} /></label>
                  <label className={labelClass}>{t("fields.postalCode")}<input className={cn(inputClass, "mt-1.5")} value={form.postalCode} onChange={(event) => updateField("postalCode", event.target.value)} /></label>
                  <label className={labelClass}>{t("fields.city")}<input className={cn(inputClass, "mt-1.5")} value={form.city} onChange={(event) => updateField("city", event.target.value)} /></label>
                  <label className={labelClass}>{t("fields.state")}<input className={cn(inputClass, "mt-1.5")} value={form.state} onChange={(event) => updateField("state", event.target.value)} /></label>
                  <label className={labelClass}>{t("fields.countryCode")}<input className={cn(inputClass, "mt-1.5 uppercase")} value={form.countryCode} onChange={(event) => updateField("countryCode", event.target.value.toUpperCase().slice(0, 2))} placeholder="DE" /></label>
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
                <div className="relative mt-3">
                  <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden="true" />
                  <input className={cn(inputClass, "pl-9")} value={resourceQuery} onChange={(event) => setResourceQuery(event.target.value)} placeholder={t("form.inventorySearch")} />
                </div>
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
                <label className={labelClass}>{t("fields.tags")}<input className={cn(inputClass, "mt-1.5")} value={form.tags} onChange={(event) => updateField("tags", event.target.value)} placeholder={t("fields.tagsPlaceholder")} /></label>
                <label className={cn(labelClass, "md:row-span-2")}>{t("fields.notes")}<textarea className={cn(inputClass, "mt-1.5 h-24 resize-y py-2.5")} value={form.notes} onChange={(event) => updateField("notes", event.target.value)} /></label>
              </section>
            </div>

            <div className="flex justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-4">
              <Button type="button" variant="secondary" onClick={closeForm}>{t("actions.cancel")}</Button>
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {t(editingId ? "actions.save" : "actions.create")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted" aria-hidden="true" />
            <input className={cn(inputClass, "pl-9")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("filters.search")} aria-label={t("filters.search")} />
          </div>
          <select className={cn(inputClass, "sm:w-52")} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | ContactRole)} aria-label={t("filters.role")}>
            <option value="all">{t("filters.all")}</option>
            <option value="customer">{t("roles.customer")}</option>
            <option value="supplier">{t("roles.supplier")}</option>
          </select>
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
                          {canManage ? <><button type="button" onClick={() => openEdit(contact)} className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground" aria-label={t("actions.editContact", { name: contact.name })}><Edit3 className="size-4" /></button><button type="button" onClick={() => void archiveContact(contact)} className="rounded-lg p-2 text-muted hover:bg-danger-soft hover:text-danger" aria-label={t("actions.archiveContact", { name: contact.name })}><Archive className="size-4" /></button></> : null}
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
