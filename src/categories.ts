import type { NormalizedCategory, PolymarketMarket } from "./types.js";

type CategoryDefinition = Omit<NormalizedCategory, "id" | "description"> & {
  aliases: string[];
};

const categoryDefinitions = [
  {
    slug: "politics",
    label: "Politics",
    title_ar: null,
    keywords: ["politics", "political", "congress", "senate", "president", "government"],
    aliases: ["political"],
    image: "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "sports",
    label: "Sports",
    title_ar: null,
    keywords: ["sports", "nba", "nfl", "nhl", "mlb", "soccer", "cup", "match", "league"],
    aliases: ["sport"],
    image: "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "crypto",
    label: "Crypto",
    title_ar: null,
    keywords: ["crypto", "bitcoin", "btc", "ethereum", "eth", "solana", "token"],
    aliases: ["cryptocurrency", "web3"],
    image: "https://images.unsplash.com/photo-1621504450181-5d356f61d307?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "tech",
    label: "Tech",
    title_ar: null,
    keywords: ["tech", "technology", "ai", "openai", "gpt", "model", "apple", "tesla"],
    aliases: ["technology", "ai"],
    image: "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "finance",
    label: "Finance",
    title_ar: null,
    keywords: ["finance", "fed", "rate", "stocks", "stock", "inflation", "oil", "gold"],
    aliases: ["financial", "markets"],
    image: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "geopolitics",
    label: "Geopolitics",
    title_ar: null,
    keywords: ["geopolitics", "iran", "china", "tariff", "sanction", "treaty", "nato"],
    aliases: ["geopolitical", "world"],
    image: "https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "culture",
    label: "Culture",
    title_ar: null,
    keywords: ["culture", "movie", "film", "music", "album", "artist", "box office"],
    aliases: ["entertainment"],
    image: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "economy",
    label: "Economy",
    title_ar: null,
    keywords: ["economy", "economic", "gdp", "recession", "jobs", "unemployment", "cpi"],
    aliases: ["macro"],
    image: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "weather",
    label: "Weather",
    title_ar: null,
    keywords: ["weather", "temperature", "rain", "storm", "hurricane", "climate"],
    aliases: ["climate"],
    image: "https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "elections",
    label: "Elections",
    title_ar: null,
    keywords: ["election", "elections", "vote", "poll", "ballot", "primary"],
    aliases: ["election"],
    image: "https://images.unsplash.com/photo-1494172961521-33799ddd43a5?auto=format&fit=crop&w=960&q=80",
  },
  {
    slug: "other",
    label: "Other",
    title_ar: null,
    keywords: ["other"],
    aliases: ["business", "market", "markets", "misc"],
    image: "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=960&q=80",
  },
] satisfies CategoryDefinition[];

const fallbackCategory = categoryDefinitions[categoryDefinitions.length - 1];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getCategories(): NormalizedCategory[] {
  return categoryDefinitions.map(({ aliases: _aliases, ...category }) => ({
    ...category,
    id: category.slug,
    description: null,
  }));
}

export function getCategoryBySlug(slug: string | null | undefined) {
  if (!slug) {
    return null;
  }

  const normalizedSlug = slugify(slug);
  return (
    categoryDefinitions.find((category) => category.slug === normalizedSlug) ??
    categoryDefinitions.find((category) =>
      [...category.aliases, ...category.keywords].some(
        (keyword) => slugify(keyword) === normalizedSlug,
      ),
    ) ??
    null
  );
}

export function inferCategory(market: Pick<PolymarketMarket, "category" | "question" | "description">) {
  const rawCategory = market.category?.trim();
  const directCategory = rawCategory ? getCategoryBySlug(rawCategory) : null;
  if (directCategory) {
    return directCategory;
  }

  const text = `${rawCategory ?? ""} ${market.question ?? ""} ${market.description ?? ""}`.toLowerCase();
  return (
    categoryDefinitions.find((category) =>
      category.keywords.some((keyword) => text.includes(keyword)),
    ) ?? fallbackCategory
  );
}

export function inferTopics(
  market: Pick<PolymarketMarket, "category" | "question" | "description">,
): string[] {
  const text = `${market.category ?? ""} ${market.question ?? ""} ${market.description ?? ""}`.toLowerCase();
  const category = inferCategory(market);
  const topics = new Set<string>([category.slug]);

  for (const definition of categoryDefinitions) {
    if (definition.slug === "other") {
      continue;
    }

    if (definition.keywords.some((keyword) => text.includes(keyword))) {
      topics.add(definition.slug);
    }
  }

  return [...topics].slice(0, 5);
}

export function normalizeCategoryValue(value: string | null | undefined): string | null {
  const category = getCategoryBySlug(value);
  return category?.slug ?? (value ? slugify(value) : null);
}

export function getCategoryImage(value: string | null | undefined) {
  return (getCategoryBySlug(value) ?? fallbackCategory).image;
}
