export type OrderType = "purchase" | "sale" | "loan";
export type TradeOrderType = Exclude<OrderType, "purchase">;

export type ShipmentStatus =
  | "draft"
  | "ready"
  | "shipped"
  | "in_transit"
  | "delivered"
  | "exception"
  | "returned"
  | "cancelled";

export type Shipment = {
  id: string;
  orderId: string;
  carrierCode: string;
  service: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  shippedAt: string | null;
  deliveredAt: string | null;
  note: string;
  createdAt: string;
  lines: Array<{
    id: string;
    orderLineId: string;
    resourceId: string;
    resourceName: string;
    quantity: number;
    units: Array<{
      orderLineUnitId: string;
      stockUnitId: string;
      code: string;
    }>;
  }>;
  events: Array<{
    id: string;
    fromStatus: ShipmentStatus | null;
    toStatus: ShipmentStatus;
    note: string;
    actor: string | null;
    occurredAt: string;
  }>;
  totalQuantity: number;
};

export type Contact = {
  id: string;
  name: string;
  company: string | null;
  roles: Array<"customer" | "supplier">;
};

export type OrderLine = {
  id: string;
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  quantity: number;
  fulfilledQuantity: number;
  returnedQuantity: number;
  openQuantity: number;
  reservedQuantity: number;
  openReservationQuantity: number;
  openReturnQuantity: number;
  unitPriceCents: number | null;
  priceCurrency: string | null;
  totalPriceCents: number | null;
  expectedAt: string | null;
  note: string;
  trackingMode: "bulk" | "serialized";
  unitName: string;
  units: OrderLineUnit[];
};

export type OrderLineUnit = {
  id: string;
  stockUnitId: string;
  code: string;
  status: "reserved" | "fulfilled" | "returned";
  stockStatus:
  | "available"
  | "reserved"
  | "in-use"
  | "maintenance"
  | "consumed"
  | "lost"
  | "retired";
  reservedAt: string;
  fulfilledAt: string | null;
  returnedAt: string | null;
};

export type SerializedUnitPanel = {
  line: {
    id: string;
    resourceId: string;
    resourceName: string;
    quantity: number;
    fulfilledQuantity: number;
    returnedQuantity: number;
  };
  availableUnits: Array<{
    id: string;
    code: string;
    status: "available";
    location: string | null;
  }>;
  assignments: OrderLineUnit[];
};

export type Order = {
  id: string;
  type: OrderType;
  contactId: string | null;
  contactName: string;
  reference: string | null;
  status: string;
  orderedAt: string;
  expectedAt: string | null;
  note: string;
  lines: OrderLine[];
  shipments: Shipment[];
  totalQuantity: number;
  totalFulfilled: number;
  totalReturned: number;
};

export type DraftLine = {
  resourceId: string;
  resourceName: string;
  resourceSku: string | null;
  quantity: string;
  unitPrice: string;
  currency: string;
  note: string;
};

export type TradeOrderForm = {
  contactId: string;
  reference: string;
  orderedAt: string;
  expectedAt: string;
  note: string;
  lines: DraftLine[];
};

