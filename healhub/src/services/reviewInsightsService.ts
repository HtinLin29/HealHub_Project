/**
 * Rule-based insights from customer review text (no external AI).
 * Use for owner Surveys / feedback — themes, priorities, suggested actions.
 */

export type InsightPriority = 'high' | 'medium' | 'low';

export interface ReviewInsight {
  id: string;
  priority: InsightPriority;
  kind: 'action' | 'positive' | 'info';
  title: string;
  detail: string;
  /** How many reviews in the current set matched this theme */
  mentionCount: number;
  /** Average star rating among matching reviews */
  avgRating: number;
  /** Short quotes (truncated) for context */
  snippets: string[];
}

type ThemeKind = 'pain' | 'praise';

interface ThemeRule {
  id: string;
  kind: ThemeKind;
  /** Substrings to match (lowercase) */
  keywords: string[];
  titlePain: string;
  detailPain: string;
  titlePraise: string;
  detailPraise: string;
}

const THEMES: ThemeRule[] = [
  {
    id: 'delivery',
    kind: 'pain',
    keywords: [
      'delivery',
      'shipping',
      'courier',
      'arrived late',
      'late delivery',
      'delayed',
      'did not arrive',
      'tracking',
      'lost package',
      'parcel',
    ],
    titlePain: 'Shipping & delivery',
    detailPain:
      'Reviewers mention delivery or shipping. Audit carrier performance, packing, and proactive delay notifications.',
    titlePraise: 'Delivery experience',
    detailPraise:
      'Customers highlight positive delivery — keep communicating timelines and packaging quality.',
  },
  {
    id: 'quality',
    kind: 'pain',
    keywords: [
      'quality',
      'defective',
      'damaged',
      'broken',
      'expired',
      'expiry',
      'batch',
      'counterfeit',
      'fake',
      'seal broken',
      'wrong item',
    ],
    titlePain: 'Product quality & condition',
    detailPain:
      'Feedback points to quality or condition issues. Check storage, suppliers, and inbound QC; review return reasons.',
    titlePraise: 'Product quality',
    detailPraise: 'Customers praise product condition or quality — maintain supplier standards and batch checks.',
  },
  {
    id: 'price',
    kind: 'pain',
    keywords: ['expensive', 'overpriced', 'price', 'cost', 'cheap', 'affordable', 'value for money', 'pricing', 'worth it', 'not worth'],
    titlePain: 'Price & value perception',
    detailPain:
      'Price or value comes up often. Compare to market, clarify benefits on the product page, or test bundles/loyalty.',
    titlePraise: 'Value for money',
    detailPraise: 'Customers feel they get good value — reinforce this in marketing and bundles.',
  },
  {
    id: 'service',
    kind: 'pain',
    keywords: [
      'staff',
      'service',
      'rude',
      'helpful',
      'support',
      'customer service',
      'response',
      'chat',
      'email',
      'phone',
    ],
    titlePain: 'Customer service & support',
    detailPain:
      'Service-related language appears. Train on tone and speed; publish clear contact and FAQ for common issues.',
    titlePraise: 'Helpful service',
    detailPraise: 'Positive notes on support — capture testimonials and keep response times consistent.',
  },
  {
    id: 'efficacy',
    kind: 'pain',
    keywords: [
      'works',
      'working',
      'effective',
      'helped',
      "didn't work",
      'does not work',
      'no effect',
      'useless',
      'waste of',
    ],
    titlePain: 'Effectiveness expectations',
    detailPain:
      'Reviews discuss whether the product worked. Align descriptions with realistic outcomes; link to usage instructions.',
    titlePraise: 'Effectiveness',
    detailPraise: 'Customers report good results — consider case studies or “as directed” reminders on packaging.',
  },
  {
    id: 'packaging',
    kind: 'pain',
    keywords: ['packaging', 'bottle', 'box', 'label', 'cap', 'leak', 'spill'],
    titlePain: 'Packaging & labeling',
    detailPain:
      'Packaging or labeling feedback. Review seals, legibility, and leak-proofing for liquids.',
    titlePraise: 'Packaging',
    detailPraise: 'Praise for packaging — maintain materials and clarity of directions.',
  },
  {
    id: 'safety',
    kind: 'pain',
    keywords: [
      'side effect',
      'allergic',
      'allergy',
      'reaction',
      'nausea',
      'rash',
      'dizzy',
      'consult',
      'doctor',
    ],
    titlePain: 'Safety & side effects',
    detailPain:
      'Health-related concerns appear. Ensure warnings match regulations; encourage consulting a professional when appropriate.',
    titlePraise: 'Safety',
    detailPraise: 'Customers mention safety positively — keep contraindications visible and accurate.',
  },
];

const PRAISE_ONLY: ThemeRule = {
  id: 'praise_general',
  kind: 'praise',
  keywords: [
    'great',
    'excellent',
    'amazing',
    'love it',
    ' loved',
    'love this',
    'thank',
    'perfect',
    'highly recommend',
    'five star',
    '5 star',
    '⭐',
    'best ',
    'awesome',
    'fantastic',
  ],
  titlePain: '',
  detailPain: '',
  titlePraise: 'Overall satisfaction',
  detailPraise: 'Strong positive sentiment in comments — leverage reviews on product pages and social proof.',
};

