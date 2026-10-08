// Mock data fixtures for the Apps domain (Chat, Contacts, File Manager, Notes,
// Task Manager, Help Desk, Group Chat, Support Tickets, Email, Calendar).
// Colors are referenced only as Tailwind design-system utility classes
// (bg-acc, text-ok, etc)  -  never raw hex. Avatars derive their color/initials
// from `name` via the shared <Avatar> component, so records just carry names.

/** Small fixed cycle of design-token classes for legend dots / label chips
 * that aren't backed by a status word (so `statusVariant` doesn't apply). */
export const swatchCycle = [
  { dot: "bg-acc", text: "text-acc", bg: "bg-acc-soft" },
  { dot: "bg-ok", text: "text-ok", bg: "bg-ok-soft" },
  { dot: "bg-warn", text: "text-warn", bg: "bg-warn-soft" },
  { dot: "bg-info", text: "text-info", bg: "bg-info-soft" },
  { dot: "bg-bad", text: "text-bad", bg: "bg-bad-soft" },
];

export function swatch(i: number) {
  return swatchCycle[i % swatchCycle.length];
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatConversation {
  id: string;
  name: string;
  role: string;
  last: string;
  time: string;
  unread?: number;
  online?: boolean;
}

export const chatConversations: ChatConversation[] = [
  { id: "c1", name: "Elena Park", role: "Product Designer", last: "Sounds good, I'll update the mocks today.", time: "2m", unread: 2, online: true },
  { id: "c2", name: "Marcus Chen", role: "Engineering Lead", last: "Deploy is live on staging 🚀", time: "18m", online: true },
  { id: "c3", name: "Sofia Reyes", role: "Growth Marketing", last: "Can we push the campaign to Friday?", time: "1h", unread: 1 },
  { id: "c4", name: "Dana Keller", role: "Head of Product", last: "Great work on the Q3 doc!", time: "3h" },
  { id: "c5", name: "James Wu", role: "Customer Success", last: "Client escalation resolved.", time: "5h", online: true },
  { id: "c6", name: "Priya Nair", role: "Data Analyst", last: "Sent over the churn numbers.", time: "Yesterday" },
  { id: "c7", name: "Liam O'Brien", role: "Sales", last: "Demo booked for Thursday 10am.", time: "Yesterday" },
  { id: "c8", name: "Aisha Rahman", role: "QA Engineer", last: "Found a regression on checkout.", time: "2d" },
];

export interface ChatMessage {
  id: string;
  mine?: boolean;
  name: string;
  text: string;
  time: string;
}

export const chatThreads: Record<string, ChatMessage[]> = {
  c1: [
    { id: "m1", name: "Elena Park", text: "Hey! Do you have a sec to review the new onboarding flow?", time: "09:12" },
    { id: "m2", mine: true, name: "You", text: "Yep, pulling it up now.", time: "09:13" },
    { id: "m3", name: "Elena Park", text: "The main change is collapsing steps 3 and 4 into one screen.", time: "09:14" },
    { id: "m4", mine: true, name: "You", text: "That's a nice simplification, love it.", time: "09:20" },
    { id: "m5", name: "Elena Park", text: "Sounds good, I'll update the mocks today.", time: "09:21" },
  ],
  c2: [
    { id: "m1", name: "Marcus Chen", text: "Deploy is live on staging 🚀", time: "08:40" },
    { id: "m2", mine: true, name: "You", text: "Awesome, I'll run through the smoke tests.", time: "08:44" },
  ],
};

export const chatFiles = [
  { id: "f1", name: "onboarding-flow-v3.fig", size: "4.2 MB", type: "figma" },
  { id: "f2", name: "Q3-roadmap.pdf", size: "1.1 MB", type: "pdf" },
  { id: "f3", name: "user-research.docx", size: "820 KB", type: "doc" },
];

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export interface Contact {
  id: string;
  name: string;
  role: string;
  department: "Sales" | "Engineering" | "Design" | "Marketing" | "Support";
  company: string;
  email: string;
  phone: string;
  location: string;
  online?: boolean;
  tags: string[];
  stats: { label: string; value: string }[];
  deals: { id: string; name: string; value: string; stage: string; date: string }[];
  timeline: { id: string; text: string; time: string }[];
}

export const contacts: Contact[] = [
  {
    id: "elena-park",
    name: "Elena Park",
    role: "Product Designer",
    department: "Design",
    company: "Stripe",
    email: "elena@stripe.com",
    phone: "+1 (415) 555-0142",
    location: "San Francisco, CA",
    online: true,
    tags: ["VIP", "Enterprise", "Design Partner"],
    stats: [
      { label: "Deals won", value: "6" },
      { label: "Total value", value: "$184K" },
      { label: "Open tickets", value: "2" },
      { label: "Last contact", value: "2d ago" },
    ],
    deals: [
      { id: "d1", name: "Enterprise renewal", value: "$48,000", stage: "Negotiation", date: "Jul 2" },
      { id: "d2", name: "Design system add-on", value: "$12,000", stage: "Won", date: "Jun 18" },
      { id: "d3", name: "Seat expansion", value: "$9,600", stage: "Won", date: "May 30" },
    ],
    timeline: [
      { id: "t1", text: "Opened ticket #TKT-1084 · Cannot export reports to PDF", time: "2d ago" },
      { id: "t2", text: "Attended Q3 roadmap review call", time: "5d ago" },
      { id: "t3", text: "Signed enterprise renewal contract", time: "1w ago" },
      { id: "t4", text: "Requested seat expansion for design team", time: "2w ago" },
      { id: "t5", text: "Joined as customer", time: "1y ago" },
    ],
  },
  {
    id: "marcus-chen",
    name: "Marcus Chen",
    role: "Engineering Lead",
    department: "Engineering",
    company: "Vercel",
    email: "marcus@vercel.com",
    phone: "+1 (628) 555-0198",
    location: "Austin, TX",
    online: true,
    tags: ["Technical", "Beta tester"],
    stats: [
      { label: "Deals won", value: "3" },
      { label: "Total value", value: "$96K" },
      { label: "Open tickets", value: "0" },
      { label: "Last contact", value: "1d ago" },
    ],
    deals: [
      { id: "d1", name: "API platform upgrade", value: "$32,000", stage: "Won", date: "Jun 22" },
      { id: "d2", name: "Webhooks add-on", value: "$6,400", stage: "Proposal", date: "Jun 10" },
    ],
    timeline: [
      { id: "t1", text: "Deployed integration to production", time: "1d ago" },
      { id: "t2", text: "Joined beta program for new API", time: "1w ago" },
    ],
  },
  {
    id: "sofia-reyes",
    name: "Sofia Reyes",
    role: "Growth Marketing",
    department: "Marketing",
    company: "Notion",
    email: "sofia@notion.so",
    phone: "+1 (212) 555-0177",
    location: "New York, NY",
    tags: ["Marketing", "Champion"],
    stats: [
      { label: "Deals won", value: "4" },
      { label: "Total value", value: "$71K" },
      { label: "Open tickets", value: "1" },
      { label: "Last contact", value: "6h ago" },
    ],
    deals: [{ id: "d1", name: "Marketing suite bundle", value: "$21,000", stage: "Negotiation", date: "Jul 5" }],
    timeline: [{ id: "t1", text: "Requested campaign launch delay to Friday", time: "6h ago" }],
  },
  {
    id: "dana-keller",
    name: "Dana Keller",
    role: "Head of Product",
    department: "Design",
    company: "Linear",
    email: "dana@linear.app",
    phone: "+1 (206) 555-0113",
    location: "Seattle, WA",
    online: true,
    tags: ["Executive", "Enterprise"],
    stats: [
      { label: "Deals won", value: "8" },
      { label: "Total value", value: "$212K" },
      { label: "Open tickets", value: "0" },
      { label: "Last contact", value: "3h ago" },
    ],
    deals: [{ id: "d1", name: "Platform enterprise plan", value: "$64,000", stage: "Won", date: "Jun 1" }],
    timeline: [{ id: "t1", text: "Praised Q3 strategy doc", time: "3h ago" }],
  },
  {
    id: "james-wu",
    name: "James Wu",
    role: "Customer Success",
    department: "Support",
    company: "Figma",
    email: "james@figma.com",
    phone: "+1 (312) 555-0164",
    location: "Chicago, IL",
    online: true,
    tags: ["Internal"],
    stats: [
      { label: "Deals won", value: "1" },
      { label: "Total value", value: "$14K" },
      { label: "Open tickets", value: "3" },
      { label: "Last contact", value: "5h ago" },
    ],
    deals: [{ id: "d1", name: "Support tier upgrade", value: "$14,000", stage: "Won", date: "May 12" }],
    timeline: [{ id: "t1", text: "Resolved client escalation", time: "5h ago" }],
  },
  {
    id: "priya-nair",
    name: "Priya Nair",
    role: "Data Analyst",
    department: "Engineering",
    company: "Amplitude",
    email: "priya@amplitude.com",
    phone: "+1 (650) 555-0129",
    location: "Palo Alto, CA",
    tags: ["Data", "Beta tester"],
    stats: [
      { label: "Deals won", value: "2" },
      { label: "Total value", value: "$38K" },
      { label: "Open tickets", value: "0" },
      { label: "Last contact", value: "1d ago" },
    ],
    deals: [{ id: "d1", name: "Analytics add-on", value: "$18,000", stage: "Won", date: "Jun 8" }],
    timeline: [{ id: "t1", text: "Shared churn analysis report", time: "1d ago" }],
  },
  {
    id: "liam-obrien",
    name: "Liam O'Brien",
    role: "Sales Director",
    department: "Sales",
    company: "HubSpot",
    email: "liam@hubspot.com",
    phone: "+1 (617) 555-0155",
    location: "Boston, MA",
    tags: ["Sales", "VIP"],
    stats: [
      { label: "Deals won", value: "11" },
      { label: "Total value", value: "$298K" },
      { label: "Open tickets", value: "0" },
      { label: "Last contact", value: "2d ago" },
    ],
    deals: [{ id: "d1", name: "Regional expansion deal", value: "$85,000", stage: "Negotiation", date: "Jul 8" }],
    timeline: [{ id: "t1", text: "Booked demo for Thursday 10am", time: "2d ago" }],
  },
  {
    id: "aisha-rahman",
    name: "Aisha Rahman",
    role: "QA Engineer",
    department: "Engineering",
    company: "Shopify",
    email: "aisha@shopify.com",
    phone: "+1 (416) 555-0187",
    location: "Toronto, ON",
    online: true,
    tags: ["Technical"],
    stats: [
      { label: "Deals won", value: "0" },
      { label: "Total value", value: "$0" },
      { label: "Open tickets", value: "1" },
      { label: "Last contact", value: "2d ago" },
    ],
    deals: [],
    timeline: [{ id: "t1", text: "Reported checkout regression", time: "2d ago" }],
  },
  {
    id: "noah-baptiste",
    name: "Noah Baptiste",
    role: "VP Marketing",
    department: "Marketing",
    company: "Webflow",
    email: "noah@webflow.com",
    phone: "+1 (720) 555-0121",
    location: "Denver, CO",
    tags: ["Executive", "Champion"],
    stats: [
      { label: "Deals won", value: "5" },
      { label: "Total value", value: "$142K" },
      { label: "Open tickets", value: "0" },
      { label: "Last contact", value: "4d ago" },
    ],
    deals: [{ id: "d1", name: "Brand partnership", value: "$40,000", stage: "Won", date: "Jun 14" }],
    timeline: [{ id: "t1", text: "Renewed annual contract", time: "4d ago" }],
  },
  {
    id: "chloe-martin",
    name: "Chloe Martin",
    role: "Account Executive",
    department: "Sales",
    company: "Zendesk",
    email: "chloe@zendesk.com",
    phone: "+1 (415) 555-0134",
    location: "San Francisco, CA",
    tags: ["Sales"],
    stats: [
      { label: "Deals won", value: "7" },
      { label: "Total value", value: "$156K" },
      { label: "Open tickets", value: "0" },
      { label: "Last contact", value: "8h ago" },
    ],
    deals: [{ id: "d1", name: "New logo acquisition", value: "$29,000", stage: "Proposal", date: "Jul 3" }],
    timeline: [{ id: "t1", text: "Sent proposal for new logo deal", time: "8h ago" }],
  },
  {
    id: "ethan-clarke",
    name: "Ethan Clarke",
    role: "Support Lead",
    department: "Support",
    company: "Intercom",
    email: "ethan@intercom.com",
    phone: "+1 (628) 555-0146",
    location: "Los Angeles, CA",
    online: true,
    tags: ["Internal", "VIP"],
    stats: [
      { label: "Deals won", value: "0" },
      { label: "Total value", value: "$0" },
      { label: "Open tickets", value: "5" },
      { label: "Last contact", value: "1h ago" },
    ],
    deals: [],
    timeline: [{ id: "t1", text: "Escalated 2 tickets to engineering", time: "1h ago" }],
  },
  {
    id: "maya-goldberg",
    name: "Maya Goldberg",
    role: "UX Researcher",
    department: "Design",
    company: "Airbnb",
    email: "maya@airbnb.com",
    phone: "+1 (415) 555-0192",
    location: "San Francisco, CA",
    tags: ["Design Partner"],
    stats: [
      { label: "Deals won", value: "1" },
      { label: "Total value", value: "$11K" },
      { label: "Open tickets", value: "0" },
      { label: "Last contact", value: "3d ago" },
    ],
    deals: [{ id: "d1", name: "Research tools license", value: "$11,000", stage: "Won", date: "May 28" }],
    timeline: [{ id: "t1", text: "Completed onboarding session", time: "3d ago" }],
  },
];

// ---------------------------------------------------------------------------
// File Manager
// ---------------------------------------------------------------------------

export const fileStorageTypes = [
  { name: "Documents", size: "5.2 GB", swatch: 0 },
  { name: "Images", size: "3.6 GB", swatch: 1 },
  { name: "Videos", size: "2.8 GB", swatch: 2 },
  { name: "Other", size: "0.8 GB", swatch: 3 },
];

export const fileQuickAccess = [
  { id: "q1", name: "Design assets", count: "128 files", type: "image" },
  { id: "q2", name: "Contracts", count: "34 files", type: "pdf" },
  { id: "q3", name: "Team recordings", count: "16 files", type: "video" },
  { id: "q4", name: "Spreadsheets", count: "52 files", type: "sheet" },
];

export interface FileRecord {
  id: string;
  name: string;
  type: string;
  fileType: "doc" | "pdf" | "image" | "video" | "sheet" | "archive" | "code";
  owner: string;
  modified: string;
  size: string;
}

export const files: FileRecord[] = [
  { id: "fl1", name: "onboarding-flow-v3.fig", type: "Figma file", fileType: "image", owner: "Elena Park", modified: "2h ago", size: "4.2 MB" },
  { id: "fl2", name: "Q3-roadmap.pdf", type: "PDF document", fileType: "pdf", owner: "Dana Keller", modified: "5h ago", size: "1.1 MB" },
  { id: "fl3", name: "user-research.docx", type: "Word document", fileType: "doc", owner: "Maya Goldberg", modified: "1d ago", size: "820 KB" },
  { id: "fl4", name: "revenue-model.xlsx", type: "Spreadsheet", fileType: "sheet", owner: "Priya Nair", modified: "1d ago", size: "2.4 MB" },
  { id: "fl5", name: "brand-assets.zip", type: "Archive", fileType: "archive", owner: "Sofia Reyes", modified: "2d ago", size: "18.6 MB" },
  { id: "fl6", name: "api-client.ts", type: "Code file", fileType: "code", owner: "Marcus Chen", modified: "2d ago", size: "12 KB" },
  { id: "fl7", name: "team-standup.mp4", type: "Video recording", fileType: "video", owner: "James Wu", modified: "3d ago", size: "240 MB" },
  { id: "fl8", name: "pricing-page.png", type: "Image", fileType: "image", owner: "Elena Park", modified: "4d ago", size: "1.8 MB" },
  { id: "fl9", name: "customer-interview-notes.docx", type: "Word document", fileType: "doc", owner: "Maya Goldberg", modified: "5d ago", size: "410 KB" },
  { id: "fl10", name: "security-audit.pdf", type: "PDF document", fileType: "pdf", owner: "Aisha Rahman", modified: "1w ago", size: "3.1 MB" },
];

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface Note {
  id: string;
  title: string;
  preview: string;
  time: string;
  tag?: string;
  content: {
    intro: string;
    themes: string[];
    metrics: { label: string; change: string }[];
    footer: string;
  };
}

export const noteTags = ["Product", "Meetings", "Personal", "Ideas", "Roadmap"];

export const notes: Note[] = [
  {
    id: "n1",
    title: "Q3 Product Strategy",
    preview: "This document outlines our product strategy for Q3 2026…",
    time: "2h ago",
    tag: "Roadmap",
    content: {
      intro: "This document outlines our product strategy for Q3 2026 — key themes, OKRs, and execution priorities across the platform.",
      themes: [
        "Accelerate enterprise onboarding → reduce time-to-value from 14 days to 5.",
        "Launch AI-powered anomaly detection in the Analytics module.",
        "Improve mobile experience to reach 60% session parity with desktop.",
      ],
      metrics: [
        { label: "NPS score", change: "72 → 80" },
        { label: "Churn rate", change: "2.4% → <1.8%" },
        { label: "Feature adoption", change: "44% → 65%" },
      ],
      footer: "Last edited by Dana Keller · Jun 27 at 14:32",
    },
  },
  {
    id: "n2",
    title: "Weekly sync notes",
    preview: "Engineering velocity is up 12% this sprint…",
    time: "5h ago",
    tag: "Meetings",
    content: {
      intro: "Engineering velocity is up 12% this sprint. Design handoffs are the current bottleneck for the checkout revamp.",
      themes: [
        "Ship checkout revamp behind a feature flag by end of week.",
        "Pair QA with engineering earlier in the sprint to reduce regressions.",
      ],
      metrics: [
        { label: "Sprint velocity", change: "34 → 38 pts" },
        { label: "Open bugs", change: "21 → 14" },
      ],
      footer: "Last edited by Marcus Chen · Jun 25 at 10:05",
    },
  },
  {
    id: "n3",
    title: "Onboarding flow ideas",
    preview: "Collapse steps 3 and 4 into a single screen…",
    time: "1d ago",
    tag: "Ideas",
    content: {
      intro: "Collapse steps 3 and 4 into a single screen to cut onboarding time. Add contextual tooltips for first-time users.",
      themes: ["Progressive disclosure for advanced settings.", "Celebrate first successful action with a small animation."],
      metrics: [{ label: "Completion rate", change: "58% → est. 74%" }],
      footer: "Last edited by Elena Park · Jun 24 at 16:48",
    },
  },
  {
    id: "n4",
    title: "Customer interview: Notion",
    preview: "Sofia flagged that campaign scheduling needs more flexibility…",
    time: "2d ago",
    tag: "Product",
    content: {
      intro: "Sofia flagged that campaign scheduling needs more flexibility — specifically the ability to set recurring sends.",
      themes: ["Recurring campaign scheduling.", "Bulk edit for audience segments."],
      metrics: [{ label: "Feature requests logged", change: "3" }],
      footer: "Last edited by Sofia Reyes · Jun 23 at 09:30",
    },
  },
  {
    id: "n5",
    title: "Personal: conference talk outline",
    preview: "Intro, three case studies, closing with Q&A…",
    time: "3d ago",
    tag: "Personal",
    content: {
      intro: "Outline for the upcoming conference talk: intro, three case studies, closing with Q&A.",
      themes: ["Case study: onboarding redesign.", "Case study: analytics module launch.", "Case study: mobile parity project."],
      metrics: [],
      footer: "Last edited by you · Jun 21 at 20:12",
    },
  },
  {
    id: "n6",
    title: "Hiring plan H2",
    preview: "Two senior engineers, one product designer…",
    time: "5d ago",
    tag: "Roadmap",
    content: {
      intro: "H2 hiring plan: two senior engineers, one product designer, one support lead.",
      themes: ["Prioritize backend hires for the analytics rewrite.", "Design hire to support the mobile parity project."],
      metrics: [{ label: "Open reqs", change: "4" }],
      footer: "Last edited by Dana Keller · Jun 19 at 11:00",
    },
  },
];

// ---------------------------------------------------------------------------
// Task Manager
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  title: string;
  project: string;
  priority: "High" | "Medium" | "Low";
  assignee: string;
  due: string;
  done?: boolean;
  group: "overdue" | "today" | "upcoming";
  urgent?: boolean;
}

