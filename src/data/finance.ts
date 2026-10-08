/** Mock fixtures for the Finance domain pages. Plain typed data  -  status/
 * category values stay free text and are mapped to colors via statusVariant
 * or explicit CSS-variable color tokens at render time. */

export interface FinanceKpi {
  label: string;
  value: string;
  sub: string;
  icon: string;
  tint: string;
  positive: boolean;
  delta: string;
  spark: number[];
}

export const financeKpis: FinanceKpi[] = [
  { label: "Total revenue", value: "$248,400", sub: "Year to date", icon: "dollar", tint: "var(--acc)", positive: true, delta: "+18.2%", spark: [30, 34, 32, 40, 38, 46, 52, 50, 58, 62, 60, 68] },
  { label: "Total expenses", value: "$96,180", sub: "Year to date", icon: "receipt", tint: "var(--bad)", positive: false, delta: "+4.1%", spark: [40, 38, 42, 40, 44, 42, 46, 44, 48, 46, 50, 48] },
  { label: "Net profit", value: "$152,220", sub: "61.3% margin", icon: "trendingUp", tint: "var(--ok)", positive: true, delta: "+24.6%", spark: [20, 24, 26, 30, 28, 34, 38, 40, 44, 48, 50, 56] },
  { label: "Cash on hand", value: "$412,860", sub: "6 accounts", icon: "wallet", tint: "var(--info)", positive: true, delta: "+6.8%", spark: [50, 48, 52, 54, 52, 58, 56, 60, 58, 62, 64, 66] },
];

export interface FinanceCashFlowCard {
  label: string;
  value: string;
  sub: string;
  icon: string;
  tint: string;
  valueColor: string;
  spark: number[];
}

export const financeCashFlow: FinanceCashFlowCard[] = [
  { label: "Money in", value: "$248,400", sub: "48 transactions", icon: "trendingUp", tint: "var(--ok)", valueColor: "var(--t0)", spark: [10, 18, 14, 22, 20, 28, 24, 30] },
  { label: "Money out", value: "$96,180", sub: "126 transactions", icon: "trendingDown", tint: "var(--bad)", valueColor: "var(--t0)", spark: [24, 20, 26, 22, 18, 20, 16, 14] },
  { label: "Net cash flow", value: "$152,220", sub: "vs $128,700 last period", icon: "barChart", tint: "var(--acc)", valueColor: "var(--acc)", spark: [8, 14, 12, 20, 18, 26, 24, 32] },
];

export const financeRevenueMonthly = [16.2, 17.8, 18.4, 19.6, 21.2, 20.4, 22.8, 24.1, 23.6, 25.8, 27.2, 28.4];
export const financeExpenseMonthly = [7.1, 7.4, 7.6, 8.0, 7.8, 8.2, 8.6, 8.4, 8.8, 9.0, 8.9, 9.4];
export const financeChartMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DonutSegmentData {
  name: string;
  value: string;
  pct: number;
  color: string;
}

export const financeExpenseBreakdown: DonutSegmentData[] = [
  { name: "Payroll", value: "$42,100", pct: 44, color: "var(--acc)" },
  { name: "Software & tools", value: "$18,600", pct: 19, color: "var(--info)" },
  { name: "Marketing", value: "$14,200", pct: 15, color: "var(--ok)" },
  { name: "Office & ops", value: "$12,400", pct: 13, color: "var(--warn)" },
  { name: "Travel", value: "$8,880", pct: 9, color: "var(--bad)" },
];

export interface FinanceBudgetItem {
  name: string;
  spent: string;
  total: string;
  pct: number;
  color: string;
  remaining: string;
  alert?: boolean;
}

export const financeBudgets: FinanceBudgetItem[] = [
  { name: "Marketing", spent: "$14,200", total: "$16,000", pct: 89, color: "var(--warn)", remaining: "$1,800", alert: true },
  { name: "Engineering tools", spent: "$18,600", total: "$22,000", pct: 85, color: "var(--warn)", remaining: "$3,400", alert: true },
  { name: "Office & ops", spent: "$12,400", total: "$20,000", pct: 62, color: "var(--ok)", remaining: "$7,600" },
  { name: "Travel", spent: "$8,880", total: "$18,000", pct: 49, color: "var(--acc)", remaining: "$9,120" },
];

export type TxType = "Income" | "Expense" | "Refund";

