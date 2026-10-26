import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { paths } from "@/router/paths";
import {
  Accordion,
  Avatar,
  AvatarGroup,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardHeader,
  CardSubtitle,
  CardTitle,
  Drawer,
  Dropdown,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  Popover,
  ProgressBar,
  RadialProgress,
  Rating,
  Skeleton,
  Spinner,
  TabNav,
  Tabs,
  Timeline,
  Tooltip,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/cn";

const TABS: { key: string; label: string; title: string; desc: string }[] = [
  { key: "buttons", label: "Buttons", title: "Buttons", desc: "Variants, sizes, icon and states" },
  { key: "alerts", label: "Alerts", title: "Alerts", desc: "Contextual feedback messages" },
  { key: "cards", label: "Cards", title: "Cards", desc: "Content containers and variants" },
  { key: "modals", label: "Modals", title: "Modals", desc: "Centered dialog with backdrop" },
  { key: "tabs", label: "Tabs", title: "Tabs", desc: "Switchable content panels" },
  { key: "accordions", label: "Accordions", title: "Accordions", desc: "Expandable content panels" },
  { key: "avatars", label: "Avatars", title: "Avatars", desc: "Sizes, status and stacked groups" },
  { key: "badges", label: "Badges", title: "Badges", desc: "Labels, status dots and counters" },
  { key: "breadcrumbs", label: "Breadcrumbs", title: "Breadcrumbs", desc: "Hierarchical navigation trails" },
  { key: "dropdowns", label: "Dropdowns", title: "Dropdowns", desc: "Menus with items, icons and dividers" },
  { key: "pagination", label: "Pagination", title: "Pagination", desc: "Page navigation controls" },
  { key: "progress", label: "Progress", title: "Progress", desc: "Linear and circular indicators" },
  { key: "tooltips", label: "Tooltips", title: "Tooltips", desc: "Hover hints in multiple directions" },
  { key: "popovers", label: "Popovers", title: "Popovers", desc: "Rich content anchored to a trigger" },
  { key: "toasts", label: "Toasts", title: "Toasts", desc: "Transient notification snackbars" },
  { key: "timeline", label: "Timeline", title: "Timeline", desc: "Chronological activity feed" },
  { key: "ratings", label: "Ratings", title: "Ratings", desc: "Stars and score displays" },
  { key: "carousel", label: "Carousel", title: "Carousel", desc: "Sliding content with indicators" },
  { key: "offcanvas", label: "Offcanvas", title: "Offcanvas", desc: "Slide-in side drawer panel" },
  { key: "loaders", label: "Loaders", title: "Loaders", desc: "Spinners, dots and skeletons" },
  { key: "empty-states", label: "Empty States", title: "Empty States", desc: "Zero-data and no-results screens" },
];

export function ComponentsShowcasePage() {
  const { tab } = useParams<{ tab: string }>();
  const active = TABS.find((t) => t.key === tab);

  if (!active) {
    return <Navigate to={paths.components.tab("buttons")} replace />;
  }

  return (
    <div>
      <PageHeader crumbs={[{ label: "UI Kit" }, { label: active.title }]} title={active.title} subtitle={active.desc} />
      <div className="mb-6">
        <TabNav items={TABS.map((t) => ({ label: t.label, to: paths.components.tab(t.key) }))} />
      </div>
      <Demo tabKey={active.key} />
    </div>
  );
}

function Demo({ tabKey }: { tabKey: string }) {
  switch (tabKey) {
    case "buttons":
      return <ButtonsDemo />;
    case "alerts":
      return <AlertsDemo />;
    case "cards":
      return <CardsDemo />;
    case "modals":
      return <ModalsDemo />;
    case "tabs":
      return <TabsDemo />;
    case "accordions":
      return <AccordionsDemo />;
    case "avatars":
      return <AvatarsDemo />;
    case "badges":
      return <BadgesDemo />;
    case "breadcrumbs":
      return <BreadcrumbsDemo />;
    case "dropdowns":
      return <DropdownsDemo />;
    case "pagination":
      return <PaginationDemo />;
    case "progress":
      return <ProgressDemo />;
    case "tooltips":
      return <TooltipsDemo />;
    case "popovers":
      return <PopoversDemo />;
    case "toasts":
      return <ToastsDemo />;
    case "timeline":
      return <TimelineDemo />;
    case "ratings":
      return <RatingsDemo />;
    case "carousel":
      return <CarouselDemo />;
    case "offcanvas":
      return <OffcanvasDemo />;
    case "loaders":
      return <LoadersDemo />;
    case "empty-states":
      return <EmptyStatesDemo />;
    default:
      return null;
  }
}

function ButtonsDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Buttons</CardTitle>
          <CardSubtitle>Variants, sizes, icon and states</CardSubtitle>
        </div>
      </CardHeader>
      <div className="mb-5 flex flex-wrap gap-2.5">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
        <Button
          icon={
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          }
        >
          With icon
        </Button>
      </div>
    </Card>
  );
}

