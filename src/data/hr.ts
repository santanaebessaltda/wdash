import { statusVariant, type StatusVariant } from "@/lib/status";

/** Extends the generic status -> color mapping with HR-specific vocabulary
 * (recruitment stages, leave types) that isn't covered by the shared list. */
export function hrStatusVariant(status: string): StatusVariant {
  const s = status.trim().toLowerCase();
  if (["screening", "interview", "shortlisted"].includes(s)) return "accent";
  if (["offer", "final round"].includes(s)) return "info";
  if (["hired"].includes(s)) return "success";
  if (["applied", "new applicant"].includes(s)) return "neutral";
  if (["unpaid"].includes(s)) return "danger";
  return statusVariant(status);
}

export interface EmployeeStat {
  label: string;
  value: string;
  color: string;
}

export interface Employee {
  id: string;
  empCode: string;
  name: string;
  role: string;
  dept: string;
  deptColor: string;
  deptBg: string;
  avatarBg: string;
  online: boolean;
  tenure: string;
  status: string;
  location: string;
  reportsTo: string;
  startDate: string;
  employmentType: string;
  workLocation: string;
  email: string;
  phone: string;
  emergencyPhone: string;
  skills: string[];
  stats: EmployeeStat[];
  vacationUsed: number;
  vacationTotal: number;
  sickUsed: number;
  sickTotal: number;
}

const g1 = "linear-gradient(135deg,#7c5cff,#56a8ff)";
const g2 = "linear-gradient(135deg,#33d493,#56a8ff)";
const g3 = "linear-gradient(135deg,#f7b84e,#f76d7d)";
const g4 = "linear-gradient(135deg,#9d86ff,#7c5cff)";
const g5 = "linear-gradient(135deg,#56a8ff,#33d493)";
const g6 = "linear-gradient(135deg,#f76d7d,#9d86ff)";