export interface Transaction {
  id: string;
  name: string;
  method: string;
  category: string;
  date: string;
  status: string;
  amount: string;
  type: TxType;
  icon: string;
  tint: string;
}

export const transactions: Transaction[] = [
  { id: "TX-98231", name: "Acme Corporation", method: "Bank transfer", category: "Client payment", date: "Jul 8, 2026", status: "Completed", amount: "+$12,400", type: "Income", icon: "dollar", tint: "var(--ok)" },
  { id: "TX-98230", name: "AWS Cloud Services", method: "Auto-debit card", category: "Software", date: "Jul 7, 2026", status: "Completed", amount: "−$2,180", type: "Expense", icon: "creditCard", tint: "var(--bad)" },
  { id: "TX-98229", name: "Northwind Inc.", method: "Wire transfer", category: "Client payment", date: "Jul 6, 2026", status: "Completed", amount: "+$8,600", type: "Income", icon: "dollar", tint: "var(--ok)" },
  { id: "TX-98228", name: "Payroll — June", method: "ACH batch", category: "Payroll", date: "Jul 5, 2026", status: "Completed", amount: "−$42,100", type: "Expense", icon: "users", tint: "var(--bad)" },
  { id: "TX-98227", name: "Globex Ltd. refund", method: "Bank transfer", category: "Refund", date: "Jul 4, 2026", status: "Processing", amount: "−$1,240", type: "Refund", icon: "receipt", tint: "var(--warn)" },
  { id: "TX-98226", name: "Figma Enterprise", method: "Auto-debit card", category: "Software", date: "Jul 3, 2026", status: "Completed", amount: "−$860", type: "Expense", icon: "creditCard", tint: "var(--bad)" },
  { id: "TX-98225", name: "Initech Contract", method: "Wire transfer", category: "Client payment", date: "Jul 2, 2026", status: "Completed", amount: "+$18,000", type: "Income", icon: "dollar", tint: "var(--ok)" },
  { id: "TX-98224", name: "WeWork Office", method: "Bank transfer", category: "Office & ops", date: "Jul 1, 2026", status: "Completed", amount: "−$4,200", type: "Expense", icon: "briefcase", tint: "var(--bad)" },
  { id: "TX-98223", name: "Vercel Enterprise", method: "Auto-debit card", category: "Software", date: "Jun 30, 2026", status: "Failed", amount: "−$1,600", type: "Expense", icon: "creditCard", tint: "var(--bad)" },
  { id: "TX-98222", name: "Stark Industries", method: "Bank transfer", category: "Client payment", date: "Jun 29, 2026", status: "Completed", amount: "+$24,600", type: "Income", icon: "dollar", tint: "var(--ok)" },
];

export const transactionsKpis = [
  { label: "Total volume", value: "$2.4M", sub: "8,428 transactions", color: "var(--t0)" },
  { label: "Income", value: "$1.86M", sub: "5,204 transactions", color: "var(--ok)" },
  { label: "Expenses", value: "$540k", sub: "3,102 transactions", color: "var(--bad)" },
  { label: "Failed / disputed", value: "$12.4k", sub: "18 transactions", color: "var(--warn)" },
];

export interface PaymentCard {
  label: string;
  value: string;
  sub: string;
  icon: string;
  tint: string;
  color: string;
}

export const paymentCards: PaymentCard[] = [
  { label: "Received this month", value: "$84,200", sub: "62 payments", icon: "trendingUp", tint: "var(--ok)", color: "var(--ok)" },
  { label: "Pending payouts", value: "$18,600", sub: "9 payments processing", icon: "wallet", tint: "var(--warn)", color: "var(--warn)" },
  { label: "Failed payments", value: "$2,140", sub: "4 payments need action", icon: "alertTriangle", tint: "var(--bad)", color: "var(--bad)" },
];

export interface PaymentEntry {
  name: string;
  avatar: string;
  avatarBg: string;
  ref: string;
  date: string;
  status: string;
  amount: string;
}

