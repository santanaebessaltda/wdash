/** Mock fixtures for the CRM domain pages. Plain typed data  -  status values
 * stay free text and are mapped to colors via statusVariant, pipeline stage
 * colors are passed explicitly as CSS-variable tokens. */

export interface CrmKpi {
  label: string;
  value: string;
  sub: string;
  icon: string;
  tint: string;
  positive: boolean;
  delta: string;
}

export const crmKpis: CrmKpi[] = [
  { label: "Pipeline value", value: "$1.24M", sub: "182 open deals", icon: "target", tint: "var(--acc)", positive: true, delta: "+14.2%" },
  { label: "New leads", value: "940", sub: "This quarter", icon: "users", tint: "var(--info)", positive: true, delta: "+8.6%" },
  { label: "Win rate", value: "60%", sub: "62 deals won", icon: "trendingUp", tint: "var(--ok)", positive: true, delta: "+5.1%" },
  { label: "Avg. deal size", value: "$6,820", sub: "Closed this quarter", icon: "dollar", tint: "var(--warn)", positive: false, delta: "−2.4%" },
];

export interface CrmStage {
  name: string;
  value: string;
  deals: number;
  pct: number;
  color: string;
}

export const crmStages: CrmStage[] = [
  { name: "Qualification", value: "$312k", deals: 48, pct: 100, color: "var(--info)" },
  { name: "Discovery", value: "$284k", deals: 40, pct: 91, color: "var(--acc)" },
  { name: "Proposal", value: "$268k", deals: 36, pct: 86, color: "#9d86ff" },
  { name: "Negotiation", value: "$224k", deals: 32, pct: 72, color: "var(--warn)" },
  { name: "Closed won", value: "$152k", deals: 26, pct: 49, color: "var(--ok)" },
];

export const crmWinLoss = {
  winRate: 60,
  won: { deals: 62, value: "$124k" },
  lost: { deals: 41, value: "$82k" },
};

export interface CrmLeadSource {
  name: string;
  value: string;
  pct: number;
  color: string;
}

export const crmLeadSources: CrmLeadSource[] = [
  { name: "Website", value: "382", pct: 41, color: "var(--acc)" },
  { name: "Referral", value: "224", pct: 24, color: "var(--ok)" },
  { name: "Cold outreach", value: "168", pct: 18, color: "var(--info)" },
  { name: "Social media", value: "104", pct: 11, color: "var(--warn)" },
  { name: "Events", value: "62", pct: 6, color: "var(--bad)" },
];

export interface CrmActivityStat {
  label: string;
  value: string;
  sub: string;
  up: boolean;
  icon: string;
  tint: string;
}

export const crmActivityStats: CrmActivityStat[] = [
  { label: "Calls made", value: "284", sub: "+12%", up: true, icon: "phone", tint: "var(--acc)" },
  { label: "Emails sent", value: "1,206", sub: "+8%", up: true, icon: "mail", tint: "var(--info)" },
  { label: "Meetings booked", value: "62", sub: "−4%", up: false, icon: "calendar", tint: "var(--ok)" },
  { label: "Tasks completed", value: "418", sub: "+18%", up: true, icon: "checkSquare", tint: "var(--warn)" },
];

export interface CrmRep {
  rank: number;
  name: string;
  avatar: string;
  avatarBg: string;
  value: string;
  deals: number;
  pct: number;
  medal?: string;
}

