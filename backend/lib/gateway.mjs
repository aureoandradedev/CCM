/**
 * Gateway de pagamento: Cielo real (lib/cielo.mjs, porte fiel do mercado) ou
 * MOCK para desenvolvimento (PAGAMENTO_MOCK=true): o Pix "paga" sozinho depois
 * de N segundos e o cartão aprova (token contendo "negar" reprova).
 */
import { randomUUID } from "node:crypto";

import * as cielo from "./cielo.mjs";
import { config } from "./config.mjs";

const mockPagamentos = new Map(); // paymentId -> { tipo, status, criadoEm, amount }

function ehMock() {
  return config.pagamentoMock;
}

export const gateway = {
  provider() {
    return ehMock() ? "mock" : "cielo";
  },

  async criarCobrancaPix({ merchantOrderId, amountCentavos, expiracaoSegundos, comprador }) {
    if (ehMock()) {
      const paymentId = `mock-pix-${randomUUID()}`;
      mockPagamentos.set(paymentId, { tipo: "pix", status: 12, criadoEm: Date.now(), amount: amountCentavos });
      return {
        paymentId,
        txid: paymentId.slice(-12),
        qrCodeString: `00020126MOCK${merchantOrderId}5204000053039865406${(amountCentavos / 100).toFixed(2)}5802BR5915MULTIGIRO MOCK6009CACHOEIRO62070503***6304ABCD`,
        qrCodeBase64: "",
        status: 12,
      };
    }
    return cielo.criarCobrancaPix({ merchantOrderId, amountCentavos, expiracaoSegundos, comprador });
  },

  async consultar(paymentId) {
    if (ehMock()) {
      const m = mockPagamentos.get(paymentId);
      if (!m) return { status: 0 };
      if (m.tipo === "pix" && m.status === 12 && Date.now() - m.criadoEm >= config.pagamentoMockPagoAposSeg * 1000) m.status = 2;
      return { status: m.status };
    }
    return cielo.consultarPix(paymentId);
  },

  async criarPagamentoCartao(args) {
    if (ehMock()) {
      const negar = String(args.paymentToken || "").toLowerCase().includes("negar");
      const paymentId = `mock-card-${randomUUID()}`;
      mockPagamentos.set(paymentId, { tipo: "cartao", status: negar ? 3 : 2, criadoEm: Date.now(), amount: args.amountCentavos });
      return { paymentId, status: negar ? 3 : 2, returnCode: negar ? "05" : "4", returnMessage: negar ? "Not Authorized" : "Operation Successful" };
    }
    return cielo.criarPagamentoCartao(args);
  },

  async devolver(paymentId, amountCentavos, opts = {}) {
    if (ehMock()) {
      const m = mockPagamentos.get(paymentId);
      if (m) m.status = 10;
      return { httpStatus: 200, status: 10, returnCode: "9", returnMessage: "Operation Successful", raw: {} };
    }
    return cielo.devolverPix(paymentId, amountCentavos, opts);
  },

  async gerarTokenSop() {
    if (ehMock()) return { accessToken: "mock-sop-token", environment: "mock" };
    return cielo.gerarTokenSop();
  },

  async gerarToken3ds() {
    if (ehMock()) return { accessToken: "mock-3ds-token", environment: "mock" };
    return cielo.gerarToken3ds();
  },

  traduzStatus: cielo.traduzStatusCielo,
};