export const tasks: Task[] = [
  { id: "tk1", title: "Fix checkout regression on Safari", project: "Platform", priority: "High", assignee: "Aisha Rahman", due: "2 days overdue", group: "overdue" },
  { id: "tk2", title: "Respond to enterprise security questionnaire", project: "Sales", priority: "High", assignee: "Chloe Martin", due: "1 day overdue", group: "overdue" },
  { id: "tk3", title: "Finalize Q3 OKR doc", project: "Product", priority: "Medium", assignee: "Dana Keller", due: "3 days overdue", group: "overdue" },
  { id: "tk4", title: "Review onboarding flow mocks", project: "Design", priority: "High", assignee: "Elena Park", due: "Due today, 2pm", group: "today" },
  { id: "tk5", title: "Deploy analytics module to staging", project: "Engineering", priority: "Medium", assignee: "Marcus Chen", due: "Due today, 5pm", group: "today", done: true },
  { id: "tk6", title: "Prepare demo for HubSpot call", project: "Sales", priority: "High", assignee: "Liam O'Brien", due: "Due today, 10am", group: "today", done: true },
  { id: "tk7", title: "Write release notes for v2.4", project: "Product", priority: "Low", assignee: "Dana Keller", due: "Due today", group: "today" },
  { id: "tk8", title: "Audit third-party dependencies", project: "Engineering", priority: "Medium", assignee: "Aisha Rahman", due: "Due today", group: "today" },
  { id: "tk9", title: "Sync with Notion on campaign timeline", project: "Marketing", priority: "Low", assignee: "Sofia Reyes", due: "Due today", group: "today", done: true },
  { id: "tk10", title: "Plan H2 hiring roadmap", project: "People", priority: "Medium", assignee: "Dana Keller", due: "Tomorrow", group: "upcoming" },
  { id: "tk11", title: "Customer interview: Amplitude", project: "Research", priority: "Low", assignee: "Maya Goldberg", due: "In 2 days", group: "upcoming" },
  { id: "tk12", title: "Renew annual contract with Webflow", project: "Sales", priority: "High", assignee: "Chloe Martin", due: "In 3 days", group: "upcoming", urgent: true },
  { id: "tk13", title: "Ship mobile parity improvements", project: "Engineering", priority: "Medium", assignee: "Marcus Chen", due: "In 5 days", group: "upcoming" },
];

