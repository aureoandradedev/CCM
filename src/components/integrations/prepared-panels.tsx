"use client";

import { useState } from "react";
import { Check, Copy, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CAPABILITY_LABELS, ERP_CONNECTORS } from "@/lib/integrations/connectors";
import { site, whatsappLink } from "@/lib/site";

/** ERP — lista de connectors, todos "Em breve" (nenhuma conexão real ainda). */
export function ErpPanel() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-ink-soft">
        Estamos construindo conectores oficiais com os ERPs abaixo. Assim que o seu estiver pronto, a conexão é feita em
        poucos cliques e o estoque/preço passa a sincronizar sozinho.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {ERP_CONNECTORS.map((erp) => (
          <div key={erp.id} className="rounded-xl border border-brand-line bg-card p-4">
            <div className="flex items-center justify-between">
              <h4 className="font-heading text-sm font-bold text-brand-navy dark:text-foreground">{erp.name}</h4>
              <Badge variant="secondary" className="bg-brand-line/60 text-brand-ink-soft">Em breve</Badge>
            </div>
            <p className="mt-1 text-xs text-brand-ink-soft">{erp.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {erp.capabilities.map((c) => (
                <span key={c} className="rounded-full bg-brand-bg px-2 py-0.5 text-[0.65rem] font-semibold text-brand-ink-soft">
                  {CAPABILITY_LABELS[c]}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-sm text-brand-ink-soft">
        Usa um ERP que não está na lista?{" "}
        <a href={whatsappLink("Quero integrar meu ERP ao CCM")} target="_blank" rel="noreferrer" className="font-semibold text-brand-green hover:underline">
          Fale com a gente
        </a>{" "}
        que priorizamos.
      </p>
    </div>
  );
}

const ENDPOINTS = [
  { method: "POST", path: "/v1/products", desc: "Criar/atualizar produtos (lote)" },
  { method: "PATCH", path: "/v1/products/:sku/stock", desc: "Atualizar estoque" },
  { method: "PATCH", path: "/v1/products/:sku/price", desc: "Atualizar preço" },
  { method: "GET", path: "/v1/catalog", desc: "Consultar seu catálogo no CCM" },
  { method: "POST", path: "/v1/images", desc: "Enviar imagens de produto" },
  { method: "GET", path: "/v1/orders", desc: "Receber pedidos (CCM → você)" },
];

/** API — documentação e preparação. NÃO gera segredo real nem o expõe. */
export function ApiPanel() {
  const [copied, setCopied] = useState(false);
  const base = `${site.url.replace(/\/$/, "")}/api/integracao`;
  const curl = `curl -X POST ${base}/v1/products \\
  -H "Authorization: Bearer SUA_CHAVE" \\
  -H "Content-Type: application/json" \\
  -d '{"products":[{"sku":"CIM-50","name":"Cimento 50kg","price":39.9,"stock":120}]}'`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(curl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponível */
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-ink-soft">
        Tem sistema próprio? Use a API REST do CCM para manter produtos, estoque, preço e receber pedidos. A chave de
        acesso é gerada quando sua conta de fornecedor é criada — <strong>nunca</strong> aparece aqui no navegador.
      </p>

      <div className="flex items-center gap-2 rounded-xl border border-brand-line bg-brand-bg px-4 py-3">
        <Lock className="size-4 shrink-0 text-brand-ink-soft" />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-brand-ink">Sua chave de API</p>
          <p className="truncate font-mono text-sm text-brand-ink-soft">ccm_live_••••••••••••••••••••</p>
        </div>
        <Badge variant="secondary" className="ml-auto bg-brand-line/60 text-brand-ink-soft">Gerada ao conectar</Badge>
      </div>

      <div>
        <h4 className="mb-2 font-heading text-sm font-bold text-brand-navy dark:text-foreground">Endpoints</h4>
        <div className="overflow-hidden rounded-xl border border-brand-line">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-brand-line">
              {ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <td className="px-3 py-2">
                    <span className="rounded bg-brand-navy/10 px-1.5 py-0.5 font-mono text-[0.7rem] font-bold text-brand-navy">{e.method}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-brand-ink">{e.path}</td>
                  <td className="px-3 py-2 text-xs text-brand-ink-soft">{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h4 className="font-heading text-sm font-bold text-brand-navy dark:text-foreground">Exemplo</h4>
          <Button type="button" variant="ghost" size="xs" onClick={copy} className="gap-1 text-brand-ink-soft">
            {copied ? <Check className="size-3.5 text-brand-green" /> : <Copy className="size-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>
        <pre className="overflow-x-auto rounded-xl bg-brand-navy p-4 text-xs leading-relaxed text-white/90">
          <code>{curl}</code>
        </pre>
      </div>
    </div>
  );
}

/** Feed/URL — arquitetura pronta para ler JSON/XML/CSV remoto (ainda "Em breve"). */
export function FeedPanel() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState("json");
  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-ink-soft">
        Publique um link com seu catálogo e o CCM lê periodicamente, mantendo produtos e estoque atualizados. Suporte a
        <strong> JSON</strong>, <strong>XML</strong> e <strong>CSV</strong> remoto está a caminho.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-ink">URL do feed</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://seusite.com.br/catalogo.xml"
            className="h-10 w-full rounded-lg border border-brand-line bg-card px-3 text-sm text-brand-ink placeholder:text-brand-ink-soft/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-brand-ink">Formato</span>
          <Select value={format} onValueChange={(v) => setFormat(v ?? "json")}>
            <SelectTrigger className="h-10 w-full sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="json">JSON</SelectItem>
              <SelectItem value="xml">XML</SelectItem>
              <SelectItem value="csv">CSV</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
      <div className="rounded-xl border border-brand-line bg-brand-yellow-soft/40 px-4 py-3 text-sm text-brand-ink">
        <Badge variant="secondary" className="mr-2 bg-brand-line/60 text-brand-ink-soft">Em breve</Badge>
        A leitura automática de feed entra em breve. Enquanto isso, você já pode importar o mesmo catálogo por
        <strong> Excel/CSV</strong>.
      </div>
    </div>
  );
}
