export interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string;
  price: number;
  category?: string;
  image_url?: string;
  created_at: string;
}

export interface Inventory {
  id: string;
  product_id: string;
  total_stock: number;
  available_stock: number;
  reserved_stock: number;
  version: number;
}

export type ReservationStatus = 'ACTIVE' | 'COMMITTED' | 'EXPIRED' | 'CANCELLED';

export interface Reservation {
  id: string;
  inventory_id: string;
  product_id: string;
  user_id: string;
  reservation_token: string;
  quantity: number;
  status: ReservationStatus;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';

export interface OrderItem {
  id?: string;
  order_id?: string;
  product_id: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
  reservation_token: string;
}

export interface Order {
  id: string;
  order_number: string;
  reservation_id: string;
  user_id: string;
  product_id: string;
  quantity: number;
  total_amount: number;
  status: OrderStatus;
  idempotency_key: string;
  items?: OrderItem[];
  created_at: string;
  updated_at: string;
}

export type PaymentStatus = 'INITIATED' | 'SUCCESS' | 'FAILED' | 'TIMED_OUT';

export interface PaymentTransaction {
  id: string;
  order_id: string;
  payment_reference: string;
  provider: string;
  amount: number;
  status: PaymentStatus;
  idempotency_key: string;
  raw_response?: Record<string, any>;
  created_at: string;
}

export interface IdempotencyRecord {
  key: string;
  scope: string;
  status: 'PENDING' | 'RESOLVED';
  response_code?: number;
  response_body?: any;
  created_at: string;
  expires_at: string;
}

export type AuditAction = 'RESERVE' | 'COMMIT' | 'RELEASE' | 'EXPIRE' | 'RECONCILE';

export interface InventoryAuditLog {
  id: number;
  product_id: string;
  action: AuditAction;
  delta: number;
  current_redis_stock: number;
  current_db_stock: number;
  reference_id?: string;
  timestamp: string;
}

export interface TelemetryMetrics {
  totalRequests: number;
  activeRequests: number;
  successfulReservations: number;
  soldOutRejections: number;
  duplicateRejections: number;
  paidOrders: number;
  failedPayments: number;
  expiredHolds: number;
  currentRedisStock: number;
  currentDbAvailableStock: number;
  currentDbReservedStock: number;
  rps: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  oversoldCount: number;
  isSimulating: boolean;
}

export interface MultiProductSimulationResult {
  scenario: string;
  totalCustomers: number;
  totalProductsCatalog: number;
  totalCatalogStock: number;
  successfulCartCheckouts: number;
  partialOrFailedCarts: number;
  duplicateShopperRejections: number;
  durationMs: number;
  rps: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  oversoldCount: number;
  invariantPassed: boolean;
  shardsCount: number;
  hotspotProductId: string;
  hotspotStockGranted: number;
  hotspotRejected: number;
  logSummary: string[];
}