export const taskLabels = [
  { name: "Bug", count: 4 },
  { name: "Feature", count: 7 },
  { name: "Design", count: 5 },
  { name: "Sales", count: 3 },
  { name: "Urgent", count: 2 },
  { name: "Docs", count: 3 },
];

// ---------------------------------------------------------------------------
// Help Desk / Support Tickets
// ---------------------------------------------------------------------------

export interface ThreadMessage {
  id: string;
  name: string;
  agent?: boolean;
  text: string;
  time: string;
  attachment?: string;
}

export interface Ticket {
  id: string;
  title: string;
  category: string;
  requester: string;
  requesterEmail: string;
  plan: string;
  priority: "High" | "Medium" | "Low";
  status: "Open" | "Pending" | "Resolved" | "Closed";
  assigned: string;
  sla: string;
  slaUrgent?: boolean;
  breached?: boolean;
  created: string;
  thread: ThreadMessage[];
  activity: { time: string; text: string }[];
}

export const tickets: Ticket[] = [
  {
    id: "TKT-1084",
    title: "Cannot export reports to PDF",
    category: "Bug",
    requester: "Elena Park",
    requesterEmail: "elena@stripe.com",
    plan: "Enterprise",
    priority: "High",
    status: "Open",
    assigned: "Ethan Clarke",
    sla: "1h 20m remaining",
    slaUrgent: true,
    created: "Jun 27, 2026 at 09:14",
    thread: [
      { id: "m1", name: "Elena Park", text: "When I try to export the monthly report to PDF, the download just spins forever and never completes. Tried on both Chrome and Safari.", time: "09:14" },
      { id: "m2", name: "Ethan Clarke", agent: true, text: "Thanks for the report, Elena. Can you tell me roughly how large the report is (date range / number of rows)? We've seen this on very large exports.", time: "09:42" },
      { id: "m3", name: "Elena Park", text: "It's the full Q2 report, about 40k rows. Attached a screenshot of the spinner.", time: "10:05", attachment: "export-spinner.png" },
    ],
    activity: [
      { time: "09:14", text: "Ticket opened by Elena Park" },
      { time: "09:20", text: "Auto-assigned to Ethan Clarke" },
      { time: "09:42", text: "Ethan Clarke replied" },
      { time: "10:05", text: "Elena Park added an attachment" },
    ],
  },
  {
    id: "TKT-1083",
    title: "Unable to invite teammates",
    category: "Bug",
    requester: "Marcus Chen",
    requesterEmail: "marcus@vercel.com",
    plan: "Business",
    priority: "High",
    status: "Open",
    assigned: "James Wu",
    sla: "3h 10m remaining",
    created: "Jun 26, 2026 at 15:40",
    thread: [
      { id: "m1", name: "Marcus Chen", text: "Invites are failing silently — no error, no email sent to the invitee.", time: "15:40" },
      { id: "m2", name: "James Wu", agent: true, text: "Looking into it now, thanks for flagging.", time: "16:02" },
    ],
    activity: [
      { time: "15:40", text: "Ticket opened by Marcus Chen" },
      { time: "16:02", text: "James Wu replied" },
    ],
  },
  {
    id: "TKT-1082",
    title: "Feature request: recurring campaign scheduling",
    category: "Feature",
    requester: "Sofia Reyes",
    requesterEmail: "sofia@notion.so",
    plan: "Business",
    priority: "Low",
    status: "Pending",
    assigned: "Ethan Clarke",
    sla: "1d 4h remaining",
    created: "Jun 25, 2026 at 11:02",
    thread: [{ id: "m1", name: "Sofia Reyes", text: "Would love the ability to set recurring sends for campaigns instead of scheduling one-offs.", time: "11:02" }],
    activity: [{ time: "11:02", text: "Ticket opened by Sofia Reyes" }],
  },
  {
    id: "TKT-1081",
    title: "Billing address not updating",
    category: "Billing",
    requester: "Liam O'Brien",
    requesterEmail: "liam@hubspot.com",
    plan: "Enterprise",
    priority: "Medium",
    status: "Resolved",
    assigned: "James Wu",
    sla: "Closed on time",
    created: "Jun 24, 2026 at 08:20",
    thread: [
      { id: "m1", name: "Liam O'Brien", text: "Updated billing address isn't reflected on the latest invoice.", time: "08:20" },
      { id: "m2", name: "James Wu", agent: true, text: "Fixed — the change now takes effect on the next billing cycle. Confirmed with finance.", time: "13:10" },
    ],
    activity: [
      { time: "08:20", text: "Ticket opened by Liam O'Brien" },
      { time: "13:10", text: "James Wu resolved the ticket" },
    ],
  },
  {
    id: "TKT-1080",
    title: "API rate limit too aggressive",
    category: "Bug",
    requester: "Priya Nair",
    requesterEmail: "priya@amplitude.com",
    plan: "Enterprise",
    priority: "Medium",
    status: "Open",
    assigned: "Ethan Clarke",
    sla: "6h 45m remaining",
    created: "Jun 24, 2026 at 14:55",
    thread: [{ id: "m1", name: "Priya Nair", text: "We're hitting 429s well below our documented quota. Can you check our account limits?", time: "14:55" }],
    activity: [{ time: "14:55", text: "Ticket opened by Priya Nair" }],
  },
  {
    id: "TKT-1079",
    title: "Checkout fails for EU customers",
    category: "Bug",
    requester: "Aisha Rahman",
    requesterEmail: "aisha@shopify.com",
    plan: "Business",
    priority: "High",
    status: "Open",
    assigned: "Ethan Clarke",
    sla: "SLA breached",
    breached: true,
    created: "Jun 23, 2026 at 09:00",
    thread: [
      { id: "m1", name: "Aisha Rahman", text: "Multiple EU customers report checkout hanging on the payment confirmation step.", time: "09:00" },
      { id: "m2", name: "Ethan Clarke", agent: true, text: "Escalating to engineering now — this looks region-specific.", time: "09:30" },
    ],
    activity: [
      { time: "09:00", text: "Ticket opened by Aisha Rahman" },
      { time: "09:30", text: "Escalated to engineering" },
    ],
  },
  {
    id: "TKT-1078",
    title: "Dark mode contrast issues",
    category: "Bug",
    requester: "Noah Baptiste",
    requesterEmail: "noah@webflow.com",
    plan: "Business",
    priority: "Low",
    status: "Closed",
    assigned: "James Wu",
    sla: "Closed on time",
    created: "Jun 20, 2026 at 10:15",
    thread: [{ id: "m1", name: "Noah Baptiste", text: "Some badge text is hard to read in dark mode.", time: "10:15" }],
    activity: [
      { time: "10:15", text: "Ticket opened by Noah Baptiste" },
      { time: "16:00", text: "James Wu closed the ticket" },
    ],
  },
  {
    id: "TKT-1077",
    title: "Request: bulk export contacts to CSV",
    category: "Feature",
    requester: "Chloe Martin",
    requesterEmail: "chloe@zendesk.com",
    plan: "Enterprise",
    priority: "Medium",
    status: "Pending",
    assigned: "James Wu",
    sla: "2d remaining",
    created: "Jun 19, 2026 at 13:00",
    thread: [{ id: "m1", name: "Chloe Martin", text: "Need a way to export the full contacts list to CSV for our BI tooling.", time: "13:00" }],
    activity: [{ time: "13:00", text: "Ticket opened by Chloe Martin" }],
  },
  {
    id: "TKT-1076",
    title: "Two-factor auth codes not arriving",
    category: "Bug",
    requester: "Maya Goldberg",
    requesterEmail: "maya@airbnb.com",
    plan: "Business",
    priority: "High",
    status: "Open",
    assigned: "Ethan Clarke",
    sla: "SLA breached",
    breached: true,
    created: "Jun 18, 2026 at 08:45",
    thread: [{ id: "m1", name: "Maya Goldberg", text: "SMS codes for 2FA are taking 10+ minutes to arrive, locking us out.", time: "08:45" }],
    activity: [{ time: "08:45", text: "Ticket opened by Maya Goldberg" }],
  },
  {
    id: "TKT-1075",
    title: "Slack integration duplicate notifications",
    category: "Bug",
    requester: "James Wu",
    requesterEmail: "james@figma.com",
    plan: "Enterprise",
    priority: "Low",
    status: "Resolved",
    assigned: "James Wu",
    sla: "Closed on time",
    created: "Jun 17, 2026 at 09:30",
    thread: [{ id: "m1", name: "James Wu", text: "Every alert is posting twice to our #alerts channel.", time: "09:30" }],
    activity: [
      { time: "09:30", text: "Ticket opened by James Wu" },
      { time: "12:00", text: "Fixed duplicate webhook subscription" },
    ],
  },
];

