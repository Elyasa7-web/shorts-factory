// Snapshots every currently valid World Bank topic into data/topic-bank.json.
// generate-topic.mjs falls back to this bank when the live APIs are unreachable,
// so a Wikidata / World Bank outage can never stop the upload schedule.
import { writeFileSync } from "node:fs";
import { worldbank } from "./sources/worldbank.mjs";

const regions = [null, ...(await worldbank.regions())];
const bank = [];
for (const indicator of worldbank.indicators)
  for (const dir of ["DESC", "ASC"])
    for (const region of regions) {
      const t = await worldbank.build({ indicator, dir, region });
      if (t) bank.push({ ...t, snapshotAt: new Date().toISOString() });
    }
writeFileSync("data/topic-bank.json", JSON.stringify(bank));
console.log(`bank: ${bank.length} topics`);
