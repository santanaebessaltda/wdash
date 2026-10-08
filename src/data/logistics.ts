import { statusVariant, type StatusVariant } from "@/lib/status";

/** Extends the generic status -> color mapping with logistics-specific vocabulary
 * ("in transit", "delayed", "optimized") that isn't covered by the shared list. */
export function logisticsStatusVariant(status: string): StatusVariant {
  const s = status.trim().toLowerCase();
  if (s === "in transit") return "accent";
  if (s === "delayed") return "danger";
  if (s === "optimized") return "success";
  if (s === "en route") return "accent";
  if (s === "idle") return "neutral";
  return statusVariant(status);
}

export const logKpis = [
  { label: "Active Shipments", value: "412", sub: "Across 4 regions", tint: "var(--acc)", tintBg: "var(--acc-soft)", delta: "+7%", positive: true },
  { label: "Delivered Today", value: "186", sub: "vs 172 yesterday", tint: "var(--ok)", tintBg: "var(--ok-soft)", delta: "+8%", positive: true },
  { label: "On-time Rate", value: "91%", sub: "Target 95%", tint: "var(--warn)", tintBg: "var(--warn-soft)", delta: "-2%", positive: false },
  { label: "Fleet Utilization", value: "88%", sub: "42 of 48 active", tint: "var(--info)", tintBg: "var(--info-soft)", delta: "+3%", positive: true },
];

export interface Warehouse {
  name: string;
  color: string;
  pct: number;
  units: string;
  orders: number;
}

export const logWarehouses: Warehouse[] = [
  { name: "West Coast Hub", color: "var(--acc)", pct: 82, units: "18,420", orders: 214 },
  { name: "Central Depot", color: "var(--info)", pct: 61, units: "11,860", orders: 132 },
  { name: "East Coast Hub", color: "var(--ok)", pct: 74, units: "15,300", orders: 168 },
];

export const logStatus = [
  { name: "In Transit", color: "var(--acc)", count: 412, pct: 34 },
  { name: "Delivered", color: "var(--ok)", count: 2760, pct: 55 },
  { name: "Processing", color: "var(--warn)", count: 80, pct: 8 },
  { name: "Delayed", color: "var(--bad)", count: 32, pct: 3 },
];

export const logFleet = [
  { name: "Trucks", value: "28", sub: "24 active · 4 maintenance", tint: "var(--acc)", tintBg: "var(--acc-soft)" },
  { name: "Vans", value: "20", sub: "18 active · 2 maintenance", tint: "var(--info)", tintBg: "var(--info-soft)" },
  { name: "Drivers", value: "46", sub: "42 on shift today", tint: "var(--ok)", tintBg: "var(--ok-soft)" },
];

export const logChartMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const logChartValues = [2180, 2340, 2260, 2510, 2690, 2820, 3020, 2940, 3110, 3240, 3180, 3284];

export const logRegions = [
  { name: "West", shipments: "1,240", color: "var(--acc)", onTime: 93, otColor: "var(--ok)" },
  { name: "Central", shipments: "860", color: "var(--info)", onTime: 88, otColor: "var(--warn)" },
  { name: "East", shipments: "980", color: "var(--ok)", onTime: 94, otColor: "var(--ok)" },
  { name: "South", shipments: "204", color: "var(--warn)", onTime: 82, otColor: "var(--bad)" },
];

export const logShipmentsMini = [
  { id: "SHP-88420", dest: "New York, NY", carrier: "FedEx Express", eta: "Jul 6, 10:30 AM", status: "In Transit" },
  { id: "SHP-88317", dest: "Chicago, IL", carrier: "UPS Ground", eta: "Jul 6, 2:00 PM", status: "In Transit" },
  { id: "SHP-88291", dest: "Miami, FL", carrier: "DHL Express", eta: "Jul 5, 6:00 PM", status: "Delayed" },
  { id: "SHP-88204", dest: "Seattle, WA", carrier: "USPS Priority", eta: "Jul 7, 9:00 AM", status: "Processing" },
  { id: "SHP-88155", dest: "Austin, TX", carrier: "FedEx Ground", eta: "Jul 5, 4:15 PM", status: "Delivered" },
];

