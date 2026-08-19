import '@/lib/server-guard';
import { db } from '@/lib/db';
import { endOfDay, startOfDay } from '@/lib/utils';
import { countPendingSuggestions } from '@/core/ai/suggestions';

/**
 * The dashboard.
 *
 * The brief was explicit: this screen is about *what needs to be done today*,
 * not about vanity metrics. Every card here answers "is there something I
 * should act on?" and links directly to the filtered list that answers it.
 *
 * All counts run in one Promise.all so the page renders in a single round trip
 * to Postgres rather than a waterfall.
 */

export interface DashboardCard {
  key: string;
  label: string;
  value: number;
  href: string;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'critical';
  hint?: string;
}

export interface DashboardData {
  cards: DashboardCard[];
  todaysFollowUps: Awaited<ReturnType<typeof todaysFollowUpList>>;
  todaysTasks: Awaited<ReturnType<typeof todaysTaskList>>;
  attentionClients: Awaited<ReturnType<typeof attentionList>>;
  recentConversations: Awaited<ReturnType<typeof recentConversationList>>;
  generatedAt: Date;
}

export async function getDashboard(opts: { assignedUserId?: string | null } = {}): Promise<DashboardData> {
  const now = new Date();
  const dayStart = startOfDay(now);
  const dayEnd = endOfDay(now);

  // Scope everything to one user when "My work" is selected.
  const clientScope = opts.assignedUserId ? { assignedUserId: opts.assignedUserId } : {};
  const ownerScope = opts.assignedUserId ? { assignedUserId: opts.assignedUserId } : {};

  const [
    newLeadsToday,
    quotesRequested,
    quotesPending,
    quotesProvidedToday,
    followUpsRequired,
    readyToBind,
    waitingOnDocuments,
    policiesCompletedThisMonth,
    tasksDueToday,
    tasksOverdue,
    unreadConversations,
    highPriorityConversations,
    clientsNeedingAttention,
    pendingSuggestions,
    documentsAwaitingReview,
  ] = await Promise.all([
    db.client.count({
      where: { ...clientScope, createdAt: { gte: dayStart, lte: dayEnd } },
    }),

    db.client.count({
      where: { ...clientScope, isArchived: false, stage: { key: 'quote_requested' } },
    }),

    db.client.count({
      where: { ...clientScope, isArchived: false, stage: { key: 'quoting' } },
    }),

    db.quote.count({
      where: {
        sentToClientAt: { gte: dayStart, lte: dayEnd },
        ...(opts.assignedUserId ? { client: { assignedUserId: opts.assignedUserId } } : {}),
      },
    }),

    db.followUp.count({
      where: { ...ownerScope, status: 'SCHEDULED', dueAt: { lte: dayEnd } },
    }),

    db.client.count({
      where: { ...clientScope, isArchived: false, stage: { key: 'ready_to_bind' } },
    }),

    db.client.count({
      where: {
        ...clientScope,
        isArchived: false,
        checklistItems: { some: { required: true, status: { in: ['NOT_REQUESTED', 'REQUESTED'] } } },
        stage: { category: 'OPEN' },
      },
    }),

    db.policy.count({
      where: {
        status: 'ACTIVE',
        boundAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        ...(opts.assignedUserId ? { client: { assignedUserId: opts.assignedUserId } } : {}),
      },
    }),

    db.task.count({
      where: { ...ownerScope, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { gte: dayStart, lte: dayEnd } },
    }),

    db.task.count({
      where: { ...ownerScope, status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: dayStart } },
    }),

    db.conversation.count({
      where: {
        unreadCount: { gt: 0 },
        state: { not: 'CLOSED' },
        ...(opts.assignedUserId ? { client: { assignedUserId: opts.assignedUserId } } : {}),
      },
    }),

    db.conversation.count({
      where: {
        priority: { in: ['HIGH', 'URGENT'] },
        state: { not: 'CLOSED' },
        unreadCount: { gt: 0 },
        ...(opts.assignedUserId ? { client: { assignedUserId: opts.assignedUserId } } : {}),
      },
    }),

    db.client.count({ where: { ...clientScope, isArchived: false, needsAttention: true } }),

    countPendingSuggestions(),

    db.document.count({
      where: { verificationStatus: { in: ['UNVERIFIED', 'NEEDS_REVIEW'] }, processingStatus: 'PROCESSED' },
    }),
  ]);

  const cards: DashboardCard[] = [
    {
      key: 'new_leads_today',
      label: 'New leads today',
      value: newLeadsToday,
      href: '/clients?sort=created&createdFrom=today',
      tone: newLeadsToday > 0 ? 'success' : 'neutral',
    },
    {
      key: 'unread_conversations',
      label: 'Unread conversations',
      value: unreadConversations,
      href: '/conversations?filter=unread',
      tone: unreadConversations > 0 ? 'warning' : 'neutral',
      hint: highPriorityConversations > 0 ? `${highPriorityConversations} high priority` : undefined,
    },
    {
      key: 'tasks_overdue',
      label: 'Overdue tasks',
      value: tasksOverdue,
      href: '/tasks?bucket=overdue',
      tone: tasksOverdue > 0 ? 'critical' : 'neutral',
    },
    {
      key: 'tasks_today',
      label: 'Tasks due today',
      value: tasksDueToday,
      href: '/tasks?bucket=today',
      tone: tasksDueToday > 0 ? 'info' : 'neutral',
    },
    {
      key: 'follow_ups',
      label: 'Follow-ups required',
      value: followUpsRequired,
      href: '/follow-ups?bucket=today',
      tone: followUpsRequired > 0 ? 'warning' : 'neutral',
    },
    {
      key: 'ready_to_bind',
      label: 'Ready to bind',
      value: readyToBind,
      href: '/pipeline?stage=ready_to_bind',
      tone: readyToBind > 0 ? 'success' : 'neutral',
      hint: readyToBind > 0 ? 'Needs a licensed broker' : undefined,
    },
    {
      key: 'quotes_requested',
      label: 'Quotes requested',
      value: quotesRequested,
      href: '/pipeline?stage=quote_requested',
      tone: quotesRequested > 0 ? 'info' : 'neutral',
    },
    {
      key: 'quotes_pending',
      label: 'Quotes in progress',
      value: quotesPending,
      href: '/pipeline?stage=quoting',
      tone: 'neutral',
    },
    {
      key: 'quotes_provided_today',
      label: 'Quotes sent today',
      value: quotesProvidedToday,
      href: '/quotes',
      tone: 'neutral',
    },
    {
      key: 'waiting_documents',
      label: 'Waiting on documents',
      value: waitingOnDocuments,
      href: '/documents?filter=outstanding',
      tone: waitingOnDocuments > 0 ? 'warning' : 'neutral',
    },
    {
      key: 'documents_review',
      label: 'Documents to verify',
      value: documentsAwaitingReview,
      href: '/documents?filter=review',
      tone: documentsAwaitingReview > 0 ? 'info' : 'neutral',
    },
    {
      key: 'attention',
      label: 'Leads needing attention',
      value: clientsNeedingAttention,
      href: '/clients?needsAttention=true',
      tone: clientsNeedingAttention > 0 ? 'critical' : 'neutral',
    },
    {
      key: 'ai_suggestions',
      label: 'AI suggestions to review',
      value: pendingSuggestions,
      href: '/suggestions',
      tone: pendingSuggestions > 0 ? 'info' : 'neutral',
    },
    {
      key: 'policies_month',
      label: 'Policies completed this month',
      value: policiesCompletedThisMonth,
      href: '/policies',
      tone: 'success',
    },
  ];

  const [todaysFollowUps, todaysTasks, attentionClients, recentConversations] = await Promise.all([
    todaysFollowUpList(opts.assignedUserId),
    todaysTaskList(opts.assignedUserId),
    attentionList(opts.assignedUserId),
    recentConversationList(opts.assignedUserId),
  ]);

  return {
    cards,
    todaysFollowUps,
    todaysTasks,
    attentionClients,
    recentConversations,
    generatedAt: now,
  };
}