export const crmReps: CrmRep[] = [
  { rank: 1, name: "Maya Chen", avatar: "MC", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", value: "$284k", deals: 24, pct: 96, medal: "var(--warn)" },
  { rank: 2, name: "Daniel Ortiz", avatar: "DO", avatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", value: "$246k", deals: 21, pct: 84, medal: "var(--t1)" },
  { rank: 3, name: "Priya Nair", avatar: "PN", avatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", value: "$198k", deals: 18, pct: 71, medal: "#c9975a" },
  { rank: 4, name: "Ethan Cole", avatar: "EC", avatarBg: "linear-gradient(135deg,#9d86ff,#7c5cff)", value: "$164k", deals: 15, pct: 58, medal: "var(--t2)" },
];

export interface CrmDeal {
  name: string;
  company: string;
  avatar: string;
  avatarBg: string;
  value: string;
  priority: string;
  due: string;
  dueColor: string;
  prob: number;
}

export interface CrmPipelineColumn {
  stage: string;
  color: string;
  total: string;
  deals: CrmDeal[];
}

export const crmPipelineCols: CrmPipelineColumn[] = [
  {
    stage: "Qualification", color: "var(--info)", total: "$312k",
    deals: [
      { name: "Vercel platform rollout", company: "Vercel", avatar: "VE", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", value: "$42,000", priority: "High", due: "Due in 3d", dueColor: "var(--warn)", prob: 20 },
      { name: "Analytics suite upgrade", company: "Northwind Inc.", avatar: "NI", avatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", value: "$18,400", priority: "Medium", due: "Due in 8d", dueColor: "var(--t2)", prob: 25 },
    ],
  },
  {
    stage: "Discovery", color: "var(--acc)", total: "$284k",
    deals: [
      { name: "Enterprise security review", company: "Stark Industries", avatar: "SI", avatarBg: "linear-gradient(135deg,#56a8ff,#33d493)", value: "$64,200", priority: "High", due: "Due in 5d", dueColor: "var(--warn)", prob: 40 },
      { name: "Multi-region deployment", company: "Globex Ltd.", avatar: "GL", avatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", value: "$28,600", priority: "Medium", due: "Due in 12d", dueColor: "var(--t2)", prob: 35 },
    ],
  },
  {
    stage: "Proposal", color: "#9d86ff", total: "$268k",
    deals: [
      { name: "Data platform migration", company: "Initech", avatar: "IT", avatarBg: "linear-gradient(135deg,#9d86ff,#7c5cff)", value: "$56,000", priority: "High", due: "Due in 2d", dueColor: "var(--bad)", prob: 55 },
      { name: "Custom integration build", company: "Umbrella Co.", avatar: "UC", avatarBg: "linear-gradient(135deg,#f76d7d,#9d86ff)", value: "$31,800", priority: "Low", due: "Due in 9d", dueColor: "var(--t2)", prob: 50 },
    ],
  },
  {
    stage: "Negotiation", color: "var(--warn)", total: "$224k",
    deals: [
      { name: "Annual license renewal", company: "Acme Corporation", avatar: "AC", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", value: "$74,400", priority: "High", due: "Due tomorrow", dueColor: "var(--bad)", prob: 75 },
      { name: "Support contract expansion", company: "Wayne Enterprises", avatar: "WE", avatarBg: "linear-gradient(135deg,#f7b84e,#7c5cff)", value: "$22,900", priority: "Medium", due: "Due in 4d", dueColor: "var(--warn)", prob: 68 },
    ],
  },
  {
    stage: "Closed won", color: "var(--ok)", total: "$152k",
    deals: [
      { name: "Platform implementation", company: "Hooli", avatar: "HO", avatarBg: "linear-gradient(135deg,#33d493,#7c5cff)", value: "$88,000", priority: "High", due: "Closed", dueColor: "var(--ok)", prob: 100 },
      { name: "Team expansion package", company: "Pied Piper", avatar: "PP", avatarBg: "linear-gradient(135deg,#56a8ff,#f7b84e)", value: "$18,300", priority: "Low", due: "Closed", dueColor: "var(--ok)", prob: 100 },
    ],
  },
];

export interface CrmContact {
  name: string;
  role: string;
  company: string;
  avatar: string;
  avatarBg: string;
  online?: boolean;
}

export const crmContacts: CrmContact[] = [
  { name: "Thomas Webb", role: "CTO", company: "Vercel", avatar: "TW", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", online: true },
  { name: "Sara Delgado", role: "VP Sales", company: "Northwind Inc.", avatar: "SD", avatarBg: "linear-gradient(135deg,#33d493,#56a8ff)" },
  { name: "Marcus Lee", role: "Head of IT", company: "Stark Industries", avatar: "ML", avatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", online: true },
  { name: "Elena Petrova", role: "Procurement", company: "Globex Ltd.", avatar: "EP", avatarBg: "linear-gradient(135deg,#9d86ff,#7c5cff)" },
  { name: "James Ford", role: "COO", company: "Initech", avatar: "JF", avatarBg: "linear-gradient(135deg,#56a8ff,#33d493)" },
];

export interface CrmActivity {
  title: string;
  sub: string;
  time: string;
  done?: boolean;
  icon: string;
  tint: string;
}

export const crmActivities: CrmActivity[] = [
  { title: "Call with Thomas Webb", sub: "Vercel", time: "9:30 AM", done: true, icon: "phone", tint: "var(--acc)" },
  { title: "Send proposal to Globex", sub: "Globex Ltd.", time: "11:00 AM", done: true, icon: "mail", tint: "var(--info)" },
  { title: "Demo — data platform", sub: "Initech", time: "2:00 PM", icon: "calendar", tint: "var(--ok)" },
  { title: "Follow up on renewal", sub: "Acme Corporation", time: "3:30 PM", icon: "checkSquare", tint: "var(--warn)" },
  { title: "Contract review", sub: "Stark Industries", time: "5:00 PM", icon: "briefcase", tint: "var(--bad)" },
];

export const crmLeadKpis = [
  { label: "Total leads", value: "428", sub: "62 new this week", color: "var(--t0)" },
  { label: "Qualified", value: "186", sub: "43% of total", color: "var(--ok)" },
  { label: "Avg. score", value: "68", sub: "out of 100", color: "var(--info)" },
  { label: "Est. value", value: "$1.86M", sub: "Weighted pipeline", color: "var(--acc)" },
];

export interface CrmLead {
  id: string;
  name: string;
  email: string;
  avatar: string;
  avatarBg: string;
  company: string;
  source: string;
  score: number;
  status: string;
  value: string;
  role: string;
  phone: string;
}

export const crmLeads: CrmLead[] = [
  { id: "1", name: "Thomas Webb", email: "t.webb@vercel.com", avatar: "TW", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", company: "Vercel", source: "Website", score: 82, status: "Qualified", value: "$62,000", role: "CTO at Vercel", phone: "+1 (212) 555-0143" },
  { id: "2", name: "Sara Delgado", email: "sara.d@northwind.com", avatar: "SD", avatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", company: "Northwind Inc.", source: "Referral", score: 74, status: "Contacted", value: "$18,400", role: "VP Sales at Northwind", phone: "+1 (206) 555-0198" },
  { id: "3", name: "Marcus Lee", email: "marcus.lee@stark.com", avatar: "ML", avatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", company: "Stark Industries", source: "Cold outreach", score: 58, status: "New", value: "$64,200", role: "Head of IT at Stark", phone: "+1 (646) 555-0122" },
  { id: "4", name: "Elena Petrova", email: "elena.p@globex.com", avatar: "EP", avatarBg: "linear-gradient(135deg,#9d86ff,#7c5cff)", company: "Globex Ltd.", source: "Website", score: 91, status: "Qualified", value: "$28,600", role: "Procurement at Globex", phone: "+44 20 7946 0958" },
  { id: "5", name: "James Ford", email: "j.ford@initech.com", avatar: "JF", avatarBg: "linear-gradient(135deg,#56a8ff,#33d493)", company: "Initech", source: "Events", score: 45, status: "New", value: "$56,000", role: "COO at Initech", phone: "+1 (512) 555-0176" },
  { id: "6", name: "Priya Nair", email: "priya.n@umbrella.co", avatar: "PN", avatarBg: "linear-gradient(135deg,#f76d7d,#9d86ff)", company: "Umbrella Co.", source: "Social media", score: 66, status: "Contacted", value: "$31,800", role: "Marketing Director at Umbrella", phone: "+1 (312) 555-0184" },
  { id: "7", name: "Ethan Cole", email: "e.cole@wayne.com", avatar: "EC", avatarBg: "linear-gradient(135deg,#7c5cff,#33d493)", company: "Wayne Enterprises", source: "Referral", score: 88, status: "Qualified", value: "$22,900", role: "Director of Ops at Wayne", phone: "+1 (917) 555-0111" },
  { id: "8", name: "Nadia Farouk", email: "nadia.f@hooli.com", avatar: "NF", avatarBg: "linear-gradient(135deg,#33d493,#7c5cff)", company: "Hooli", source: "Website", score: 52, status: "Lost", value: "$18,300", role: "IT Manager at Hooli", phone: "+1 (650) 555-0129" },
];

export interface LeadTimelineEntry {
  text: string;
  time: string;
  icon: string;
  tint: string;
}

export const leadTimeline: LeadTimelineEntry[] = [
  { text: "Demo requested for enterprise plan", time: "2 days ago", icon: "calendar", tint: "var(--ok)" },
  { text: "Opened proposal email 3 times", time: "3 days ago", icon: "mail", tint: "var(--info)" },
  { text: "Downloaded pricing sheet", time: "5 days ago", icon: "file", tint: "var(--acc)" },
  { text: "Visited pricing page", time: "6 days ago", icon: "eye", tint: "var(--warn)" },
  { text: "Signed up via website form", time: "12 days ago", icon: "users", tint: "var(--acc)" },
];

export interface CrmOpportunity {
  name: string;
  company: string;
  emoji: string;
  tint: string;
  owner: string;
  avatar: string;
  avatarBg: string;
  value: string;
  stage: string;
  closeDate: string;
  prob: number;
  probColor: string;
}

export const crmOpportunities: CrmOpportunity[] = [
  { name: "Vercel platform rollout", company: "Vercel", emoji: "⚡", tint: "var(--acc)", owner: "Maya Chen", avatar: "MC", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", value: "$42,000", stage: "Qualification", closeDate: "Aug 12, 2026", prob: 20, probColor: "var(--info)" },
  { name: "Enterprise security review", company: "Stark Industries", emoji: "🛡️", tint: "var(--bad)", owner: "Daniel Ortiz", avatar: "DO", avatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", value: "$64,200", stage: "Discovery", closeDate: "Aug 20, 2026", prob: 40, probColor: "var(--acc)" },
  { name: "Data platform migration", company: "Initech", emoji: "🗄️", tint: "var(--info)", owner: "Priya Nair", avatar: "PN", avatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", value: "$56,000", stage: "Proposal", closeDate: "Jul 28, 2026", prob: 55, probColor: "#9d86ff" },
  { name: "Annual license renewal", company: "Acme Corporation", emoji: "📄", tint: "var(--warn)", owner: "Ethan Cole", avatar: "EC", avatarBg: "linear-gradient(135deg,#9d86ff,#7c5cff)", value: "$74,400", stage: "Negotiation", closeDate: "Jul 15, 2026", prob: 75, probColor: "var(--warn)" },
  { name: "Multi-region deployment", company: "Globex Ltd.", emoji: "🌐", tint: "var(--ok)", owner: "Maya Chen", avatar: "MC", avatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", value: "$28,600", stage: "Discovery", closeDate: "Aug 30, 2026", prob: 35, probColor: "var(--acc)" },
  { name: "Support contract expansion", company: "Wayne Enterprises", emoji: "🤝", tint: "var(--acc)", owner: "Daniel Ortiz", avatar: "DO", avatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", value: "$22,900", stage: "Negotiation", closeDate: "Jul 18, 2026", prob: 68, probColor: "var(--warn)" },
  { name: "Custom integration build", company: "Umbrella Co.", emoji: "🔧", tint: "var(--bad)", owner: "Priya Nair", avatar: "PN", avatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", value: "$31,800", stage: "Proposal", closeDate: "Aug 5, 2026", prob: 50, probColor: "#9d86ff" },
];

export interface CrmAccount {
  name: string;
  industry: string;
  emoji: string;
  tint: string;
  health: string;
  arr: string;
  seats: number;
  rep: string;
  repAvatar: string;
  repAvatarBg: string;
  renews: string;
}

export const crmAccounts: CrmAccount[] = [
  { name: "Acme Corporation", industry: "Manufacturing", emoji: "🏭", tint: "var(--acc)", health: "Healthy", arr: "$248k", seats: 320, rep: "Maya Chen", repAvatar: "MC", repAvatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", renews: "Mar 2027" },
  { name: "Vercel", industry: "Software", emoji: "▲", tint: "var(--t0)", health: "Healthy", arr: "$186k", seats: 148, rep: "Daniel Ortiz", repAvatar: "DO", repAvatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", renews: "Jan 2027" },
  { name: "Stark Industries", industry: "Defense & Tech", emoji: "⚙️", tint: "var(--info)", health: "At risk", arr: "$412k", seats: 560, rep: "Priya Nair", repAvatar: "PN", repAvatarBg: "linear-gradient(135deg,#f7b84e,#f76d7d)", renews: "Sep 2026" },
  { name: "Globex Ltd.", industry: "Logistics", emoji: "📦", tint: "var(--warn)", health: "Healthy", arr: "$94k", seats: 76, rep: "Ethan Cole", repAvatar: "EC", repAvatarBg: "linear-gradient(135deg,#9d86ff,#7c5cff)", renews: "Nov 2026" },
  { name: "Initech", industry: "Financial Services", emoji: "💳", tint: "var(--ok)", health: "Critical", arr: "$56k", seats: 42, rep: "Maya Chen", repAvatar: "MC", repAvatarBg: "linear-gradient(135deg,#7c5cff,#56a8ff)", renews: "Aug 2026" },
  { name: "Umbrella Co.", industry: "Pharmaceuticals", emoji: "☂️", tint: "var(--bad)", health: "Healthy", arr: "$328k", seats: 210, rep: "Daniel Ortiz", repAvatar: "DO", repAvatarBg: "linear-gradient(135deg,#33d493,#56a8ff)", renews: "Feb 2027" },
];

export interface FunnelStageData {
  step: number;
  name: string;
  count: string;
  pct: string;
  value: string;
  w: string;
  tint: string;
  dropoff?: string;
}

export const salesFunnelStages = [
  { label: "Visitors", value: 24800, color: "var(--info)" },
  { label: "Leads", value: 940, color: "var(--acc)" },
  { label: "Qualified", value: 428, color: "#9d86ff" },
  { label: "Proposals", value: 182, color: "var(--warn)" },
  { label: "Closed won", value: 62, color: "var(--ok)" },
];

export const funnelConversions = [
  { name: "Visitor → Lead", rate: 3.8, color: "var(--acc)" },
  { name: "Lead → Qualified", rate: 45.5, color: "var(--info)" },
  { name: "Qualified → Proposal", rate: 42.5, color: "var(--warn)" },
  { name: "Proposal → Closed won", rate: 34.1, color: "var(--ok)" },
];

export const funnelKeyMetrics = {
  overallConversion: "3.8%",
  avgDealCycle: "28 days",
  avgDealSize: "$6,820",
};

export interface CrmCampaign {
  name: string;
  status: string;
  channel: string;
  dates: string;
  leads: string;
  conv: string;
  spent: string;
  budget: string;
  pct: number;
  icon: string;
  tint: string;
}

export const crmCampaigns: CrmCampaign[] = [
  { name: "Summer product launch", status: "Active", channel: "Email + Social", dates: "Jun 1 – Aug 31, 2026", leads: "1,240", conv: "6.2%", spent: "$14,200", budget: "$20,000", pct: 71, icon: "megaphone", tint: "var(--acc)" },
  { name: "Enterprise webinar series", status: "Active", channel: "Webinar", dates: "Jul 1 – Sep 30, 2026", leads: "620", conv: "9.8%", spent: "$8,600", budget: "$12,000", pct: 72, icon: "calendar", tint: "var(--info)" },
  { name: "LinkedIn ABM campaign", status: "Active", channel: "Paid social", dates: "May 15 – Jul 31, 2026", leads: "864", conv: "4.4%", spent: "$18,400", budget: "$24,000", pct: 77, icon: "target", tint: "var(--warn)" },
  { name: "Referral incentive program", status: "Active", channel: "Referral", dates: "Jan 1 – Dec 31, 2026", leads: "412", conv: "18.2%", spent: "$6,200", budget: "$15,000", pct: 41, icon: "heart", tint: "var(--ok)" },
  { name: "Google search ads", status: "Paused", channel: "Paid search", dates: "Mar 1 – Jun 15, 2026", leads: "980", conv: "3.1%", spent: "$22,000", budget: "$22,000", pct: 100, icon: "search", tint: "var(--bad)" },
  { name: "Q4 planning content series", status: "Scheduled", channel: "Content", dates: "Oct 1 – Dec 15, 2026", leads: "0", conv: "0%", spent: "$0", budget: "$10,000", pct: 0, icon: "file", tint: "#9d86ff" },
  { name: "Partner co-marketing", status: "Completed", channel: "Events", dates: "Feb 1 – Apr 30, 2026", leads: "312", conv: "7.5%", spent: "$9,800", budget: "$9,800", pct: 100, icon: "briefcase", tint: "var(--t1)" },
  { name: "Customer advocacy program", status: "Active", channel: "Referral", dates: "Jun 1 – Dec 31, 2026", leads: "164", conv: "22.4%", spent: "$3,400", budget: "$8,000", pct: 43, icon: "star", tint: "var(--acc)" },
];

export interface JourneyStage {
  name: string;
  count: string;
  pct: string;
  color: string;
  icon: string;
}

export const journeyStages: JourneyStage[] = [
  { name: "Awareness", count: "24,800", pct: "100%", color: "var(--info)", icon: "eye" },
  { name: "Consideration", count: "8,420", pct: "34%", color: "var(--acc)", icon: "search" },
  { name: "Decision", count: "1,860", pct: "7.5%", color: "#9d86ff", icon: "target" },
  { name: "Purchase", count: "428", pct: "1.7%", color: "var(--ok)", icon: "cart" },
  { name: "Advocacy", count: "182", pct: "0.7%", color: "var(--warn)", icon: "heart" },
];

export interface JourneyTouchpoint {
  title: string;
  stage: string;
  desc: string;
  channel: string;
  rate: string;
  rateColor: string;
  icon: string;
  tint: string;
}

export const journeyTouchpoints: JourneyTouchpoint[] = [
  { title: "First website visit", stage: "Awareness", desc: "Visitor lands on the homepage via organic search or paid ad.", channel: "Organic search", rate: "24,800 visits", rateColor: "var(--info)", icon: "eye", tint: "var(--info)" },
  { title: "Downloaded pricing guide", stage: "Consideration", desc: "Prospect exchanges email for a gated pricing comparison PDF.", channel: "Content offer", rate: "34% CVR", rateColor: "var(--acc)", icon: "file", tint: "var(--acc)" },
  { title: "Attended product demo", stage: "Consideration", desc: "Sales-qualified lead books and attends a live product walkthrough.", channel: "Sales call", rate: "18% CVR", rateColor: "var(--acc)", icon: "calendar", tint: "var(--acc)" },
  { title: "Requested custom proposal", stage: "Decision", desc: "Prospect asks for pricing tailored to their team size and needs.", channel: "Sales email", rate: "7.5% CVR", rateColor: "#9d86ff", icon: "mail", tint: "#9d86ff" },
  { title: "Signed contract", stage: "Purchase", desc: "Deal closes and account is provisioned for onboarding.", channel: "Direct", rate: "1.7% CVR", rateColor: "var(--ok)", icon: "checkSquare", tint: "var(--ok)" },
  { title: "Referred a peer", stage: "Advocacy", desc: "Happy customer refers another company through the partner program.", channel: "Referral program", rate: "0.7% CVR", rateColor: "var(--warn)", icon: "heart", tint: "var(--warn)" },
];