export const payments: PaymentEntry[] = [
  { name: "Acme Corporation", avatar: "AC", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", ref: "PAY-5521", date: "Jul 8, 2026", status: "Completed", amount: "+$12,400" },
  { name: "Northwind Inc.", avatar: "NI", avatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", ref: "PAY-5520", date: "Jul 6, 2026", status: "Completed", amount: "+$8,600" },
  { name: "Globex Ltd.", avatar: "GL", avatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", ref: "PAY-5519", date: "Jul 4, 2026", status: "Processing", amount: "+$3,240" },
  { name: "Initech", avatar: "IT", avatarBg: "linear-gradient(135deg,#9d86ff,#7c5cff)", ref: "PAY-5518", date: "Jul 2, 2026", status: "Completed", amount: "+$18,000" },
  { name: "Stark Industries", avatar: "SI", avatarBg: "linear-gradient(135deg,#56a8ff,#33d493)", ref: "PAY-5517", date: "Jun 29, 2026", status: "Completed", amount: "+$24,600" },
  { name: "Umbrella Co.", avatar: "UC", avatarBg: "linear-gradient(135deg,#f76d7d,#9d86ff)", ref: "PAY-5516", date: "Jun 27, 2026", status: "Failed", amount: "+$1,860" },
];

export interface PaymentMethod {
  brand: string;
  brandBg: string;
  last4: string;
  exp: string;
  isDefault?: boolean;
}

export const paymentMethods: PaymentMethod[] = [
  { brand: "VISA", brandBg: "#1a56db", last4: "4242", exp: "08/28", isDefault: true },
  { brand: "MC", brandBg: "#eb5757", last4: "8890", exp: "11/27" },
  { brand: "AMEX", brandBg: "#0f766e", last4: "1005", exp: "02/29" },
];

export interface ExpenseCategory {
  name: string;
  value: string;
  pct: number;
  color: string;
}

export const expenseCategories: ExpenseCategory[] = [
  { name: "Payroll", value: "$42,100", pct: 44, color: "var(--acc)" },
  { name: "Software & tools", value: "$18,600", pct: 19, color: "var(--info)" },
  { name: "Marketing", value: "$14,200", pct: 15, color: "var(--ok)" },
  { name: "Office & ops", value: "$12,400", pct: 13, color: "var(--warn)" },
  { name: "Travel", value: "$8,880", pct: 9, color: "var(--bad)" },
];

export const expenseSummary = {
  monthTotal: "$16,030",
  monthDelta: "−4.2% vs last month",
  pendingApproval: "$3,240",
  reimbursable: "$1,860",
  recurring: "$9,400",
};

export interface ExpenseEntry {
  name: string;
  vendor: string;
  category: string;
  date: string;
  status: string;
  amount: string;
  icon: string;
  tint: string;
}

export const expenseList: ExpenseEntry[] = [
  { name: "AWS Cloud Services", vendor: "Amazon Web Services", category: "Software & tools", date: "Jul 7, 2026", status: "Approved", amount: "$2,180", icon: "creditCard", tint: "var(--info)" },
  { name: "Team offsite", vendor: "Marriott Downtown", category: "Travel", date: "Jul 5, 2026", status: "Pending", amount: "$4,600", icon: "briefcase", tint: "var(--warn)" },
  { name: "Figma Enterprise", vendor: "Figma Inc.", category: "Software & tools", date: "Jul 3, 2026", status: "Approved", amount: "$860", icon: "creditCard", tint: "var(--info)" },
  { name: "WeWork Office", vendor: "WeWork", category: "Office & ops", date: "Jul 1, 2026", status: "Approved", amount: "$4,200", icon: "home", tint: "var(--acc)" },
  { name: "Google Ads campaign", vendor: "Google LLC", category: "Marketing", date: "Jun 28, 2026", status: "Approved", amount: "$3,800", icon: "trendingUp", tint: "var(--ok)" },
  { name: "Client dinner", vendor: "The Capital Grille", category: "Travel", date: "Jun 24, 2026", status: "Rejected", amount: "$420", icon: "briefcase", tint: "var(--bad)" },
];

export interface PnlRow {
  label: string;
  value: string;
  bold?: boolean;
  indent?: boolean;
  color?: string;
}

export const pnlSummary = [
  { label: "Total revenue", value: "$248,400", sub: "+18% YoY", color: "var(--ok)" },
  { label: "Total expenses", value: "$96,180", sub: "38.7% of revenue", color: "var(--bad)" },
  { label: "Net profit", value: "$152,220", sub: "61.3% margin", color: "var(--acc)" },
];

export const pnlRows: PnlRow[] = [
  { label: "Revenue", value: "$248,400", bold: true },
  { label: "Product sales", value: "$186,200", indent: true },
  { label: "Service revenue", value: "$62,200", indent: true },
  { label: "Cost of goods sold", value: "−$38,400" },
  { label: "Gross profit", value: "$210,000", bold: true, color: "var(--ok)" },
  { label: "Operating expenses", value: "−$57,780" },
  { label: "Payroll", value: "−$42,100", indent: true },
  { label: "Marketing", value: "−$14,200", indent: true },
  { label: "Other opex", value: "−$1,480", indent: true },
  { label: "Net profit", value: "$152,220", bold: true, color: "var(--acc)" },
];

export interface BudgetCard {
  name: string;
  period: string;
  spent: string;
  total: string;
  pct: number;
  color: string;
  remaining: string;
  icon: string;
  alert?: boolean;
}

export const budgetCards: BudgetCard[] = [
  { name: "Marketing", period: "Q3 2026 · Monthly", spent: "$14,200", total: "$16,000", pct: 89, color: "var(--warn)", remaining: "$1,800", icon: "trendingUp", alert: true },
  { name: "Engineering tools", period: "Q3 2026 · Monthly", spent: "$18,600", total: "$22,000", pct: 85, color: "var(--warn)", remaining: "$3,400", icon: "creditCard", alert: true },
  { name: "Office & ops", period: "Q3 2026 · Monthly", spent: "$12,400", total: "$20,000", pct: 62, color: "var(--ok)", remaining: "$7,600", icon: "home" },
  { name: "Travel", period: "Q3 2026 · Monthly", spent: "$8,880", total: "$18,000", pct: 49, color: "var(--acc)", remaining: "$9,120", icon: "briefcase" },
  { name: "Payroll", period: "Q3 2026 · Monthly", spent: "$42,100", total: "$50,000", pct: 84, color: "var(--warn)", remaining: "$7,900", icon: "users" },
  { name: "R&D", period: "Q3 2026 · Quarterly", spent: "$29,400", total: "$38,000", pct: 77, color: "var(--acc)", remaining: "$8,600", icon: "layers" },
];

export interface InvoiceLine {
  desc: string;
  qty: number;
  rate: string;
  amount: string;
}

export interface Invoice {
  id: string;
  client: string;
  clientEmail: string;
  clientAddress: string;
  avatar: string;
  avatarBg: string;
  issued: string;
  due: string;
  status: string;
  amount: string;
  lines: InvoiceLine[];
  subtotal: string;
  tax: string;
  total: string;
}

export const invoices: Invoice[] = [
  {
    id: "INV-2048", client: "Acme Corporation", clientEmail: "billing@acme.com", clientAddress: "500 Enterprise Way, New York, NY 10001",
    avatar: "AC", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", issued: "Jun 20, 2026", due: "Jul 20, 2026", status: "Pending", amount: "$30,240",
    lines: [
      { desc: "Platform implementation — Phase 2", qty: 1, rate: "$18,000", amount: "$18,000" },
      { desc: "Custom integration hours", qty: 40, rate: "$180", amount: "$7,200" },
      { desc: "Priority support retainer", qty: 1, rate: "$2,800", amount: "$2,800" },
    ],
    subtotal: "$28,000", tax: "$2,240", total: "$30,240",
  },
  {
    id: "INV-2047", client: "Northwind Inc.", clientEmail: "ap@northwind.com", clientAddress: "88 Harbor Rd, Seattle, WA 98101",
    avatar: "NI", avatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", issued: "Jun 12, 2026", due: "Jul 12, 2026", status: "Paid", amount: "$8,600",
    lines: [
      { desc: "Monthly retainer — June", qty: 1, rate: "$8,000", amount: "$8,000" },
      { desc: "Extra revision rounds", qty: 2, rate: "$300", amount: "$600" },
    ],
    subtotal: "$8,600", tax: "$0", total: "$8,600",
  },
  {
    id: "INV-2046", client: "Globex Ltd.", clientEmail: "finance@globex.com", clientAddress: "12 Kings Cross, London, UK",
    avatar: "GL", avatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", issued: "Jun 5, 2026", due: "Jun 19, 2026", status: "Overdue", amount: "$14,900",
    lines: [
      { desc: "Design system audit", qty: 1, rate: "$6,500", amount: "$6,500" },
      { desc: "Component library build", qty: 1, rate: "$8,400", amount: "$8,400" },
    ],
    subtotal: "$14,900", tax: "$0", total: "$14,900",
  },
  {
    id: "INV-2045", client: "Initech", clientEmail: "billing@initech.com", clientAddress: "1 Office Park, Austin, TX 73301",
    avatar: "IT", avatarBg: "linear-gradient(135deg,#9d86ff,#7c5cff)", issued: "May 28, 2026", due: "Jun 28, 2026", status: "Paid", amount: "$18,000",
    lines: [{ desc: "Annual license renewal", qty: 1, rate: "$18,000", amount: "$18,000" }],
    subtotal: "$18,000", tax: "$0", total: "$18,000",
  },
  {
    id: "INV-2044", client: "Stark Industries", clientEmail: "ap@stark.com", clientAddress: "200 Park Ave, New York, NY 10166",
    avatar: "SI", avatarBg: "linear-gradient(135deg,#56a8ff,#33d493)", issued: "May 20, 2026", due: "Jun 20, 2026", status: "Draft", amount: "$24,600",
    lines: [
      { desc: "Infrastructure consulting", qty: 60, rate: "$320", amount: "$19,200" },
      { desc: "Security review", qty: 1, rate: "$5,400", amount: "$5,400" },
    ],
    subtotal: "$24,600", tax: "$0", total: "$24,600",
  },
  {
    id: "INV-2043", client: "Umbrella Co.", clientEmail: "billing@umbrella.co", clientAddress: "3 Racoon City Blvd, Raccoon City",
    avatar: "UC", avatarBg: "linear-gradient(135deg,#f76d7d,#9d86ff)", issued: "May 14, 2026", due: "Jun 14, 2026", status: "Overdue", amount: "$9,720",
    lines: [{ desc: "Q2 support contract", qty: 1, rate: "$9,720", amount: "$9,720" }],
    subtotal: "$9,720", tax: "$0", total: "$9,720",
  },
  {
    id: "INV-2042", client: "Vercel", clientEmail: "ap@vercel.com", clientAddress: "440 N Barranca Ave, Covina, CA 91723",
    avatar: "VE", avatarBg: "linear-gradient(135deg,#7c5cff,#33d493)", issued: "May 8, 2026", due: "Jun 8, 2026", status: "Paid", amount: "$12,300",
    lines: [{ desc: "Platform migration", qty: 1, rate: "$12,300", amount: "$12,300" }],
    subtotal: "$12,300", tax: "$0", total: "$12,300",
  },
  {
    id: "INV-2041", client: "Acme Corporation", clientEmail: "billing@acme.com", clientAddress: "500 Enterprise Way, New York, NY 10001",
    avatar: "AC", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", issued: "Apr 30, 2026", due: "May 30, 2026", status: "Paid", amount: "$21,050",
    lines: [{ desc: "Platform implementation — Phase 1", qty: 1, rate: "$21,050", amount: "$21,050" }],
    subtotal: "$21,050", tax: "$0", total: "$21,050",
  },
];

export const invoiceKpis = [
  { label: "Outstanding", value: "$184,200", sub: "62 invoices", color: "var(--warn)" },
  { label: "Paid this month", value: "$96,400", sub: "48 invoices", color: "var(--ok)" },
  { label: "Overdue", value: "$24,620", sub: "6 invoices", color: "var(--bad)" },
  { label: "Draft", value: "$24,600", sub: "3 invoices", color: "var(--t1)" },
];

export interface FinancialReport {
  name: string;
  desc: string;
  format: string;
  updated: string;
  icon: string;
  tint: string;
}

export const financialReports: FinancialReport[] = [
  { name: "Income statement", desc: "Revenue, expenses and net profit for the selected period.", format: "PDF", updated: "Jul 1, 2026", icon: "file", tint: "var(--acc)" },
  { name: "Balance sheet", desc: "Assets, liabilities and equity as of period end.", format: "PDF", updated: "Jul 1, 2026", icon: "layers", tint: "var(--info)" },
  { name: "Cash flow statement", desc: "Operating, investing and financing cash movements.", format: "XLSX", updated: "Jun 30, 2026", icon: "barChart", tint: "var(--ok)" },
  { name: "Accounts receivable aging", desc: "Outstanding invoices grouped by days overdue.", format: "XLSX", updated: "Jun 28, 2026", icon: "receipt", tint: "var(--warn)" },
  { name: "Expense report", desc: "Detailed breakdown of expenses by category and vendor.", format: "CSV", updated: "Jun 25, 2026", icon: "creditCard", tint: "var(--bad)" },
  { name: "Tax summary", desc: "Quarterly tax liability and payment summary.", format: "PDF", updated: "Jun 20, 2026", icon: "briefcase", tint: "var(--acc)" },
];