async function todaysFollowUpList(assignedUserId?: string | null) {
  return db.followUp.findMany({
    where: {
      status: 'SCHEDULED',
      dueAt: { lte: endOfDay(new Date()) },
      ...(assignedUserId ? { assignedUserId } : {}),
    },
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
    take: 8,
    include: {
      client: { select: { id: true, displayName: true, phone: true, unreadCount: true } },
    },
  });
}

async function todaysTaskList(assignedUserId?: string | null) {
  return db.task.findMany({
    where: {
      status: { in: ['OPEN', 'IN_PROGRESS'] },
      dueAt: { lte: endOfDay(new Date()) },
      ...(assignedUserId ? { assignedUserId } : {}),
    },
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
    take: 8,
    include: { client: { select: { id: true, displayName: true } } },
  });
}

async function attentionList(assignedUserId?: string | null) {
  return db.client.findMany({
    where: { needsAttention: true, isArchived: false, ...(assignedUserId ? { assignedUserId } : {}) },
    orderBy: { lastActivityAt: 'desc' },
    take: 8,
    include: { stage: { select: { name: true, color: true } } },
  });
}

async function recentConversationList(assignedUserId?: string | null) {
  return db.conversation.findMany({
    where: {
      unreadCount: { gt: 0 },
      state: { not: 'CLOSED' },
      ...(assignedUserId ? { client: { assignedUserId } } : {}),
    },
    orderBy: [{ priority: 'desc' }, { lastMessageAt: 'desc' }],
    take: 8,
    include: {
      client: { select: { id: true, displayName: true, phone: true } },
      messages: { orderBy: { sentAt: 'desc' }, take: 1, include: { analysis: true } },
    },
  });
}