export const employees: Employee[] = [
  {
    id: "1",
    empCode: "EMP-0142",
    name: "David Stone",
    role: "Senior DevOps Engineer",
    dept: "Engineering",
    deptColor: "var(--acc)",
    deptBg: "var(--acc-soft)",
    avatarBg: g1,
    online: true,
    tenure: "2.4 yrs",
    status: "Active",
    location: "Austin, TX",
    reportsTo: "Dana Keller",
    startDate: "Feb 12, 2024",
    employmentType: "Full-time",
    workLocation: "Remote · Austin, TX",
    email: "david@vela.io",
    phone: "+1 (512) 555-0188",
    emergencyPhone: "+1 (512) 555-0199",
    skills: ["Kubernetes", "Terraform", "AWS", "CI/CD", "Go", "Python"],
    stats: [
      { label: "Projects", value: "18", color: "var(--acc)" },
      { label: "Tasks done", value: "312", color: "var(--ok)" },
      { label: "Team size", value: "6", color: "var(--info)" },
      { label: "Performance", value: "94%", color: "var(--warn)" },
    ],
    vacationUsed: 12,
    vacationTotal: 20,
    sickUsed: 8,
    sickTotal: 10,
  },
  {
    id: "2",
    empCode: "EMP-0118",
    name: "Priya Nair",
    role: "Product Designer",
    dept: "Design",
    deptColor: "var(--info)",
    deptBg: "var(--info-soft)",
    avatarBg: g2,
    online: true,
    tenure: "1.8 yrs",
    status: "Active",
    location: "New York, NY",
    reportsTo: "Elena Cross",
    startDate: "Sep 3, 2024",
    employmentType: "Full-time",
    workLocation: "Hybrid · New York, NY",
    email: "priya@vela.io",
    phone: "+1 (212) 555-0142",
    emergencyPhone: "+1 (212) 555-0177",
    skills: ["Figma", "Design Systems", "Prototyping", "User Research"],
    stats: [
      { label: "Projects", value: "11", color: "var(--acc)" },
      { label: "Tasks done", value: "204", color: "var(--ok)" },
      { label: "Team size", value: "4", color: "var(--info)" },
      { label: "Performance", value: "97%", color: "var(--warn)" },
    ],
    vacationUsed: 6,
    vacationTotal: 20,
    sickUsed: 2,
    sickTotal: 10,
  },
  {
    id: "3",
    empCode: "EMP-0097",
    name: "Marcus Bell",
    role: "Sales Director",
    dept: "Sales",
    deptColor: "var(--ok)",
    deptBg: "var(--ok-soft)",
    avatarBg: g3,
    online: false,
    tenure: "4.1 yrs",
    status: "Active",
    location: "Chicago, IL",
    reportsTo: "Karen Wu",
    startDate: "Jun 18, 2021",
    employmentType: "Full-time",
    workLocation: "On-site · Chicago, IL",
    email: "marcus@vela.io",
    phone: "+1 (312) 555-0161",
    emergencyPhone: "+1 (312) 555-0122",
    skills: ["Negotiation", "CRM", "Forecasting", "Team Leadership"],
    stats: [
      { label: "Deals closed", value: "64", color: "var(--acc)" },
      { label: "Quota", value: "118%", color: "var(--ok)" },
      { label: "Team size", value: "9", color: "var(--info)" },
      { label: "Performance", value: "91%", color: "var(--warn)" },
    ],
    vacationUsed: 15,
    vacationTotal: 20,
    sickUsed: 4,
    sickTotal: 10,
  },
  {
    id: "4",
    empCode: "EMP-0176",
    name: "Sofia Ramirez",
    role: "Marketing Manager",
    dept: "Marketing",
    deptColor: "var(--warn)",
    deptBg: "var(--warn-soft)",
    avatarBg: g4,
    online: true,
    tenure: "1.2 yrs",
    status: "Active",
    location: "Miami, FL",
    reportsTo: "Karen Wu",
    startDate: "Apr 22, 2025",
    employmentType: "Full-time",
    workLocation: "Remote · Miami, FL",
    email: "sofia@vela.io",
    phone: "+1 (305) 555-0133",
    emergencyPhone: "+1 (305) 555-0188",
    skills: ["Campaigns", "SEO", "Analytics", "Content Strategy"],
    stats: [
      { label: "Campaigns", value: "22", color: "var(--acc)" },
      { label: "Tasks done", value: "156", color: "var(--ok)" },
      { label: "Team size", value: "3", color: "var(--info)" },
      { label: "Performance", value: "89%", color: "var(--warn)" },
    ],
    vacationUsed: 4,
    vacationTotal: 20,
    sickUsed: 1,
    sickTotal: 10,
  },
  {
    id: "5",
    empCode: "EMP-0203",
    name: "Ken Osei",
    role: "Backend Engineer",
    dept: "Engineering",
    deptColor: "var(--acc)",
    deptBg: "var(--acc-soft)",
    avatarBg: g5,
    online: false,
    tenure: "0.6 yrs",
    status: "Active",
    location: "Seattle, WA",
    reportsTo: "Dana Keller",
    startDate: "Nov 4, 2025",
    employmentType: "Full-time",
    workLocation: "Remote · Seattle, WA",
    email: "ken@vela.io",
    phone: "+1 (206) 555-0119",
    emergencyPhone: "+1 (206) 555-0155",
    skills: ["Node.js", "PostgreSQL", "Redis", "GraphQL"],
    stats: [
      { label: "Projects", value: "5", color: "var(--acc)" },
      { label: "Tasks done", value: "88", color: "var(--ok)" },
      { label: "Team size", value: "6", color: "var(--info)" },
      { label: "Performance", value: "92%", color: "var(--warn)" },
    ],
    vacationUsed: 2,
    vacationTotal: 20,
    sickUsed: 0,
    sickTotal: 10,
  },
  {
    id: "6",
    empCode: "EMP-0064",
    name: "Hannah Lindqvist",
    role: "Customer Success Lead",
    dept: "Customer Success",
    deptColor: "var(--info)",
    deptBg: "var(--info-soft)",
    avatarBg: g6,
    online: true,
    tenure: "3.3 yrs",
    status: "On leave",
    location: "Denver, CO",
    reportsTo: "Elena Cross",
    startDate: "Jan 9, 2023",
    employmentType: "Full-time",
    workLocation: "Hybrid · Denver, CO",
    email: "hannah@vela.io",
    phone: "+1 (720) 555-0144",
    emergencyPhone: "+1 (720) 555-0111",
    skills: ["Onboarding", "Support Ops", "Retention", "Zendesk"],
    stats: [
      { label: "Accounts", value: "48", color: "var(--acc)" },
      { label: "CSAT", value: "96%", color: "var(--ok)" },
      { label: "Team size", value: "5", color: "var(--info)" },
      { label: "Performance", value: "95%", color: "var(--warn)" },
    ],
    vacationUsed: 18,
    vacationTotal: 20,
    sickUsed: 6,
    sickTotal: 10,
  },
  {
    id: "7",
    empCode: "EMP-0231",
    name: "Owen Fischer",
    role: "Finance Analyst",
    dept: "Finance",
    deptColor: "var(--ok)",
    deptBg: "var(--ok-soft)",
    avatarBg: g1,
    online: false,
    tenure: "1.5 yrs",
    status: "Active",
    location: "Boston, MA",
    reportsTo: "Karen Wu",
    startDate: "Dec 1, 2024",
    employmentType: "Full-time",
    workLocation: "On-site · Boston, MA",
    email: "owen@vela.io",
    phone: "+1 (617) 555-0177",
    emergencyPhone: "+1 (617) 555-0166",
    skills: ["Modeling", "Budgeting", "Excel", "Reporting"],
    stats: [
      { label: "Reports", value: "34", color: "var(--acc)" },
      { label: "Tasks done", value: "142", color: "var(--ok)" },
      { label: "Team size", value: "3", color: "var(--info)" },
      { label: "Performance", value: "90%", color: "var(--warn)" },
    ],
    vacationUsed: 9,
    vacationTotal: 20,
    sickUsed: 3,
    sickTotal: 10,
  },
  {
    id: "8",
    empCode: "EMP-0055",
    name: "Ava Chen",
    role: "Engineering Manager",
    dept: "Engineering",
    deptColor: "var(--acc)",
    deptBg: "var(--acc-soft)",
    avatarBg: g2,
    online: true,
    tenure: "5.2 yrs",
    status: "Active",
    location: "San Francisco, CA",
    reportsTo: "Dana Keller",
    startDate: "May 14, 2020",
    employmentType: "Full-time",
    workLocation: "On-site · San Francisco, CA",
    email: "ava@vela.io",
    phone: "+1 (415) 555-0111",
    emergencyPhone: "+1 (415) 555-0122",
    skills: ["Leadership", "System Design", "Roadmapping", "Mentoring"],
    stats: [
      { label: "Projects", value: "26", color: "var(--acc)" },
      { label: "Tasks done", value: "410", color: "var(--ok)" },
      { label: "Team size", value: "12", color: "var(--info)" },
      { label: "Performance", value: "98%", color: "var(--warn)" },
    ],
    vacationUsed: 10,
    vacationTotal: 20,
    sickUsed: 2,
    sickTotal: 10,
  },
];

