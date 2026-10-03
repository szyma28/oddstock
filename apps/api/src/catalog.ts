export type DemoProduct = {
  id: string;
  name: string;
  category: string;
  description: string;
  pricePence: number;
  palette: string;
  symbol: string;
  image?: string;
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
    image: "/odd-spoon.jpg",
  },
  {
    id: "odd-02",
    name: "A pebble with big plans",
    category: "Home",
    description: "Currently has no plans, but it is open to offers.",
    pricePence: 100,
    palette: "blue",
    symbol: "●",
    image: "/ambitious-pebble.jpg",
  },
  {
    id: "odd-03",
    name: "Mug of mild suspicion",
    category: "Home",
    description: "Looks like it knows what you did. Probably just wants tea.",
    pricePence: 650,
    palette: "lemon",
    symbol: "◉",
    image: "/suspicious-mug.jpg",
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
  {
    id: "odd-05",
    name: "Jar of Tuesday’s weather",
    category: "Home",
    description: "Contains one small cloud and a forecast of damp, emotionally.",
    pricePence: 475,
    palette: "blue",
    symbol: "☂",
    image: "/tuesday-weather.jpg",
  },
  {
    id: "odd-06",
    name: "Chair for an invisible dinner guest",
    category: "Home",
    description: "They said they were five minutes away. That was last Thursday.",
    pricePence: 2400,
    palette: "green",
    symbol: "⌂",
    image: "/empty-chair.jpg",
  },
  {
    id: "odd-07",
    name: "Receipt for one unseen ghost",
    category: "Paper",
    description: "Proof of purchase. The ghost denies everything.",
    pricePence: 125,
    palette: "rose",
    symbol: "▤",
    image: "/ghost-receipt.jpg",
  },
  {
    id: "odd-08",
    name: "Key to a door that isn’t built yet",
    category: "Home",
    description: "Keep it somewhere safe. The door could turn up any day.",
    pricePence: 325,
    palette: "clay",
    symbol: "⌘",
  },
  {
    id: "odd-09",
    name: "Pigeon-drafted city plan",
    category: "Art",
    description: "Excellent squares. Several notes about chips. No public transport.",
    pricePence: 850,
    palette: "blue",
    symbol: "▧",
  },
  {
    id: "odd-10",
    name: "Left glove with an airtight alibi",
    category: "Wear",
    description: "Has never met the right glove. Claims to have been at home.",
    pricePence: 375,
    palette: "rose",
    symbol: "◒",
  },
  {
    id: "odd-11",
    name: "Emergency bell for postponing meetings",
    category: "Home",
    description: "One ring buys you three minutes and a vague look at the ceiling.",
    pricePence: 1100,
    palette: "lemon",
    symbol: "◉",
  },
  {
    id: "odd-12",
    name: "A map of the bit behind the fridge",
    category: "Art",
    description: "Includes two lost peas, a mystery coin and one old shopping list.",
    pricePence: 675,
    palette: "green",
    symbol: "▧",
  },
  {
    id: "odd-13",
    name: "Small rock, available for comment",
    category: "Home",
    description: "Has strong views on the local planning application. Won’t elaborate.",
    pricePence: 225,
    palette: "clay",
    symbol: "●",
  },
  {
    id: "odd-14",
    name: "A certificate saying ‘probably fine’",
    category: "Paper",
    description: "Official-looking enough to calm a houseplant. Not legally binding.",
    pricePence: 250,
    palette: "lemon",
    symbol: "▤",
  },
];

export const products: DemoProduct[] = [...everydayProducts, ...oddities];