function id(): string {
  return `ins-${Math.random().toString(36).slice(2, 11)}`;
}

function truncate(s: string, max = 120): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function matchesTheme(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

function priorityForPain(count: number, avgRating: number): InsightPriority {
  if (count >= 3 && avgRating < 4) return 'high';
  if (count >= 2 && avgRating <= 3.5) return 'high';
  if (avgRating <= 3 && count >= 1) return 'high';
  if (count >= 2 || avgRating < 3.5) return 'medium';
  return 'low';
}

export interface ReviewForInsight {
  rating: number;
  comment: string | null;
}

/**
 * Build prioritized insights from reviews that have comment text.
 * Pass the same filtered list as shown in the Surveys UI.
 */
export function buildReviewInsights(reviews: ReviewForInsight[]): {
  insights: ReviewInsight[];
  summary: string | null;
  topThemeLabel: string | null;
} {
  const withText = reviews.filter((r) => r.comment && String(r.comment).trim());
  if (withText.length === 0) {
    return {
      insights: [
        {
          id: id(),
          priority: 'low',
          kind: 'info',
          title: 'Not enough written feedback yet',
          detail:
            'Recommendations use keywords in review comments. Encourage customers to add a short note with their star rating.',
          mentionCount: 0,
          avgRating: 0,
          snippets: [],
        },
      ],
      summary: null,
      topThemeLabel: null,
    };
  }

  type Match = { rating: number; comment: string };
  const byTheme = new Map<string, Match[]>();

  for (const r of withText) {
    const comment = String(r.comment);
    for (const theme of THEMES) {
      if (!matchesTheme(comment, theme.keywords)) continue;
      const list = byTheme.get(theme.id) ?? [];
      list.push({ rating: r.rating, comment });
      byTheme.set(theme.id, list);
    }
    if (matchesTheme(comment, PRAISE_ONLY.keywords)) {
      const list = byTheme.get(PRAISE_ONLY.id) ?? [];
      list.push({ rating: r.rating, comment });
      byTheme.set(PRAISE_ONLY.id, list);
    }
  }

  const insights: ReviewInsight[] = [];

  for (const theme of THEMES) {
    const matches = byTheme.get(theme.id);
    if (!matches?.length) continue;

    const sum = matches.reduce((s, m) => s + m.rating, 0);
    const avgRating = sum / matches.length;
    const snippets = matches.slice(0, 2).map((m) => truncate(m.comment));

    if (theme.kind === 'pain') {
      const isPraiseSignal = avgRating >= 4.2 && matches.length >= 1;
      if (isPraiseSignal && matches.some((m) => m.rating >= 4)) {
        insights.push({
          id: id(),
          priority: 'low',
          kind: 'positive',
          title: theme.titlePraise,
          detail: theme.detailPraise,
          mentionCount: matches.length,
          avgRating,
          snippets,
        });
      } else {
        insights.push({
          id: id(),
          priority: priorityForPain(matches.length, avgRating),
          kind: 'action',
          title: theme.titlePain,
          detail: theme.detailPain,
          mentionCount: matches.length,
          avgRating,
          snippets,
        });
      }
    }
  }

  const praiseMatches = byTheme.get(PRAISE_ONLY.id);
  if (praiseMatches?.length) {
    const sum = praiseMatches.reduce((s, m) => s + m.rating, 0);
    const avgRating = sum / praiseMatches.length;
    const snippets = praiseMatches.slice(0, 2).map((m) => truncate(m.comment));
    insights.push({
      id: id(),
      priority: avgRating >= 4.5 ? 'low' : 'medium',
      kind: 'positive',
      title: PRAISE_ONLY.titlePraise,
      detail: PRAISE_ONLY.detailPraise,
      mentionCount: praiseMatches.length,
      avgRating,
      snippets,
    });
  }

  // Dedupe: same theme might appear twice if we added both pain and praise paths — THEMES don't double-add praise_general
  // Sort: action high > medium > positive > info; then by mentionCount
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const kindOrder = { action: 0, positive: 1, info: 2 };

  insights.sort((a, b) => {
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    if (a.priority !== b.priority) return priorityOrder[a.priority] - priorityOrder[b.priority];
    return b.mentionCount - a.mentionCount;
  });

  // If no theme matched at all (unusual text)
  if (insights.length === 0) {
    insights.push({
      id: id(),
      priority: 'low',
      kind: 'info',
      title: 'No clear theme yet',
      detail:
        'Comments did not match common topics (delivery, quality, price, etc.). Read the list below or use search to spot patterns.',
      mentionCount: withText.length,
      avgRating: withText.reduce((s, r) => s + r.rating, 0) / withText.length,
      snippets: withText.slice(0, 2).map((r) => truncate(String(r.comment))),
    });
  }

  const capped = insights.slice(0, 8);

  const actionInsights = capped.filter((i) => i.kind === 'action');
  const top = actionInsights[0] ?? capped[0];
  const summary = `Analyzed ${withText.length} comment${withText.length === 1 ? '' : 's'} in this view`;
  const topThemeLabel =
    top && top.kind === 'action' ? `${top.title} (${top.mentionCount} mention${top.mentionCount === 1 ? '' : 's'})` : null;

  return { insights: capped, summary, topThemeLabel };
}