export const hrEmpKpis = [
  { label: "Total Employees", value: "142", sub: "+6 this month", color: "var(--acc)" },
  { label: "New Hires", value: "6", sub: "This month", color: "var(--ok)" },
  { label: "Open Positions", value: "12", sub: "Across 5 teams", color: "var(--warn)" },
  { label: "Avg. Tenure", value: "2.4 yrs", sub: "Company wide", color: "var(--info)" },
];

export const attendanceKpis = [
  { label: "Present", value: "128", color: "var(--ok)", tintBg: "var(--ok-soft)" },
  { label: "Absent", value: "8", color: "var(--bad)", tintBg: "var(--bad-soft)" },
  { label: "Late arrivals", value: "14", color: "var(--warn)", tintBg: "var(--warn-soft)" },
  { label: "On leave", value: "6", color: "var(--info)", tintBg: "var(--info-soft)" },
];

export interface AttendanceRow {
  name: string;
  dept: string;
  avatar: string;
  avatarBg: string;
  in: string;
  out: string;
  hours: string;
  status: string;
  lateIn: boolean;
}

export const attendanceRows: AttendanceRow[] = [
  { name: "David Stone", dept: "Engineering", avatar: "DS", avatarBg: g1, in: "9:02 AM", out: "6:14 PM", hours: "9h 12m", status: "Present", lateIn: false },
  { name: "Priya Nair", dept: "Design", avatar: "PN", avatarBg: g2, in: "9:31 AM", out: "6:02 PM", hours: "8h 31m", status: "Present", lateIn: true },
  { name: "Marcus Bell", dept: "Sales", avatar: "MB", avatarBg: g3, in: "—", out: "—", hours: "0h", status: "Absent", lateIn: false },
  { name: "Sofia Ramirez", dept: "Marketing", avatar: "SR", avatarBg: g4, in: "8:55 AM", out: "5:48 PM", hours: "8h 53m", status: "Present", lateIn: false },
  { name: "Ken Osei", dept: "Engineering", avatar: "KO", avatarBg: g5, in: "9:47 AM", out: "6:30 PM", hours: "8h 43m", status: "Present", lateIn: true },
  { name: "Hannah Lindqvist", dept: "Customer Success", avatar: "HL", avatarBg: g6, in: "—", out: "—", hours: "0h", status: "On leave", lateIn: false },
  { name: "Owen Fischer", dept: "Finance", avatar: "OF", avatarBg: g1, in: "9:00 AM", out: "6:05 PM", hours: "9h 05m", status: "Present", lateIn: false },
  { name: "Ava Chen", dept: "Engineering", avatar: "AC", avatarBg: g2, in: "8:48 AM", out: "6:40 PM", hours: "9h 52m", status: "Present", lateIn: false },
];

