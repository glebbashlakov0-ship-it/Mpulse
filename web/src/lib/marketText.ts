const exactTextTranslations = new Map<string, string>([
  ["англия", "England"],
  ["испания", "Spain"],
  ["какая страна выиграет чемпионат мира 2026?", "Which country will win the 2026 World Cup?"],
  ["португалия", "Portugal"],
  ["франция", "France"],
]);

const phraseTextTranslations: Array<[RegExp, string]> = [
  [/Какая страна выиграет/gi, "Which country will win"],
  [/Чемпионат мира/gi, "World Cup"],
  [/Испания/g, "Spain"],
  [/Франция/g, "France"],
  [/Англия/g, "England"],
  [/Португалия/g, "Portugal"],
];

export function formatMarketText(value: string | null | undefined) {
  const text = value?.trim() ?? "";

  if (!text) {
    return "";
  }

  const exact = exactTextTranslations.get(text.toLowerCase());

  if (exact) {
    return exact;
  }

  return phraseTextTranslations.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}