export interface Shipment {
  tracking: string;
  from: string;
  to: string;
  customer: string;
  carrier: string;
  status: string;
  eta: string;
  etaWarn: boolean;
}

export const shipments: Shipment[] = [
  { tracking: "SHP-88420", from: "San Francisco, CA", to: "New York, NY", customer: "Elena Park", carrier: "FedEx Express", status: "In Transit", eta: "Jul 6, 10:30 AM", etaWarn: false },
  { tracking: "SHP-88317", from: "Los Angeles, CA", to: "Chicago, IL", customer: "Robert Kim", carrier: "UPS Ground", status: "In Transit", eta: "Jul 6, 2:00 PM", etaWarn: false },
  { tracking: "SHP-88291", from: "Dallas, TX", to: "Miami, FL", customer: "Aisha Malik", carrier: "DHL Express", status: "Delayed", eta: "Jul 5, 6:00 PM", etaWarn: true },
  { tracking: "SHP-88204", from: "Portland, OR", to: "Seattle, WA", customer: "Tom Baxter", carrier: "USPS Priority", status: "Processing", eta: "Jul 7, 9:00 AM", etaWarn: false },
  { tracking: "SHP-88155", from: "Denver, CO", to: "Austin, TX", customer: "Nina Volkov", carrier: "FedEx Ground", status: "Delivered", eta: "Jul 5, 4:15 PM", etaWarn: false },
  { tracking: "SHP-88098", from: "Phoenix, AZ", to: "Las Vegas, NV", customer: "Marco Diaz", carrier: "UPS Express", status: "Delivered", eta: "Jul 4, 11:00 AM", etaWarn: false },
  { tracking: "SHP-88033", from: "Boston, MA", to: "Philadelphia, PA", customer: "Grace Lin", carrier: "DHL Ground", status: "In Transit", eta: "Jul 6, 8:45 AM", etaWarn: false },
  { tracking: "SHP-87981", from: "Atlanta, GA", to: "Orlando, FL", customer: "Chen Wei", carrier: "FedEx Express", status: "Delayed", eta: "Jul 5, 3:00 PM", etaWarn: true },
];

export const shipmentKpis = [
  { label: "Total Shipments", value: "3,284", sub: "All time", color: "var(--acc)", tintBg: "var(--acc-soft)" },
  { label: "In Transit", value: "412", sub: "Currently moving", color: "var(--info)", tintBg: "var(--info-soft)" },
  { label: "Delivered", value: "2,760", sub: "This month", color: "var(--ok)", tintBg: "var(--ok-soft)" },
  { label: "Delayed", value: "32", sub: "Needs attention", color: "var(--bad)", tintBg: "var(--bad-soft)" },
];

export interface ShipmentStep {
  label: string;
  time: string;
  done: boolean;
}

export interface TrackingEvent {
  text: string;
  location: string;
  time: string;
  tint: string;
  tintBg: string;
}

export interface ShipmentDetail {
  tracking: string;
  from: string;
  to: string;
  status: string;
  progressPct: number;
  carrier: string;
  service: string;
  weight: string;
  packages: string;
  eta: string;
  recipientName: string;
  recipientAddress: string;
  recipientAvatarBg: string;
  steps: ShipmentStep[];
  history: TrackingEvent[];
}

