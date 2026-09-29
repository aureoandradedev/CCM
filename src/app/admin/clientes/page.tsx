import Link from "next/link";

import { Card, Chip, Empty, Kpi, NotConfigured, PageTitle, Table, Td, Th } from "@/components/admin/ui";
import { adminCustomers, configured } from "@/lib/admin/data";
import { formatDate, formatDateTime } from "@/lib/orders";
import { formatBRL } from "@/lib/utils/format";
import { maskDocument } from "@/lib/utils/masks";

export default async function AdminCustomers({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { aba = "clientes" } = await searchParams;
  if (!configured()) return <NotConfigured />;
  const { customers, leads, profiles } = await adminCustomers();
  const recorrentes = customers.filter((c) => c.pedidos > 1).length;

  return (
    <>
      <PageTitle title="Clientes e leads" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Clientes (com pedido)" value={String(customers.length)} />
        <Kpi label="Recorrentes" value={String(recorrentes)} hint="2+ pedidos" tone="green" />
        <Kpi label="Contas cadastradas" value={String(profiles.length)} />
        <Kpi label="Leads (newsletter/WhatsApp)" value={String(leads.length)} tone="slate" />
      </div>

      <div className="my-4 flex gap-2">
        <Chip href="/admin/clientes?aba=clientes" active={aba === "clientes"}>Clientes por compra</Chip>
        <Chip href="/admin/clientes?aba=contas" active={aba === "contas"}>Contas cadastradas</Chip>
        <Chip href="/admin/clientes?aba=leads" active={aba === "leads"}>Leads</Chip>
      </div>

      {aba === "clientes" ? (
        customers.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th>Contato</Th>
                <Th className="text-right">Pedidos</Th>
                <Th className="text-right">Total pago</Th>
                <Th>Último pedido</Th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const fone = c.phone.replace(/\D+/g, "");
                return (
                  <tr key={c.document} className="hover:bg-muted/50">
                    <Td>
                      <Link href={`/admin/pedidos?status=todos&q=${c.document}`} className="font-semibold text-brand-navy hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-brand-ink-soft">
                        {maskDocument(c.document)} {c.cadastrado ? <span className="ml-1 rounded bg-brand-green-soft px-1 font-bold text-brand-green">conta</span> : null}
                      </p>
                    </Td>
                    <Td className="text-xs">
                      {fone ? (
                        <a href={`https://wa.me/55${fone}`} target="_blank" rel="noreferrer" className="text-brand-green hover:underline">
                          {c.phone}
                        </a>
                      ) : null}
                      <p className="text-brand-ink-soft">{c.email}</p>
                    </Td>
                    <Td className="text-right tabular-nums">{c.pedidos}</Td>
                    <Td className="text-right font-bold text-brand-navy tabular-nums">{formatBRL(c.total / 100)}</Td>
                    <Td className="text-xs">{formatDateTime(c.ultimo)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <Empty>Nenhum cliente ainda.</Empty>
        )
      ) : null}

      {aba === "contas" ? (
        <Table>
          <thead>
            <tr>
              <Th>Nome</Th>
              <Th>E-mail</Th>
              <Th>Documento</Th>
              <Th>Telefone</Th>
              <Th>Perfil</Th>
              <Th>Cadastro</Th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="hover:bg-muted/50">
                <Td className="font-semibold">{p.full_name || "—"}</Td>
                <Td className="text-xs">{p.email}</Td>
                <Td className="text-xs">{p.document ? maskDocument(p.document) : "—"}</Td>
                <Td className="text-xs">{p.phone ?? "—"}</Td>
                <Td className="text-xs">{p.role === "admin" ? <b className="text-brand-navy">admin</b> : "cliente"}</Td>
                <Td className="text-xs">{formatDate(p.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      {aba === "leads" ? (
        leads.length ? (
          <Card className="[&>div]:p-0">
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Telefone</Th>
                  <Th>E-mail</Th>
                  <Th>Origem</Th>
                  <Th>Data</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <Td>{l.name ?? "—"}</Td>
                    <Td className="text-xs">{l.phone ?? "—"}</Td>
                    <Td className="text-xs">{l.email ?? "—"}</Td>
                    <Td className="text-xs">{l.source}</Td>
                    <Td className="text-xs">{formatDateTime(l.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : (
          <Empty>Nenhum lead ainda.</Empty>
        )
      ) : null}
    </>
  );
}
