// @ts-expect-error vitest not installed yet — install with: npm i -D vitest
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_ITEM_COLUMNS,
  CUSTOMER_ORDER_COLUMNS,
  INTERNAL_ITEM_FIELDS,
  INTERNAL_ORDER_FIELDS,
} from "../orders";

describe("Customer payload security", () => {
  const orderCols = CUSTOMER_ORDER_COLUMNS.split(",").map((c) => c.trim());
  const itemCols = CUSTOMER_ITEM_COLUMNS.split(",").map((c) => c.trim());

  describe("CUSTOMER_ORDER_COLUMNS must NOT contain internal fields", () => {
    for (const field of INTERNAL_ORDER_FIELDS) {
      it(`must not include ${field}`, () => {
        expect(orderCols).not.toContain(field);
      });
    }

    it("must not contain supplier_ids", () => {
      expect(orderCols).not.toContain("supplier_ids");
    });

    it("must not contain result_lock_id", () => {
      expect(orderCols).not.toContain("result_lock_id");
    });

    it("must not contain result_locked_at", () => {
      expect(orderCols).not.toContain("result_locked_at");
    });
  });

  describe("CUSTOMER_ITEM_COLUMNS must NOT contain internal fields", () => {
    for (const field of INTERNAL_ITEM_FIELDS) {
      it(`must not include ${field}`, () => {
        expect(itemCols).not.toContain(field);
      });
    }

    it("must not contain supplier_cost_centavos", () => {
      expect(itemCols).not.toContain("supplier_cost_centavos");
    });

    it("must not contain supplier_id", () => {
      expect(itemCols).not.toContain("supplier_id");
    });

    it("must not contain supplier_offer_id", () => {
      expect(itemCols).not.toContain("supplier_offer_id");
    });

    it("must not contain master_product_id", () => {
      expect(itemCols).not.toContain("master_product_id");
    });

    it("must not contain confirmed_by", () => {
      expect(itemCols).not.toContain("confirmed_by");
    });
  });

  describe("CUSTOMER_ITEM_COLUMNS must include required public fields", () => {
    const requiredPublic = [
      "id",
      "name",
      "image",
      "unit",
      "qty",
      "unit_price_centavos",
      "line_centavos",
      "price_tier",
      "shipment_id",
      "qty_confirmed",
      "removal_reason",
    ];
    for (const field of requiredPublic) {
      it(`must include ${field}`, () => {
        expect(itemCols).toContain(field);
      });
    }
  });

  describe("CUSTOMER_ORDER_COLUMNS must include required public fields", () => {
    const requiredPublic = [
      "id",
      "code",
      "created_at",
      "order_status",
      "payment_status",
      "payment_method",
      "total_centavos",
      "subtotal_centavos",
      "discount_centavos",
      "freight_centavos",
      "items_count",
      "delivery_method",
      "customer",
      "address",
      "pricing_version",
      "paid_at",
      "notes",
    ];
    for (const field of requiredPublic) {
      it(`must include ${field}`, () => {
        expect(orderCols).toContain(field);
      });
    }
  });
});