const alertData = [
  { variant: "success", title: "Payment successful", text: "Your subscription has been renewed for another year.", color: "var(--ok)", bg: "var(--ok-soft)", icon: "M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" },
  { variant: "warning", title: "Storage almost full", text: "You've used 92% of your available storage.", color: "var(--warn)", bg: "var(--warn-soft)", icon: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" },
  { variant: "danger", title: "Failed to save changes", text: "Something went wrong. Please try again.", color: "var(--bad)", bg: "var(--bad-soft)", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6" },
  { variant: "info", title: "New feature available", text: "Command palette is here — press ⌘K to try it.", color: "var(--info)", bg: "var(--info-soft)", icon: "M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" },
];

function AlertsDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Alerts</CardTitle>
          <CardSubtitle>Contextual feedback messages</CardSubtitle>
        </div>
      </CardHeader>
      <div className="flex flex-col gap-3">
        {alertData.map((a) => (
          <div key={a.variant} className="flex items-start gap-3 rounded-xl px-4 py-3.5" style={{ background: a.bg }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={a.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
              <path d={a.icon} />
            </svg>
            <div className="flex-1">
              <p className="text-[13px] font-bold" style={{ color: a.color }}>
                {a.title}
              </p>
              <p className="mt-0.5 text-[12.5px] text-t1">{a.text}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function CardsDemo() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <Card padding="lg">
        <span className="mb-3.5 flex h-10 w-10 items-center justify-center rounded-xl bg-acc-soft text-acc">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18M18 9l-5 5-4-4-4 4" />
          </svg>
        </span>
        <p className="text-[13.5px] font-bold text-t2">Monthly revenue</p>
        <p className="mt-1.5 text-[26px] font-extrabold text-t0">$48,240</p>
        <p className="mt-1 text-xs font-bold text-ok">↑ 12.4% vs last month</p>
      </Card>
      <div className="rounded-[var(--radius-vela-lg)] p-6 text-white" style={{ background: "linear-gradient(135deg,var(--acc),var(--acc-2))" }}>
        <p className="text-[13.5px] font-bold">Upgrade to Pro</p>
        <p className="mb-4 mt-2 text-[12.5px] leading-relaxed opacity-85">Unlock advanced analytics, unlimited seats and priority support.</p>
        <button className="h-9 rounded-[10px] bg-white px-4 text-[12.5px] font-bold text-acc">Upgrade now</button>
      </div>
      <Card padding="none" className="overflow-hidden">
        <div className="h-24" style={{ background: "linear-gradient(135deg,#1e2a4a,#2d3a6b)" }} />
        <div className="p-5">
          <p className="text-sm font-bold text-t0">Media card</p>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-t2">A card with a media header, title and supporting text.</p>
        </div>
      </Card>
    </div>
  );
}

function ModalsDemo() {
  const [size, setSize] = useState<"sm" | "md" | "lg" | null>(null);
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Modals</CardTitle>
          <CardSubtitle>Centered dialog with backdrop</CardSubtitle>
        </div>
      </CardHeader>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="secondary" onClick={() => setSize("sm")}>Small modal</Button>
        <Button variant="secondary" onClick={() => setSize("md")}>Medium modal</Button>
        <Button variant="secondary" onClick={() => setSize("lg")}>Large modal</Button>
      </div>
      <Modal
        open={size !== null}
        onClose={() => setSize(null)}
        size={size ?? "md"}
        title="Delete project?"
        footer={
          <>
            <Button variant="outline" onClick={() => setSize(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => setSize(null)}>Delete</Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-t1">
          This will permanently delete "Billing Platform v2" and all its data. This action cannot be undone.
        </p>
      </Modal>
    </Card>
  );
}

function TabsDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Tabs</CardTitle>
          <CardSubtitle>Switchable content panels</CardSubtitle>
        </div>
      </CardHeader>
      <Tabs
        items={[
          { key: "overview", label: "Overview", content: <p className="text-[13px] leading-relaxed text-t1">Overview content — a high-level summary of the project state and recent activity.</p> },
          { key: "activity", label: "Activity", content: <p className="text-[13px] leading-relaxed text-t1">Activity content — a chronological feed of everything that changed recently.</p> },
          { key: "settings", label: "Settings", content: <p className="text-[13px] leading-relaxed text-t1">Settings content — configure preferences, integrations and access.</p> },
        ]}
      />
    </Card>
  );
}

function AccordionsDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Accordions</CardTitle>
          <CardSubtitle>Expandable content panels</CardSubtitle>
        </div>
      </CardHeader>
      <Accordion
        defaultOpen="a1"
        items={[
          { key: "a1", title: "How do I reset my password?", content: "Head to Settings → Security and click 'Reset password'. You'll receive an email with a secure link that expires in 30 minutes." },
          { key: "a2", title: "Can I invite team members?", content: "Yes — on Growth and Enterprise plans you can invite unlimited team members from the Team settings page." },
          { key: "a3", title: "What payment methods do you accept?", content: "We accept all major credit cards, ACH transfers and invoicing for annual Enterprise contracts." },
        ]}
      />
    </Card>
  );
}

function AvatarsDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Avatars</CardTitle>
          <CardSubtitle>Sizes, status and stacked groups</CardSubtitle>
        </div>
      </CardHeader>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name="Sam" size="xs" />
        <Avatar name="Mia Reed" size="sm" />
        <Avatar name="Leo King" size="md" status="online" />
        <Avatar name="Nora Vale" size="lg" status="busy" />
        <Avatar name="Elena Park" size="xl" status="away" />
      </div>
      <AvatarGroup names={["Alice", "Bob", "Carol", "Dan", "Erin", "Frank", "Grace", "Heidi", "Ivan", "Judy", "Mallory", "Niaj"]} max={4} />
    </Card>
  );
}

function BadgesDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Badges</CardTitle>
          <CardSubtitle>Labels, status dots and counters</CardSubtitle>
        </div>
      </CardHeader>
      <div className="mb-5 flex flex-wrap gap-2">
        <Badge variant="accent">Primary</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="danger">Danger</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="neutral">Neutral</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="success" dot>Active</Badge>
        <Badge variant="neutral" dot>Offline</Badge>
        <span className="relative inline-flex">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--t1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">5</span>
        </span>
      </div>
    </Card>
  );
}

function BreadcrumbsDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Breadcrumbs</CardTitle>
          <CardSubtitle>Hierarchical navigation trails</CardSubtitle>
        </div>
      </CardHeader>
      <div className="flex flex-col gap-4">
        <Breadcrumbs items={[{ label: "Home", to: paths.home }, { label: "Projects", to: paths.projects.list }, { label: "Billing v2" }]} />
        <Breadcrumbs items={[{ label: "Home", to: paths.home }, { label: "Ecommerce", to: paths.ecommerce.ordersList }, { label: "Orders" }]} />
        <Breadcrumbs items={[{ label: "Dashboard", to: paths.home }, { label: "Reports", to: paths.reports.root }, { label: "Q3 Revenue" }]} />
      </div>
    </Card>
  );
}

function DropdownsDemo() {
  const toast = useToast();
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Dropdowns</CardTitle>
          <CardSubtitle>Menus with items, icons and dividers</CardSubtitle>
        </div>
      </CardHeader>
      <Dropdown
        align="left"
        trigger={
          <Button variant="secondary" iconRight={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          }>
            Options
          </Button>
        }
        items={[
          { label: "View profile", onClick: () => toast.show("Opening profile…", "info") },
          { label: "Settings", onClick: () => toast.show("Opening settings…", "info") },
          { divider: true, label: "" },
          { label: "Log out", danger: true, onClick: () => toast.show("Logged out", "neutral") },
        ]}
      />
    </Card>
  );
}

function PaginationDemo() {
  const [page, setPage] = useState(1);
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Pagination</CardTitle>
          <CardSubtitle>Page navigation controls</CardSubtitle>
        </div>
      </CardHeader>
      <Pagination page={page} totalPages={12} onChange={setPage} />
      <p className="mt-4 border-t border-line pt-4 text-[12.5px] text-t2">Showing page {page} of 12 · 248 results</p>
    </Card>
  );
}

function ProgressDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Progress bars</CardTitle>
          <CardSubtitle>Linear and circular indicators</CardSubtitle>
        </div>
      </CardHeader>
      <div className="mb-6 flex flex-col gap-4">
        <ProgressBar label="Storage used" value={70} />
        <ProgressBar label="Uploads" value={90} color="var(--ok)" />
        <ProgressBar label="Processing" value={50} color="var(--warn)" />
      </div>
      <div className="flex flex-wrap gap-6">
        <RadialProgress value={70} size={80} />
        <RadialProgress value={90} size={80} color="var(--ok)" />
        <RadialProgress value={50} size={80} color="var(--warn)" />
      </div>
    </Card>
  );
}

function TooltipsDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Tooltips</CardTitle>
          <CardSubtitle>Hover hints in multiple directions</CardSubtitle>
        </div>
      </CardHeader>
      <div className="flex flex-wrap gap-4">
        <Tooltip label="Tooltip on top" side="top">
          <Button variant="outline">Hover — top</Button>
        </Tooltip>
        <Tooltip label="Tooltip on bottom" side="bottom">
          <Button variant="outline">Hover — bottom</Button>
        </Tooltip>
        <Tooltip label="Copy to clipboard">
          <Button variant="ghost">Icon action</Button>
        </Tooltip>
      </div>
    </Card>
  );
}

function PopoversDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Popovers</CardTitle>
          <CardSubtitle>Rich content anchored to a trigger</CardSubtitle>
        </div>
      </CardHeader>
      <Popover trigger={<Button variant="secondary">Click for details</Button>}>
        <p className="mb-3 text-[13.5px] font-bold text-t0">Keyboard shortcuts</p>
        <div className="flex flex-col gap-2.5">
          {[
            { name: "Command palette", key: "⌘K" },
            { name: "New item", key: "⌘N" },
            { name: "Toggle theme", key: "⌘J" },
          ].map((s) => (
            <div key={s.name} className="flex items-center justify-between">
              <span className="text-[12.5px] text-t1">{s.name}</span>
              <kbd className="rounded-md border border-line bg-bg-inset px-1.5 py-0.5 text-[11px] font-bold text-t1">{s.key}</kbd>
            </div>
          ))}
        </div>
      </Popover>
    </Card>
  );
}

function ToastsDemo() {
  const toast = useToast();
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Toasts</CardTitle>
          <CardSubtitle>Transient notification snackbars</CardSubtitle>
        </div>
      </CardHeader>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="secondary" onClick={() => toast.show("Saved successfully", "success")}>Success toast</Button>
        <Button variant="secondary" onClick={() => toast.show("Upload failed — file too large", "danger")}>Error toast</Button>
        <Button variant="secondary" onClick={() => toast.show("Storage almost full", "warning")}>Warning toast</Button>
        <Button variant="secondary" onClick={() => toast.show("New update available", "info")}>Info toast</Button>
      </div>
    </Card>
  );
}

function TimelineDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Timeline</CardTitle>
          <CardSubtitle>Chronological activity feed</CardSubtitle>
        </div>
      </CardHeader>
      <Timeline
        events={[
          { id: 1, title: "Deployment succeeded", description: "v2.4.0 shipped to production", time: "2 minutes ago", color: "var(--ok)", icon: "✓" },
          { id: 2, title: "Pull request merged", description: "Marcus merged #482 into main", time: "1 hour ago", color: "var(--acc)", icon: "⎇" },
          { id: 3, title: "New comment", description: "Elena commented on the roadmap", time: "3 hours ago", color: "var(--info)", icon: "💬" },
          { id: 4, title: "Build failed", description: "CI pipeline failed on step 'test'", time: "Yesterday", color: "var(--bad)", icon: "!" },
        ]}
      />
    </Card>
  );
}

function RatingsDemo() {
  const [value, setValue] = useState(4);
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Ratings</CardTitle>
          <CardSubtitle>Stars and score displays</CardSubtitle>
        </div>
      </CardHeader>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Rating value={4} size={24} />
          <span className="text-sm font-bold text-t0">4.0 <span className="font-medium text-t2">(128 reviews)</span></span>
        </div>
        <div className="flex items-center gap-3">
          <Rating value={5} size={24} />
          <span className="text-sm font-bold text-t0">5.0 <span className="font-medium text-t2">(64 reviews)</span></span>
        </div>
        <div>
          <p className="mb-2 text-[12.5px] font-bold text-t1">Interactive</p>
          <div className="flex items-center gap-3">
            <div className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} onClick={() => setValue(n)} aria-label={`Rate ${n}`}>
                  <span className={cn("text-2xl", n <= value ? "text-warn" : "text-bg-3")}>★</span>
                </button>
              ))}
            </div>
            <span className="text-sm font-bold text-t0">{value}.0</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

