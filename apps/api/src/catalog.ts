export type DemoProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  pricePence: number;
  palette: string;
  symbol: string;
};

// A tiny seeded generator keeps synthetic listings varied but repeatable between restarts.
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const random = makeRandom(20261003);
const pick = <T,>(values: T[]) => values[Math.floor(random() * values.length)]!;
const usedNames = new Set<string>();
const listingIdeas = [
  { category: "Home", nouns: ["Stoneware Mug", "Table Vase", "Desk Lamp", "Linen Throw"], notes: ["Made for daily use, with small variations in the finish.", "A straightforward shape that works on a shelf or table.", "Useful at home, without much fuss."], symbols: ["◉", "♧", "✳"] },
  { category: "Wear", nouns: ["Canvas Tote", "Cotton Cap", "Everyday Scarf", "Tool Pouch"], notes: ["Lightweight, sturdy and ready for regular use.", "An easy fit for a day out or the weekly shop.", "A practical piece with a bit of colour."], symbols: ["▧", "⌒", "◒"] },
  { category: "Art", nouns: ["Coast Print", "Botanical Print", "Abstract Print", "Postcard Set"], notes: ["Printed on uncoated paper, ready to frame or pin up.", "A small print for a wall, shelf or noticeboard.", "A short-run design on good quality paper."], symbols: ["◒", "✿", "▧"] },
  { category: "Paper", nouns: ["Plain Notebook", "Pocket Journal", "Desk Pad", "List Book"], notes: ["Uncoated pages for notes, lists or sketches.", "A simple notebook that travels well.", "Room for the things you need to remember."], symbols: ["▤", "▧", "✳"] },
  { category: "Care", nouns: ["Hand Soap", "Citrus Bath Soak", "Hand Balm", "Body Oil"], notes: ["A fresh citrus scent for everyday use.", "Made in small batches with a short ingredient list.", "A simple addition to the bathroom shelf."], symbols: ["✿", "◉", "♧"] },
];
const palettes = ["clay", "lemon", "blue", "rose", "mint", "lavender", "yellow", "green"];
const prices: Record<string, [number, number]> = {
  Home: [900, 4500], Wear: [800, 3200], Art: [700, 2800], Paper: [500, 1800], Care: [600, 2000],
};

const everydayProducts: DemoProduct[] = Array.from({ length: 12 }, (_, index) => {
  const idea = listingIdeas[index % listingIdeas.length]!;
  const name = pick(idea.nouns.filter((noun) => !usedNames.has(noun)));
  usedNames.add(name);
  const [minimum, maximum] = prices[idea.category]!;
  return {
    id: `find-${String(index + 1).padStart(2, "0")}`,
    name,
    category: idea.category,
    description: pick(idea.notes),
    pricePence: Math.round((minimum + random() * (maximum - minimum)) / 50) * 50,
    palette: pick(palettes),
    symbol: pick(idea.symbols),
  };
});

const oddities: DemoProduct[] = [
  {
    id: "odd-01",
    name: "Spoon, allegedly 1,000 years old",
    category: "Home",
    description: "May be from 1026. May be from the back of a drawer. Still stirs tea.",
    pricePence: 350,
    palette: "clay",
    symbol: "⌁",
  },
  {
    id: "odd-02",
    name: "A pebble with big plans",
    category: "Home",
    description: "Currently has no plans, but it is open to offers.",
    pricePence: 100,
    palette: "blue",
    symbol: "●",
  },
  {
    id: "odd-03",
    name: "Mug of mild suspicion",
    category: "Home",
    description: "Looks like it knows what you did. Probably just wants tea.",
    pricePence: 650,
    palette: "lemon",
    symbol: "◉",
  },
  {
    id: "odd-04",
    name: "Notebook of unfinished business",
    category: "Paper",
    description: "A fresh start, with several blank pages and absolutely no judgement.",
    pricePence: 500,
    palette: "rose",
    symbol: "▤",
  },
];

export const products: DemoProduct[] = [...everydayProducts, ...oddities];