export const shipmentDetails: ShipmentDetail[] = [
  {
    tracking: "SHP-88420",
    from: "San Francisco, CA",
    to: "New York, NY",
    status: "In Transit",
    progressPct: 56,
    carrier: "FedEx Express",
    service: "Priority Overnight",
    weight: "4.2 kg",
    packages: "2 boxes",
    eta: "Jul 6, 10:30 AM",
    recipientName: "Elena Park",
    recipientAddress: "185 Berry St, NY",
    recipientAvatarBg: "linear-gradient(135deg,#33d493,#56a8ff)",
    steps: [
      { label: "Order placed", time: "Jul 3, 9:10 AM", done: true },
      { label: "Picked up", time: "Jul 3, 2:40 PM", done: true },
      { label: "In transit", time: "Jul 4, 6:00 AM", done: true },
      { label: "Delivered", time: "Est. Jul 6", done: false },
    ],
    history: [
      { text: "Departed FedEx hub, Sacramento CA", location: "Sacramento, CA", time: "Jul 5, 4:12 AM", tint: "var(--acc)", tintBg: "var(--acc-soft)" },
      { text: "Arrived at sorting facility", location: "Reno, NV", time: "Jul 4, 9:20 PM", tint: "var(--info)", tintBg: "var(--info-soft)" },
      { text: "Departed origin facility", location: "San Francisco, CA", time: "Jul 4, 6:00 AM", tint: "var(--info)", tintBg: "var(--info-soft)" },
      { text: "Package picked up", location: "San Francisco, CA", time: "Jul 3, 2:40 PM", tint: "var(--ok)", tintBg: "var(--ok-soft)" },
      { text: "Shipment label created", location: "San Francisco, CA", time: "Jul 3, 9:10 AM", tint: "var(--t2)", tintBg: "var(--bg-3)" },
    ],
  },
  {
    tracking: "SHP-88317",
    from: "Los Angeles, CA",
    to: "Chicago, IL",
    status: "In Transit",
    progressPct: 40,
    carrier: "UPS Ground",
    service: "Standard Ground",
    weight: "6.8 kg",
    packages: "1 box",
    eta: "Jul 6, 2:00 PM",
    recipientName: "Robert Kim",
    recipientAddress: "42 Lakeshore Dr, Chicago",
    recipientAvatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)",
    steps: [
      { label: "Order placed", time: "Jul 2, 11:00 AM", done: true },
      { label: "Picked up", time: "Jul 2, 4:30 PM", done: true },
      { label: "In transit", time: "Jul 4, 7:15 AM", done: true },
      { label: "Delivered", time: "Est. Jul 6", done: false },
    ],
    history: [
      { text: "Departed regional hub", location: "Denver, CO", time: "Jul 5, 3:00 AM", tint: "var(--acc)", tintBg: "var(--acc-soft)" },
      { text: "Arrived at sorting facility", location: "Salt Lake City, UT", time: "Jul 4, 6:40 PM", tint: "var(--info)", tintBg: "var(--info-soft)" },
      { text: "Package picked up", location: "Los Angeles, CA", time: "Jul 2, 4:30 PM", tint: "var(--ok)", tintBg: "var(--ok-soft)" },
      { text: "Shipment label created", location: "Los Angeles, CA", time: "Jul 2, 11:00 AM", tint: "var(--t2)", tintBg: "var(--bg-3)" },
    ],
  },
  {
    tracking: "SHP-88291",
    from: "Dallas, TX",
    to: "Miami, FL",
    status: "Delayed",
    progressPct: 68,
    carrier: "DHL Express",
    service: "Express Worldwide",
    weight: "2.1 kg",
    packages: "1 box",
    eta: "Jul 5, 6:00 PM",
    recipientName: "Aisha Malik",
    recipientAddress: "900 Ocean Dr, Miami",
    recipientAvatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)",
    steps: [
      { label: "Order placed", time: "Jul 2, 8:00 AM", done: true },
      { label: "Picked up", time: "Jul 2, 1:10 PM", done: true },
      { label: "In transit", time: "Jul 3, 5:45 AM", done: true },
      { label: "Delivered", time: "Delayed", done: false },
    ],
    history: [
      { text: "Delivery delayed — weather conditions", location: "Orlando, FL", time: "Jul 5, 7:00 AM", tint: "var(--bad)", tintBg: "var(--bad-soft)" },
      { text: "Arrived at sorting facility", location: "Orlando, FL", time: "Jul 4, 11:20 PM", tint: "var(--info)", tintBg: "var(--info-soft)" },
      { text: "Package picked up", location: "Dallas, TX", time: "Jul 2, 1:10 PM", tint: "var(--ok)", tintBg: "var(--ok-soft)" },
      { text: "Shipment label created", location: "Dallas, TX", time: "Jul 2, 8:00 AM", tint: "var(--t2)", tintBg: "var(--bg-3)" },
    ],
  },
];