const slides = [
  { title: "Slide 1 of 3", text: "Showcase featured content, product images or testimonials in a rotating carousel.", bg: "linear-gradient(135deg,#1b1650,#0f3050)" },
  { title: "Slide 2 of 3", text: "Highlight new features with bold visuals and a short supporting caption.", bg: "linear-gradient(135deg,#0f3050,#0f4a3a)" },
  { title: "Slide 3 of 3", text: "Drive action with a clear call to action at the end of the sequence.", bg: "linear-gradient(135deg,#3a1650,#50101e)" },
];

function CarouselDemo() {
  const [index, setIndex] = useState(0);
  const go = (dir: number) => setIndex((i) => (i + dir + slides.length) % slides.length);
  const slide = slides[index];
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Carousel</CardTitle>
          <CardSubtitle>Sliding content with indicators</CardSubtitle>
        </div>
      </CardHeader>
      <div className="relative flex h-60 items-center justify-center overflow-hidden rounded-2xl" style={{ background: slide.bg }}>
        <div className="px-8 text-center text-white">
          <p className="mb-2 text-[22px] font-extrabold">{slide.title}</p>
          <p className="mx-auto max-w-sm text-[13.5px] leading-relaxed opacity-80">{slide.text}</p>
        </div>
        <button
          onClick={() => go(-1)}
          aria-label="Previous slide"
          className="absolute left-3.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white backdrop-blur"
          style={{ background: "rgba(255,255,255,.15)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <button
          onClick={() => go(1)}
          aria-label="Next slide"
          className="absolute right-3.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-white backdrop-blur"
          style={{ background: "rgba(255,255,255,.15)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
        <div className="absolute bottom-3.5 left-1/2 flex -translate-x-1/2 gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              className="h-1.5 rounded-full transition-all"
              style={{ width: i === index ? 24 : 6, background: i === index ? "#fff" : "rgba(255,255,255,.4)" }}
            />
          ))}
        </div>
      </div>
    </Card>
  );
}

function OffcanvasDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Offcanvas</CardTitle>
          <CardSubtitle>Slide-in side drawer panel</CardSubtitle>
        </div>
      </CardHeader>
      <Button variant="secondary" onClick={() => setOpen(true)}>Open filters panel</Button>
      <Drawer open={open} onClose={() => setOpen(false)} side="right" width="300px">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="text-[15px] font-bold text-t0">Filters</h3>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-t2 hover:text-t0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 p-5">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-t2">Status</p>
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center gap-2.5 text-[13px] text-t1">
                <input type="checkbox" defaultChecked /> Active
              </label>
              <label className="flex items-center gap-2.5 text-[13px] text-t1">
                <input type="checkbox" /> Archived
              </label>
            </div>
          </div>
          <div className="flex gap-2.5 border-t border-line px-5 py-4">
            <Button variant="outline" fullWidth onClick={() => setOpen(false)}>Reset</Button>
            <Button fullWidth onClick={() => setOpen(false)}>Apply</Button>
          </div>
        </div>
      </Drawer>
      <p className="mt-3 text-[12px] text-t2">The drawer slides in from the right on small screens; open it to see the panel.</p>
    </Card>
  );
}

function LoadersDemo() {
  return (
    <Card padding="lg">
      <CardHeader>
        <div>
          <CardTitle>Loaders</CardTitle>
          <CardSubtitle>Spinners, dots and skeletons</CardSubtitle>
        </div>
      </CardHeader>
      <div className="mb-6 flex flex-wrap items-center gap-8">
        <Spinner size={40} />
        <div className="flex gap-1.5">
          {[0, 0.2, 0.4].map((delay) => (
            <span key={delay} className="h-2.5 w-2.5 animate-vela-shimmer rounded-full bg-acc" style={{ animationDelay: `${delay}s` }} />
          ))}
        </div>
      </div>
      <div className="flex max-w-md items-center gap-3.5">
        <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-[70%]" />
          <Skeleton className="h-3 w-[45%]" />
        </div>
      </div>
    </Card>
  );
}

function EmptyStatesDemo() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <EmptyState
        icon="📦"
        title="No data yet"
        description="Nothing here yet. Create your first item to get started."
        action={<Button size="sm">Create item</Button>}
      />
      <EmptyState
        icon="🔍"
        title="No results found"
        description="Try adjusting your search or filters to find what you're looking for."
        action={<Button variant="outline" size="sm">Clear filters</Button>}
      />
    </div>
  );
}
