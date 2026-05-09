export { primaryNav, topicTabs, type PrimaryNavItem } from "./discovery";

export const INITIAL_MOCK_BALANCE = 10_000;

export const categoryFallbackImages: Record<string, string> = {
  politics:
    "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=960&q=80",
  crypto:
    "https://images.unsplash.com/photo-1621504450181-5d356f61d307?auto=format&fit=crop&w=960&q=80",
  sports:
    "https://images.unsplash.com/photo-1461896836934-ffe607ba8211?auto=format&fit=crop&w=960&q=80",
  finance:
    "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=960&q=80",
  tech:
    "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=960&q=80",
  technology:
    "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=960&q=80",
  geopolitics:
    "https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=960&q=80",
  culture:
    "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=960&q=80",
  economy:
    "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=960&q=80",
  weather:
    "https://images.unsplash.com/photo-1504608524841-42fe6f032b4b?auto=format&fit=crop&w=960&q=80",
  elections:
    "https://images.unsplash.com/photo-1494172961521-33799ddd43a5?auto=format&fit=crop&w=960&q=80",
  business:
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=960&q=80",
  other:
    "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=960&q=80",
  markets:
    "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=960&q=80",
};

export const sharedFallbackImagePool = [
  "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=960&q=80",
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=960&q=80",
  "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=960&q=80",
  "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=960&q=80",
];

export const categoryFallbackImagePools: Record<string, string[]> = {
  politics: [
    categoryFallbackImages.politics,
    "https://images.unsplash.com/photo-1505664194779-8beaceb93744?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1575505586569-646b2ca898fc?auto=format&fit=crop&w=960&q=80",
  ],
  elections: [
    categoryFallbackImages.elections,
    "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1523292562811-8fa7962a78c8?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1580757468214-c73f7062a5cb?auto=format&fit=crop&w=960&q=80",
  ],
  crypto: [
    categoryFallbackImages.crypto,
    "https://images.unsplash.com/photo-1639322537228-f710d846310a?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1640340434855-6084b1f4901c?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1621761191319-c6fb62004040?auto=format&fit=crop&w=960&q=80",
  ],
  sports: [
    categoryFallbackImages.sports,
    "https://images.unsplash.com/photo-1508098682722-e99c643e7f0b?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1519861531473-9200262188bf?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1505843279827-4b4a25ca1b3b?auto=format&fit=crop&w=960&q=80",
  ],
  finance: [
    categoryFallbackImages.finance,
    "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=960&q=80",
  ],
  tech: [
    categoryFallbackImages.tech,
    "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1535223289827-42f1e9919769?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=960&q=80",
  ],
  technology: [
    categoryFallbackImages.technology,
    "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1535223289827-42f1e9919769?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=960&q=80",
  ],
  geopolitics: [
    categoryFallbackImages.geopolitics,
    "https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1575505586569-646b2ca898fc?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1541872703-74c5e44368f9?auto=format&fit=crop&w=960&q=80",
  ],
  culture: [
    categoryFallbackImages.culture,
    "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1501612780327-45045538702b?auto=format&fit=crop&w=960&q=80",
  ],
  economy: [
    categoryFallbackImages.economy,
    "https://images.unsplash.com/photo-1554224154-26032ffc0d07?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1543286386-713bdd548da4?auto=format&fit=crop&w=960&q=80",
  ],
  weather: [
    categoryFallbackImages.weather,
    "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1428592953211-077101b2021b?auto=format&fit=crop&w=960&q=80",
  ],
  business: [
    categoryFallbackImages.business,
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=960&q=80",
    "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=960&q=80",
  ],
  other: [categoryFallbackImages.other, ...sharedFallbackImagePool],
  markets: [categoryFallbackImages.markets, ...sharedFallbackImagePool],
};