export const leaveKpis = [
  { label: "Pending", value: "8", color: "var(--warn)" },
  { label: "Approved", value: "14", color: "var(--ok)" },
  { label: "Rejected", value: "2", color: "var(--bad)" },
  { label: "Total this month", value: "24", color: "var(--acc)" },
];

export interface LeaveRequest {
  name: string;
  dept: string;
  avatar: string;
  avatarBg: string;
  type: string;
  dates: string;
  days: string;
  pending: boolean;
  status: string;
}

export const leaveRequests: LeaveRequest[] = [
  { name: "Ken Osei", dept: "Engineering", avatar: "KO", avatarBg: g5, type: "Sick leave", dates: "Jul 8 – Jul 9", days: "2 days", pending: true, status: "" },
  { name: "Sofia Ramirez", dept: "Marketing", avatar: "SR", avatarBg: g4, type: "Vacation", dates: "Jul 14 – Jul 21", days: "6 days", pending: true, status: "" },
  { name: "Owen Fischer", dept: "Finance", avatar: "OF", avatarBg: g1, type: "Personal", dates: "Jul 11", days: "1 day", pending: true, status: "" },
  { name: "David Stone", dept: "Engineering", avatar: "DS", avatarBg: g1, type: "Vacation", dates: "Jun 20 – Jun 27", days: "6 days", pending: false, status: "Approved" },
  { name: "Hannah Lindqvist", dept: "Customer Success", avatar: "HL", avatarBg: g6, type: "Sick leave", dates: "Jul 1 – Jul 5", days: "5 days", pending: false, status: "Approved" },
  { name: "Marcus Bell", dept: "Sales", avatar: "MB", avatarBg: g3, type: "Unpaid", dates: "Jun 15", days: "1 day", pending: false, status: "Rejected" },
];

export const leaveTypeColors: Record<string, StatusVariant> = {
  "Sick leave": "danger",
  Vacation: "accent",
  Personal: "info",
  Unpaid: "neutral",
};

export const payrollKpis = [
  { label: "Total Payroll", value: "$1.42M", sub: "June 2026 run", color: "var(--acc)" },
  { label: "Avg. Salary", value: "$6,850", sub: "Per employee", color: "var(--ok)" },
  { label: "Bonuses Paid", value: "$184K", sub: "This cycle", color: "var(--warn)" },
  { label: "Pending Approvals", value: "3", sub: "Awaiting sign-off", color: "var(--info)" },
];