export const hdKpis = [
  { label: "Open tickets", value: "18" },
  { label: "Avg. response time", value: "38m" },
  { label: "SLA breached", value: "2" },
  { label: "Resolved today", value: "9" },
];

export const hdStatusTabs = ["All", "Open", "Pending", "Resolved", "Closed"];

// ---------------------------------------------------------------------------
// Group Chat
// ---------------------------------------------------------------------------

export interface GroupChannel {
  id: string;
  name: string;
  unread?: number;
  active?: boolean;
  members: number;
  topic: string;
}

export const groupChannels: GroupChannel[] = [
  { id: "gc1", name: "engineering", unread: 3, active: true, members: 12, topic: "Build fast, ship faster" },
  { id: "gc2", name: "design", members: 8, topic: "All things pixels" },
  { id: "gc3", name: "general", unread: 1, members: 34, topic: "Company-wide announcements" },
  { id: "gc4", name: "product", members: 10, topic: "Roadmap and planning" },
  { id: "gc5", name: "random", members: 22, topic: "Off-topic chat" },
  { id: "gc6", name: "customer-success", unread: 5, members: 6, topic: "Escalations and feedback" },
];

export interface GroupMessage {
  id: string;
  name: string;
  text: string;
  time: string;
  code?: string;
  reactions?: { emoji: string; count: number }[];
}