export interface ActiveDelivery {
  id: string;
  status: string;
  driver: string;
  vehicle: string;
  progress: number;
  stops: number;
  eta: string;
  tint: string;
  tintBg: string;
}

export const activeDeliveries: ActiveDelivery[] = [
  { id: "SHP-88420", status: "In Transit", driver: "Marco Diaz", vehicle: "Truck · TX-4821", progress: 56, stops: 3, eta: "10:30 AM", tint: "var(--acc)", tintBg: "var(--acc-soft)" },
  { id: "SHP-88317", status: "In Transit", driver: "Rita Kowalski", vehicle: "Van · CA-2290", progress: 40, stops: 5, eta: "2:00 PM", tint: "var(--acc)", tintBg: "var(--acc-soft)" },
  { id: "SHP-88291", status: "Delayed", driver: "Sam Okafor", vehicle: "Truck · FL-1187", progress: 68, stops: 2, eta: "6:00 PM", tint: "var(--warn)", tintBg: "var(--warn-soft)" },
  { id: "SHP-88204", status: "In Transit", driver: "Julia Novak", vehicle: "Van · OR-8843", progress: 22, stops: 6, eta: "9:00 AM", tint: "var(--acc)", tintBg: "var(--acc-soft)" },
  { id: "SHP-88033", status: "In Transit", driver: "Devon Marsh", vehicle: "Truck · MA-5521", progress: 81, stops: 1, eta: "8:45 AM", tint: "var(--acc)", tintBg: "var(--acc-soft)" },
];

export const fleetKpis = [
  { label: "Total Vehicles", value: "48", sub: "Fleet size", color: "var(--acc)" },
  { label: "Active", value: "42", sub: "On the road", color: "var(--ok)" },
  { label: "In Maintenance", value: "6", sub: "Scheduled service", color: "var(--warn)" },
  { label: "Avg. Mileage", value: "82,400 mi", sub: "Per vehicle", color: "var(--info)" },
];

export interface FleetVehicle {
  plate: string;
  model: string;
  status: string;
  driver: string;
  driverAv: string;
  driverBg: string;
  mileage: string;
  fuel: number;
  tint: string;
  tintBg: string;
}