export interface PayrollRow {
  name: string;
  role: string;
  avatar: string;
  avatarBg: string;
  base: string;
  bonus: string;
  deductions: string;
  net: string;
  status: string;
}

export const payrollRows: PayrollRow[] = [
  { name: "David Stone", role: "Sr. DevOps Engineer", avatar: "DS", avatarBg: g1, base: "$8,200", bonus: "$600", deductions: "-$1,180", net: "$7,620", status: "Paid" },
  { name: "Priya Nair", role: "Product Designer", avatar: "PN", avatarBg: g2, base: "$7,400", bonus: "$400", deductions: "-$1,020", net: "$6,780", status: "Paid" },
  { name: "Marcus Bell", role: "Sales Director", avatar: "MB", avatarBg: g3, base: "$9,600", bonus: "$2,100", deductions: "-$1,480", net: "$10,220", status: "Paid" },
  { name: "Sofia Ramirez", role: "Marketing Manager", avatar: "SR", avatarBg: g4, base: "$6,900", bonus: "$300", deductions: "-$960", net: "$6,240", status: "Processing" },
  { name: "Ken Osei", role: "Backend Engineer", avatar: "KO", avatarBg: g5, base: "$7,100", bonus: "$250", deductions: "-$990", net: "$6,360", status: "Paid" },
  { name: "Hannah Lindqvist", role: "Customer Success Lead", avatar: "HL", avatarBg: g6, base: "$6,600", bonus: "$350", deductions: "-$910", net: "$6,040", status: "Paid" },
  { name: "Owen Fischer", role: "Finance Analyst", avatar: "OF", avatarBg: g1, base: "$6,200", bonus: "$150", deductions: "-$860", net: "$5,490", status: "Processing" },
];

export interface Department {
  name: string;
  head: string;
  emoji: string;
  tint: string;
  tintBg: string;
  members: { av: string; bg: string }[];
  more: number;
  count: number;
  open: number;
  retention: string;
}

export const hrDepts: Department[] = [
  { name: "Engineering", head: "Dana Keller", emoji: "💻", tint: "var(--acc)", tintBg: "var(--acc-soft)", members: [{ av: "DS", bg: g1 }, { av: "KO", bg: g5 }, { av: "AC", bg: g2 }, { av: "MJ", bg: g4 }], more: 34, count: 38, open: 4, retention: "96%" },
  { name: "Sales", head: "Karen Wu", emoji: "📈", tint: "var(--ok)", tintBg: "var(--ok-soft)", members: [{ av: "MB", bg: g3 }, { av: "TL", bg: g6 }, { av: "RS", bg: g1 }, { av: "NP", bg: g5 }], more: 22, count: 26, open: 3, retention: "91%" },
  { name: "Design", head: "Elena Cross", emoji: "🎨", tint: "var(--info)", tintBg: "var(--info-soft)", members: [{ av: "PN", bg: g2 }, { av: "JL", bg: g4 }, { av: "CW", bg: g6 }], more: 9, count: 12, open: 1, retention: "98%" },
  { name: "Marketing", head: "Karen Wu", emoji: "📣", tint: "var(--warn)", tintBg: "var(--warn-soft)", members: [{ av: "SR", bg: g4 }, { av: "BT", bg: g3 }, { av: "IK", bg: g1 }], more: 6, count: 9, open: 2, retention: "89%" },
  { name: "Customer Success", head: "Elena Cross", emoji: "🤝", tint: "var(--acc-2)", tintBg: "var(--acc-soft)", members: [{ av: "HL", bg: g6 }, { av: "QF", bg: g2 }, { av: "WB", bg: g5 }], more: 12, count: 15, open: 1, retention: "93%" },
  { name: "Finance", head: "Karen Wu", emoji: "💰", tint: "var(--ok)", tintBg: "var(--ok-soft)", members: [{ av: "OF", bg: g1 }, { av: "LM", bg: g3 }], more: 7, count: 9, open: 1, retention: "95%" },
];