export const groupMessages: GroupMessage[] = [
  { id: "gm1", name: "Marcus Chen", text: "Deploy for the analytics module is live on staging, can someone smoke test the funnel view?", time: "09:02" },
  { id: "gm2", name: "Aisha Rahman", text: "On it — will report back in ~15 min.", time: "09:04", reactions: [{ emoji: "👍", count: 3 }] },
  { id: "gm3", name: "Marcus Chen", text: "Here's the diff for the rate limiter fix:", time: "09:20", code: "if (requests > limit) {\n  return res.status(429).json({ retryAfter });\n}" },
  { id: "gm4", name: "Aisha Rahman", text: "Smoke test passed. Funnel view loads correctly, no console errors.", time: "09:22", reactions: [{ emoji: "🎉", count: 5 }, { emoji: "🚀", count: 2 }] },
  { id: "gm5", name: "Dana Keller", text: "Nice work team, this unblocks the Q3 launch.", time: "09:30" },
];

export const groupMembers = [
  { id: "gm-1", name: "Marcus Chen", role: "Engineering Lead", online: true },
  { id: "gm-2", name: "Aisha Rahman", role: "QA Engineer", online: true },
  { id: "gm-3", name: "Dana Keller", role: "Head of Product", online: true },
  { id: "gm-4", name: "Elena Park", role: "Product Designer", online: true },
  { id: "gm-5", name: "Priya Nair", role: "Data Analyst" },
  { id: "gm-6", name: "James Wu", role: "Customer Success" },
  { id: "gm-7", name: "Sofia Reyes", role: "Growth Marketing" },
  { id: "gm-8", name: "Liam O'Brien", role: "Sales Director" },
];

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export const mailFolders = [
  { id: "inbox", name: "Inbox", count: 12 },
  { id: "starred", name: "Starred", count: 4 },
  { id: "sent", name: "Sent" },
  { id: "drafts", name: "Drafts", count: 2 },
  { id: "spam", name: "Spam" },
  { id: "trash", name: "Trash" },
];

