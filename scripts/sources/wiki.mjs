// Evergreen, broad-appeal story topics, grounded in the real Wikipedia article text.
// No living people (defamation / sensitivity), no current politics. Every topic is a Wikipedia title.
const CATEGORIES = {
  space: [
    "Black hole", "Neutron star", "Voyager 1", "Mars", "Venus", "Saturn", "Jupiter", "Pluto", "Moon", "Sun",
    "Milky Way", "Andromeda Galaxy", "Big Bang", "Dark matter", "Supernova", "Comet", "Asteroid belt",
    "International Space Station", "Apollo 11", "Hubble Space Telescope", "James Webb Space Telescope",
    "Europa (moon)", "Titan (moon)", "Enceladus", "Event horizon", "Pulsar", "Quasar", "Solar flare",
    "Aurora", "Solar eclipse", "Great Red Spot", "Voyager Golden Record", "Apollo 13", "Sputnik 1",
    "Cosmic microwave background", "Exoplanet", "Kuiper belt", "Olympus Mons", "Betelgeuse", "Sagittarius A*",
  ],
  animals: [
    "Octopus", "Blue whale", "Tardigrade", "Mantis shrimp", "Axolotl", "Honey bee", "Platypus",
    "Turritopsis dohrnii", "Naked mole-rat", "Peregrine falcon", "Giant squid", "Komodo dragon", "Narwhal",
    "Pistol shrimp", "Electric eel", "Chameleon", "Sloth", "Emperor penguin", "Cheetah", "African elephant",
    "Crow", "Bottlenose dolphin", "Vampire bat", "Polar bear", "Anglerfish", "Hummingbird", "Monarch butterfly",
    "Leafcutter ant", "Termite", "Pigeon", "Orca", "Great white shark", "Wolf", "Owl", "Seahorse", "Cuttlefish",
    "Bombardier beetle", "Arctic tern", "Coelacanth", "Horseshoe crab",
  ],
  body: [
    "Human brain", "Human heart", "Immune system", "DNA", "Sleep", "Memory", "Human eye", "Human skin",
    "Gut microbiota", "Blood", "Human skeleton", "Neuron", "Placebo", "Circadian rhythm", "Dreaming",
    "Taste", "Human ear", "Adrenaline", "Fingerprint", "Lung",
  ],
  history: [
    "Great Pyramid of Giza", "Great Wall of China", "Machu Picchu", "Stonehenge", "Colosseum", "Petra",
    "Moai", "Titanic", "Pompeii", "Terracotta Army", "Library of Alexandria", "Antikythera mechanism",
    "Rosetta Stone", "Black Death", "Vikings", "Silk Road", "Angkor Wat", "Chichen Itza", "Göbekli Tepe",
    "Hagia Sophia", "Chernobyl disaster", "Great Fire of London", "1883 eruption of Krakatoa", "Hanging Gardens of Babylon",
    "Pantheon, Rome", "Parthenon", "Tutankhamun", "Cleopatra", "Genghis Khan", "Julius Caesar", "Hadrian's Wall",
    "Lascaux", "Catalhoyuk", "Mohenjo-daro", "Mongol Empire", "Byzantine Empire", "Ancient Egypt",
  ],
  earth: [
    "Mount Everest", "Amazon rainforest", "Sahara", "Great Barrier Reef", "Mariana Trench", "Dead Sea",
    "Niagara Falls", "Antarctica", "Yellowstone Caldera", "Lightning", "Tornado", "Hurricane", "Volcano",
    "Earthquake", "Glacier", "Bioluminescence", "Lake Baikal", "Grand Canyon", "Victoria Falls", "Salar de Uyuni",
    "Mount Vesuvius", "Aurora borealis", "Tsunami", "Atacama Desert", "Greenland ice sheet",
  ],
  science: [
    "Quantum entanglement", "Time dilation", "Higgs boson", "Periodic table", "Antimatter", "Fibonacci sequence",
    "Pi", "Speed of light", "GPS", "Transistor", "Nuclear fusion", "Superconductivity", "Graphene",
    "Enigma machine", "Tesla coil", "Schrödinger's cat", "Double-slit experiment", "Entropy", "Absolute zero",
    "Radioactive decay", "Plate tectonics", "Photosynthesis", "Placenta", "Penicillin", "Printing press",
  ],
  mysteries: [
    "Bermuda Triangle", "Loch Ness Monster", "Voynich manuscript", "Dyatlov Pass incident", "Roanoke Colony",
    "Mary Celeste", "Nazca Lines", "Wow! signal", "Tunguska event", "Oak Island", "Piri Reis map",
    "Sailing stones", "Baigong Pipes", "Lost city of Atlantis", "Zodiac Killer", "Bell Witch", "Ghost ship",
    "Great Pyramid construction", "Taos Hum", "Antikythera",
  ],
};

export const STORY_TOPICS = Object.entries(CATEGORIES).flatMap(([category, titles]) =>
  titles.map((title) => ({ title, category }))
);

const UA = "shorts-factory/1.0 (personal educational project)";

// Plain-text article body (first ~3500 characters), straight from Wikipedia.
export async function fetchSource(title, chars = 3800) {
  const url =
    "https://en.wikipedia.org/w/api.php?" +
    new URLSearchParams({
      action: "query",
      prop: "extracts|pageprops",
      explaintext: "1",
      exchars: String(chars),
      redirects: "1",
      titles: title,
      format: "json",
      formatversion: "2",
    });
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const page = (await res.json()).query?.pages?.[0];
  const text = (page?.extract ?? "").replace(/\n{2,}/g, "\n").trim();
  if (!page || page.missing || text.length < 800) throw new Error(`article too short: ${title}`);
  return {
    title: page.title,
    text,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
  };
}
