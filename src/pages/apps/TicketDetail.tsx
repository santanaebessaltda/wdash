import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Avatar, Badge, Button, PageHeader, ProgressBar, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { paths } from "@/router/paths";
import { tickets, type ThreadMessage } from "@/data/apps";
import { BackIcon, FileTextIcon, PaperclipIcon, SmileIcon } from "./icons";

export function TicketDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ticket = tickets.find((t) => t.id === id) ?? tickets[0];

  const [replyMode, setReplyMode] = useState<"reply" | "note">("reply");
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState<ThreadMessage[]>([]);

  const thread = [...ticket.thread, ...localMessages];

  function sendReply() {
    if (!draft.trim()) return;
    setLocalMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, name: "You", agent: true, text: draft.trim(), time: "Now" },
    ]);
    setDraft("");
  }

  const goal = [
    { label: "Category", value: ticket.category },
    { label: "Priority", value: ticket.priority, urgent: ticket.priority === "High" },
    { label: "Status", value: ticket.status },
    { label: "Assigned to", value: ticket.assigned },
    { label: "Created", value: ticket.created },
  ];

  // requester ticket rollup
  const requesterTickets = tickets.filter((t) => t.requester === ticket.requester);
  const requesterOpen = requesterTickets.filter((t) => t.status === "Open").length;

  const slaResolved = ticket.status === "Resolved" || ticket.status === "Closed";
  const slaPct = ticket.breached ? 100 : ticket.slaUrgent ? 22 : slaResolved ? 100 : 55;
  const slaColor = ticket.breached || ticket.slaUrgent ? "var(--bad)" : slaResolved ? "var(--ok)" : "var(--warn)";

  return (
    <div>
      <PageHeader
        title={ticket.title}
        crumbs={[{ label: "Apps" }, { label: "Help Desk", to: paths.apps.helpDesk }, { label: `#${ticket.id}` }]}
        actions={
          <Button variant="secondary" icon={<BackIcon size={14} />} onClick={() => navigate(-1)}>
            Back
          </Button>
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_300px]">
        {/* Main */}
        <div className="flex flex-col gap-4">
          {/* Header card */}
          <div className="rounded-[18px] border border-line bg-bg-2 p-5 shadow-[var(--shadow-vela)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                  <Badge status={ticket.priority}>{ticket.priority} priority</Badge>
                  <Badge status={ticket.status}>{ticket.status}</Badge>
                  <span className="font-mono text-xs text-t2">#{ticket.id}</span>
                </div>
                <h2 className="text-lg font-extrabold text-t0">{ticket.title}</h2>
                <p className="mt-2 text-[13px] text-t2">
                  Opened by <strong className="text-t1">{ticket.requester}</strong> · {ticket.created} · Category: {ticket.category}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm">
                  Escalate
                </Button>
                <Button size="sm" className="bg-ok hover:opacity-90">
                  Resolve
                </Button>
              </div>
            </div>
            <div className="mt-4 border-t border-line pt-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold text-t2">SLA: First response</span>
                <span className="text-xs font-bold" style={{ color: slaColor }}>
                  {ticket.sla}
                </span>
              </div>
              <ProgressBar value={slaPct} color={slaColor} height={7} />
            </div>
          </div>

          {/* Thread */}
          <div className="rounded-[18px] border border-line bg-bg-2 p-5 shadow-[var(--shadow-vela)]">
            <h3 className="mb-4 text-[15px] font-bold text-t0">Conversation</h3>
            <div className="flex flex-col gap-4.5">
              {thread.map((m) => (
                <div key={m.id} className="flex gap-3">
                  <Avatar name={m.name} size="md" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-baseline gap-2.5">
                      <span className="text-[13.5px] font-bold text-t0">{m.name}</span>
                      {m.agent && <Badge variant="accent">Agent</Badge>}
                      <span className="text-[11.5px] text-t2">{m.time}</span>
                    </div>
                    <div className="rounded-2xl bg-bg-inset px-4 py-3.5 text-[13.5px] leading-relaxed text-t1">{m.text}</div>
                    {m.attachment && (
                      <div className="mt-2 flex w-fit items-center gap-2.5 rounded-xl border border-line bg-bg-3 px-3.5 py-2.5">
                        <FileTextIcon size={16} className="text-acc" />
                        <span className="text-[12.5px] font-semibold text-t0">{m.attachment}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Reply box */}
            <div className="mt-5 border-t border-line pt-4.5">
              <div className="mb-2.5 flex w-fit gap-1 rounded-[10px] border border-line bg-bg-inset p-[3px]">
                {(["reply", "note"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setReplyMode(mode)}
                    className={cn(
                      "rounded-lg px-3.5 py-1.5 text-xs font-bold transition-colors",
                      replyMode === mode ? "bg-acc text-white" : "text-t1 hover:text-t0",
                    )}
                  >
                    {mode === "reply" ? "Reply" : "Internal note"}
                  </button>
                ))}
              </div>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={replyMode === "reply" ? "Type your reply…" : "Add an internal note…"}
                className="h-[110px] resize-none"
              />
              <div className="mt-3 flex items-center justify-between">
                <div className="flex gap-2">
                  <button className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3 hover:text-t0" aria-label="Attach">
                    <PaperclipIcon size={16} />
                  </button>
                  <button className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] border border-line text-t1 hover:bg-bg-3 hover:text-t0" aria-label="Emoji">
                    <SmileIcon size={16} />
                  </button>
                </div>
                <Button onClick={sendReply}>{replyMode === "reply" ? "Send reply" : "Save note"}</Button>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-bg-2 p-4.5 shadow-[var(--shadow-vela)]">
            <p className="mb-3 text-[11.5px] font-bold uppercase tracking-wide text-t2">Requester</p>
            <div className="mb-3 flex items-center gap-2.5">
              <Avatar name={ticket.requester} size="md" />
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-bold text-t0">{ticket.requester}</p>
                <p className="mt-0.5 truncate text-xs text-t2">{ticket.requesterEmail}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-t2">Plan</span>
                <span className="text-[12.5px] font-bold text-acc">{ticket.plan}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-t2">All tickets</span>
                <span className="text-[12.5px] font-bold text-t0">{requesterTickets.length} total</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-t2">Open</span>
                <span className="text-[12.5px] font-bold text-bad">{requesterOpen} open</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-bg-2 p-4.5 shadow-[var(--shadow-vela)]">
            <p className="mb-3 text-[11.5px] font-bold uppercase tracking-wide text-t2">Details</p>
            <div className="flex flex-col gap-2.5">
              {goal.map((m) => (
                <div key={m.label} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-t2">{m.label}</span>
                  <span className={cn("truncate text-[12.5px] font-bold", m.urgent ? "text-bad" : "text-t0")}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-bg-2 p-4.5 shadow-[var(--shadow-vela)]">
            <p className="mb-3 text-[11.5px] font-bold uppercase tracking-wide text-t2">Activity</p>
            <div className="flex flex-col gap-2.5">
              {ticket.activity.map((a, i) => (
                <div key={i} className="flex gap-2.5 text-xs text-t2">
                  <span className="shrink-0 font-mono">{a.time}</span>
                  <span className="text-t1">{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