export const mailLabels = [
  { name: "Work", swatch: 0 },
  { name: "Clients", swatch: 1 },
  { name: "Personal", swatch: 2 },
  { name: "Invoices", swatch: 3 },
];

export interface Email {
  id: string;
  name: string;
  subject: string;
  preview: string;
  time: string;
  unread?: boolean;
  starred?: boolean;
  tag?: string;
}

export const emails: Email[] = [
  { id: "e1", name: "Elena Park", subject: "Re: Onboarding flow review", preview: "Sounds good, I'll update the mocks today and share the Figma link by EOD.", time: "09:21", unread: true, starred: true, tag: "Work" },
  { id: "e2", name: "Stripe", subject: "Your invoice for June 2026 is ready", preview: "Your monthly invoice of $2,480.00 has been generated and charged to your card.", time: "08:15", tag: "Invoices" },
  { id: "e3", name: "Marcus Chen", subject: "Deploy notes for staging", preview: "Pushed the rate limiter fix and analytics module to staging, see changelog attached.", time: "Yesterday", unread: true, tag: "Work" },
  { id: "e4", name: "Sofia Reyes", subject: "Campaign launch — need your sign-off", preview: "Can we push the summer campaign to Friday? Waiting on final creative approval.", time: "Yesterday", starred: true, tag: "Clients" },
  { id: "e5", name: "Linear", subject: "Weekly digest: 14 issues closed", preview: "Your team closed 14 issues and opened 9 new ones this week across 3 projects.", time: "2 days ago" },
  { id: "e6", name: "Dana Keller", subject: "Great work on the Q3 strategy doc", preview: "Just read through it, really solid framing on the enterprise onboarding push.", time: "2 days ago", tag: "Work" },
  { id: "e7", name: "GitHub", subject: "[vela/dashboard] 3 new pull requests", preview: "3 new pull requests were opened in vela/dashboard that need your review.", time: "3 days ago" },
  { id: "e8", name: "Liam O'Brien", subject: "Demo confirmed for Thursday 10am", preview: "Looking forward to walking the HubSpot team through the new analytics module.", time: "3 days ago", starred: true, tag: "Clients" },
  { id: "e9", name: "Figma", subject: "James Wu commented on your file", preview: "\"Can we align the spacing here with the design tokens?\" on onboarding-flow-v3.", time: "4 days ago" },
  { id: "e10", name: "Priya Nair", subject: "Churn analysis — June numbers", preview: "Churn dropped to 2.1% this month, details and cohort breakdown attached.", time: "4 days ago", tag: "Work" },
];

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  day: number;
  title: string;
  swatch: number;
}

export const calendarEvents: CalendarEvent[] = [
  { day: 2, title: "Team standup", swatch: 0 },
  { day: 3, title: "Design review", swatch: 1 },
  { day: 5, title: "HubSpot demo", swatch: 3 },
  { day: 5, title: "1:1 w/ Dana", swatch: 0 },
  { day: 8, title: "Sprint planning", swatch: 2 },
  { day: 10, title: "Q3 strategy review", swatch: 0 },
  { day: 12, title: "Customer call: Stripe", swatch: 3 },
  { day: 15, title: "All-hands", swatch: 1 },
  { day: 15, title: "Release v2.4", swatch: 4 },
  { day: 18, title: "Design system sync", swatch: 1 },
  { day: 20, title: "Board meeting", swatch: 0 },
  { day: 22, title: "Onsite: Austin team", swatch: 2 },
  { day: 24, title: "Campaign launch", swatch: 3 },
  { day: 27, title: "Q3 OKR check-in", swatch: 0 },
  { day: 29, title: "Security audit review", swatch: 4 },
];
