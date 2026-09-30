import { worldbank } from "./sources/worldbank.mjs";
const scope = process.argv[2] ?? "world"; // world | all
const regions = scope === "all" ? [null, ...(await worldbank.regions())] : [null];
let n = 0, bad = 0;
for (const ind of worldbank.indicators) for (const dir of ["DESC", "ASC"]) for (const region of regions) {
  const t = await worldbank.build({ indicator: ind, dir, region });
  if (!t) { bad++; if (scope === "world") console.log(`SKIP ${ind.id} ${dir}`); continue; }
  n++;
  console.log(`${t.title} :: ${t.items.map((i) => `${i.label}=${i.value}`).join(" | ")}  [${t.source.match(/\d{4}/)[0]}]`);
}
console.error(`usable=${n} unusable=${bad}`);