export interface RecruitCard {
  name: string;
  role: string;
  avatar: string;
  avatarBg: string;
  rating: string;
  time: string;
}

export interface RecruitColumn {
  stage: string;
  color: string;
  cards: RecruitCard[];
}

export const recruitCols: RecruitColumn[] = [
  {
    stage: "Applied",
    color: "var(--t2)",
    cards: [
      { name: "Liam Foster", role: "Frontend Engineer", avatar: "LF", avatarBg: g1, rating: "New", time: "2h ago" },
      { name: "Zara Khan", role: "Product Manager", avatar: "ZK", avatarBg: g4, rating: "New", time: "5h ago" },
    ],
  },
  {
    stage: "Screening",
    color: "var(--info)",
    cards: [
      { name: "Noah Weiss", role: "Backend Engineer", avatar: "NW", avatarBg: g5, rating: "4.2", time: "1d ago" },
      { name: "Mia Torres", role: "UX Researcher", avatar: "MT", avatarBg: g2, rating: "4.5", time: "1d ago" },
    ],
  },
  {
    stage: "Interview",
    color: "var(--acc)",
    cards: [
      { name: "Ethan Cole", role: "DevOps Engineer", avatar: "EC", avatarBg: g6, rating: "4.7", time: "2d ago" },
      { name: "Grace Lin", role: "Data Analyst", avatar: "GL", avatarBg: g3, rating: "4.3", time: "3d ago" },
    ],
  },
  {
    stage: "Offer",
    color: "var(--warn)",
    cards: [{ name: "Jonas Park", role: "Sales Executive", avatar: "JP", avatarBg: g1, rating: "4.8", time: "4d ago" }],
  },
  {
    stage: "Hired",
    color: "var(--ok)",
    cards: [{ name: "Ivy Nakamura", role: "Product Designer", avatar: "IN", avatarBg: g2, rating: "4.9", time: "1w ago" }],
  },
];

export interface JobApplication {
  name: string;
  email: string;
  avatar: string;
  avatarBg: string;
  position: string;
  exp: string;
  rating: number;
  stage: string;
  applied: string;
}

export const jobApplications: JobApplication[] = [
  { name: "Liam Foster", email: "liam.foster@mail.com", avatar: "LF", avatarBg: g1, position: "Frontend Engineer", exp: "4 yrs", rating: 4, stage: "Applied", applied: "2h ago" },
  { name: "Zara Khan", email: "zara.khan@mail.com", avatar: "ZK", avatarBg: g4, position: "Product Manager", exp: "6 yrs", rating: 5, stage: "Applied", applied: "5h ago" },
  { name: "Noah Weiss", email: "noah.weiss@mail.com", avatar: "NW", avatarBg: g5, position: "Backend Engineer", exp: "3 yrs", rating: 4, stage: "Screening", applied: "1d ago" },
  { name: "Mia Torres", email: "mia.torres@mail.com", avatar: "MT", avatarBg: g2, position: "UX Researcher", exp: "5 yrs", rating: 5, stage: "Screening", applied: "1d ago" },
  { name: "Ethan Cole", email: "ethan.cole@mail.com", avatar: "EC", avatarBg: g6, position: "DevOps Engineer", exp: "7 yrs", rating: 5, stage: "Interview", applied: "2d ago" },
  { name: "Grace Lin", email: "grace.lin@mail.com", avatar: "GL", avatarBg: g3, position: "Data Analyst", exp: "2 yrs", rating: 4, stage: "Interview", applied: "3d ago" },
  { name: "Jonas Park", email: "jonas.park@mail.com", avatar: "JP", avatarBg: g1, position: "Sales Executive", exp: "5 yrs", rating: 5, stage: "Offer", applied: "4d ago" },
  { name: "Ivy Nakamura", email: "ivy.nakamura@mail.com", avatar: "IN", avatarBg: g2, position: "Product Designer", exp: "6 yrs", rating: 5, stage: "Hired", applied: "1w ago" },
];