export const fleetVehicles: FleetVehicle[] = [
  { plate: "TX-4821", model: "Freightliner Cascadia", status: "Active", driver: "Marco Diaz", driverAv: "MD", driverBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", mileage: "94,200 mi", fuel: 68, tint: "var(--acc)", tintBg: "var(--acc-soft)" },
  { plate: "CA-2290", model: "Ford Transit 350", status: "Active", driver: "Rita Kowalski", driverAv: "RK", driverBg: "linear-gradient(135deg,#33d493,#56a8ff)", mileage: "51,800 mi", fuel: 42, tint: "var(--info)", tintBg: "var(--info-soft)" },
  { plate: "FL-1187", model: "Freightliner Cascadia", status: "Active", driver: "Sam Okafor", driverBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", driverAv: "SO", mileage: "112,340 mi", fuel: 18, tint: "var(--acc)", tintBg: "var(--acc-soft)" },
  { plate: "OR-8843", model: "Mercedes Sprinter", status: "Active", driver: "Julia Novak", driverAv: "JN", driverBg: "linear-gradient(135deg,#9d86ff,#7c5cff)", mileage: "38,600 mi", fuel: 74, tint: "var(--info)", tintBg: "var(--info-soft)" },
  { plate: "MA-5521", model: "Volvo VNL 760", status: "Maintenance", driver: "Devon Marsh", driverAv: "DM", driverBg: "linear-gradient(135deg,#56a8ff,#33d493)", mileage: "128,900 mi", fuel: 55, tint: "var(--warn)", tintBg: "var(--warn-soft)" },
  { plate: "WA-3390", model: "Ford Transit 350", status: "Idle", driver: "Nina Volkov", driverAv: "NV", driverBg: "linear-gradient(135deg,#f76d7d,#9d86ff)", mileage: "22,150 mi", fuel: 91, tint: "var(--t2)", tintBg: "var(--bg-3)" },
];

export interface WarehouseZone {
  zone: string;
  items: number;
  type: string;
  pct: number;
  color: string;
  bg: string;
  border: string;
}

export const warehouseZones: WarehouseZone[] = [
  { zone: "A1", items: 2140, type: "Electronics", pct: 92, color: "var(--bad)", bg: "var(--bad-soft)", border: "var(--bad-soft)" },
  { zone: "A2", items: 1680, type: "Electronics", pct: 78, color: "var(--warn)", bg: "var(--warn-soft)", border: "var(--warn-soft)" },
  { zone: "B1", items: 980, type: "Apparel", pct: 54, color: "var(--ok)", bg: "var(--ok-soft)", border: "var(--ok-soft)" },
  { zone: "B2", items: 1120, type: "Apparel", pct: 61, color: "var(--ok)", bg: "var(--ok-soft)", border: "var(--ok-soft)" },
  { zone: "C1", items: 640, type: "Home Goods", pct: 38, color: "var(--acc)", bg: "var(--acc-soft)", border: "var(--acc-soft)" },
  { zone: "C2", items: 1420, type: "Home Goods", pct: 83, color: "var(--warn)", bg: "var(--warn-soft)", border: "var(--warn-soft)" },
  { zone: "D1", items: 320, type: "Perishables", pct: 22, color: "var(--info)", bg: "var(--info-soft)", border: "var(--info-soft)" },
  { zone: "D2", items: 860, type: "Misc.", pct: 47, color: "var(--acc)", bg: "var(--acc-soft)", border: "var(--acc-soft)" },
];

export interface RouteStop {
  num: number;
  address: string;
  time: string;
  packages: number;
  tint: string;
  tintBg: string;
  statusColor: string;
}

export const routeStops: RouteStop[] = [
  { num: 1, address: "70 Market St, San Francisco", time: "8:00 AM", packages: 3, tint: "var(--ok)", tintBg: "var(--ok-soft)", statusColor: "var(--ok)" },
  { num: 2, address: "140 5th Ave, San Francisco", time: "8:35 AM", packages: 2, tint: "var(--acc)", tintBg: "var(--acc-soft)", statusColor: "var(--t2)" },
  { num: 3, address: "120 Bay St, Oakland", time: "9:10 AM", packages: 4, tint: "var(--acc)", tintBg: "var(--acc-soft)", statusColor: "var(--t2)" },
  { num: 4, address: "230 Harrison St, Oakland", time: "9:50 AM", packages: 1, tint: "var(--acc)", tintBg: "var(--acc-soft)", statusColor: "var(--t2)" },
  { num: 5, address: "300 Broadway, Berkeley", time: "10:25 AM", packages: 5, tint: "var(--acc)", tintBg: "var(--acc-soft)", statusColor: "var(--t2)" },
  { num: 6, address: "390 University Ave, Berkeley", time: "11:05 AM", packages: 2, tint: "var(--acc)", tintBg: "var(--acc-soft)", statusColor: "var(--t2)" },
  { num: 7, address: "430 Solano Ave, Albany", time: "11:40 AM", packages: 3, tint: "var(--warn)", tintBg: "var(--warn-soft)", statusColor: "var(--warn)" },
];
