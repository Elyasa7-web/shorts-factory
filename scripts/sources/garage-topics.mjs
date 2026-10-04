// Topic bank for "Canlı Garaj": cars, motorcycles and every other kind of vehicle.
// Every `wiki` entry is an English Wikipedia article title: the script is written ONLY from that article's text,
// so facts stay grounded. `tr` is the everyday Turkish name the narrator should use.
//
// Two kinds of videos:
//   parts      one part / system / vehicle, told from a rotating ANGLE (what it does, how it works, what happens
//              when it fails, surprising facts)  -> 4 different videos per topic
//   scenarios  a concrete question the viewer has always wondered about ("70 km/s giderken R'ye takarsan?")

const P = (category, rows) => rows.map(([wiki, tr]) => ({ kind: "part", category, wiki, tr }));

export const PARTS = [
  ...P("motor", [
    ["Internal combustion engine", "içten yanmalı motor"], ["Four-stroke engine", "dört zamanlı motor"],
    ["Two-stroke engine", "iki zamanlı motor"], ["Diesel engine", "dizel motor"], ["Wankel engine", "Wankel (döner) motor"],
    ["V8 engine", "V8 motor"], ["Straight-four engine", "sıralı dört silindirli motor"], ["Boxer engine", "boxer motor"],
    ["Piston", "piston"], ["Crankshaft", "krank mili"], ["Camshaft", "eksantrik mili"], ["Connecting rod", "biyel kolu"],
    ["Cylinder head", "silindir kapağı"], ["Head gasket", "silindir kapak contası"], ["Spark plug", "buji"],
    ["Fuel injection", "yakıt enjeksiyonu"], ["Carburetor", "karbüratör"], ["Turbocharger", "turbo"],
    ["Supercharger", "kompresör (süper şarj)"], ["Intercooler", "intercooler"], ["Catalytic converter", "katalitik konvertör"],
    ["Diesel particulate filter", "DPF (dizel partikül filtresi)"], ["Exhaust gas recirculation", "EGR"],
    ["Muffler", "susturucu"], ["Radiator (engine cooling)", "radyatör"], ["Thermostat", "termostat"],
    ["Timing belt (camshaft)", "triger kayışı"], ["Variable valve timing", "değişken supap zamanlaması"],
    ["Motor oil", "motor yağı"], ["Engine knocking", "motor vuruntusu"], ["Compression ratio", "sıkıştırma oranı"],
    ["Torque", "tork"], ["Horsepower", "beygir gücü"], ["Flywheel", "volan"], ["Throttle", "gaz kelebeği"],
    ["Rev limiter", "devir sınırlayıcı"], ["Glow plug", "kızdırma bujisi"], ["Fuel pump", "yakıt pompası"],
    ["Air filter", "hava filtresi"], ["Cylinder (engine)", "silindir"],
  ]),
  ...P("aktarma", [
    ["Manual transmission", "manuel şanzıman"], ["Automatic transmission", "otomatik şanzıman"],
    ["Continuously variable transmission", "CVT şanzıman"], ["Dual-clutch transmission", "çift kavramalı şanzıman"],
    ["Clutch", "debriyaj"], ["Torque converter", "tork konvertörü"], ["Differential (mechanical device)", "diferansiyel"],
    ["Drive shaft", "aks (kardan mili)"], ["Constant-velocity joint", "homokinetik mafsal (aks başlığı)"],
    ["Four-wheel drive", "dört çeker"], ["All-wheel drive", "AWD (tüm tekerlekten çekiş)"],
    ["Front-wheel drive", "önden çekiş"], ["Rear-wheel drive", "arkadan itiş"], ["Limited-slip differential", "kendinden kilitlemeli diferansiyel"],
    ["Synchromesh", "senkromeç"], ["Gear", "dişli"], ["Transmission (mechanics)", "şanzıman"], ["Transmission fluid", "şanzıman yağı"],
  ]),
  ...P("fren-suspansiyon", [
    ["Disc brake", "disk fren"], ["Drum brake", "kampanalı fren"], ["Brake pad", "fren balatası"],
    ["Anti-lock braking system", "ABS"], ["Electronic stability control", "ESP (denge kontrol)"],
    ["Traction control system", "çekiş kontrol sistemi"], ["Brake fluid", "fren hidroliği"], ["Shock absorber", "amortisör"], ["Suspension (vehicle)", "süspansiyon"], ["MacPherson strut", "McPherson (makferson) süspansiyon"],
    ["Leaf spring", "yaprak yay"], ["Anti-roll bar", "denge çubuğu"], ["Air suspension", "hava süspansiyon"],
    ["Power steering", "hidrolik/elektrikli direksiyon"], ["Rack and pinion", "kremayer direksiyon"], ["Tire", "lastik"], ["Alloy wheel", "alüminyum jant"], ["Tire-pressure monitoring system", "lastik basınç sensörü"],
    ["Run-flat tire", "patlak lastik (run-flat)"], ["Parking brake", "el freni"], ["Aquaplaning", "hidroplaning (su kayması)"],
  ]),
  ...P("elektrik-guvenlik", [
    ["Alternator", "alternatör"], ["Starter (engine)", "marş motoru"], ["Automotive battery", "akü"], ["Ignition system", "ateşleme sistemi"],
    ["Ignition coil", "ateşleme bobini"], ["Engine control unit", "motor beyni (ECU)"], ["On-board diagnostics", "OBD arıza teşhis"],
    ["Oxygen sensor", "oksijen sensörü (lambda)"], ["Mass flow sensor", "hava akış (debimetre) sensörü"], ["Cruise control", "hız sabitleyici"],
    ["Adaptive cruise control", "adaptif hız sabitleyici"], ["Airbag", "hava yastığı"], ["Seat belt", "emniyet kemeri"],
    ["Crumple zone", "çarpma bölgesi (ezilme zonu)"], ["Immobiliser", "immobilizer (çalıştırma engelleyici)"], ["CAN bus", "CAN bus"],
    ["Headlamp", "far"], ["Windscreen wiper", "silecek"], ["Lane departure warning system", "şerit takip sistemi"],
    ["Child safety seat", "çocuk koltuğu"], ["Roll cage", "roll-bar (koruma kafesi)"],
  ]),
  ...P("elektrikli", [
    ["Electric vehicle", "elektrikli araç"], ["Battery electric vehicle", "tam elektrikli araç"], ["Hybrid electric vehicle", "hibrit araç"],
    ["Plug-in hybrid", "şarj edilebilir hibrit"], ["Regenerative braking", "rejeneratif frenleme"], ["Electric motor", "elektrik motoru"],
    ["Lithium-ion battery", "lityum iyon pil"], ["Fuel cell vehicle", "yakıt hücreli araç"], ["Charging station", "şarj istasyonu"],
    ["Electric bicycle", "elektrikli bisiklet"], 
  ]),
  ...P("motosiklet", [
    ["Motorcycle", "motosiklet"], ["Chain drive", "zincirli çekiş"], ["Motorcycle fork", "ön çatal"], ["Motor scooter", "scooter"],
    ["Countersteering", "ters direksiyon (viraj tekniği)"], ["Cruiser (motorcycle)", "cruiser motosiklet"], ["Motorcycle helmet", "motosiklet kaskı"],
    ["Dirt bike", "enduro / cross motoru"], ["All-terrain vehicle", "ATV"], ["Moped", "moped"], ["Sport bike", "spor motosiklet"],
  ]),
  ...P("agir-vasita", [
    ["Semi-trailer truck", "tır"], ["Truck", "kamyon"], ["Bus", "otobüs"], ["Tractor", "traktör"], ["Excavator", "ekskavatör (kazıcı)"],
    ["Bulldozer", "dozer"], ["Forklift", "forklift"], ["Dump truck", "damperli kamyon"], ["Fire engine", "itfaiye aracı"],
    ["Ambulance", "ambulans"], ["Crane (machine)", "vinç"], ["Tow truck", "çekici"], ["Mobile crane", "mobil vinç"], ["Concrete mixer", "beton mikseri"],
  ]),
  ...P("diger-arac", [
    ["Airplane", "uçak"], ["Jet engine", "jet motoru"], ["Helicopter", "helikopter"], ["Steam locomotive", "buharlı lokomotif"],
    ["Diesel locomotive", "dizel lokomotif"], ["High-speed rail", "hızlı tren"], ["Ship", "gemi"], ["Submarine", "denizaltı"],
    ["Bicycle", "bisiklet"], ["Hovercraft", "hovercraft"], ["Hot air balloon", "sıcak hava balonu"], ["Formula One car", "Formula 1 aracı"],
    ["Go-kart", "go-kart"], ["Monster truck", "canavar kamyon"], ["Rallying", "ralli"], ["Tram", "tramvay"], ["Maglev", "manyetik levitasyonlu tren"],
    ["Snowmobile", "kar motosikleti"], ["Jet ski", "jet ski"], ["Segway", "Segway"],
  ]),
];

// angles rotate so one part gives several different videos
export const ANGLES = [
  { id: "purpose", brief: "what this is and what it is FOR in the vehicle: its job, explained so a complete beginner gets it" },
  { id: "how", brief: "HOW it works step by step: what moves, what pushes what, why it is built this way" },
  { id: "failure", brief: "what happens when it wears out or fails: the symptoms a driver notices and why it matters" },
  { id: "surprise", brief: "the most surprising, little-known facts and history about it (only facts from the source)" },
];

const S = (q, wiki) => ({ kind: "scenario", category: "senaryo", q, wiki: wiki[0], extra: wiki.slice(1) });

export const SCENARIOS = [
  S("Araç 70 km/s hızla giderken birden R (geri) vitesine takarsan ne olur?", ["Manual transmission", "Synchromesh"]),
  S("Otomatik araç giderken P (park) konumuna alırsan ne olur?", ["Automatic transmission", "Parking pawl"]),
  S("Motor yağı biterse motora ne olur?", ["Motor oil", "Internal combustion engine"]),
  S("Antifriz olmadan araç kullanırsan ne olur?", ["Antifreeze", "Radiator (engine cooling)"]),
  S("Triger kayışı sürerken kopsa ne olur?", ["Timing belt (camshaft)", "Interference engine"]),
  S("Debriyaja uzun süre yarım basılı tutarsan ne olur?", ["Clutch"]),
  S("Dizel araca yanlışlıkla benzin koyarsan ne olur?", ["Diesel engine", "Gasoline"]),
  S("Benzinli araca yanlışlıkla dizel koyarsan ne olur?", ["Gasoline", "Diesel fuel"]),
  S("Fren hidroliği biterse fren pedalı ne yapar?", ["Brake fluid", "Disc brake"]),
  S("ABS'li araçta sert fren yapınca pedal neden titrer?", ["Anti-lock braking system"]),
  S("Lastik havası çok azsa neler olur?", ["Tire", "Tire-pressure monitoring system"]),
  S("Turbolu motoru çalışır halde hemen kapatırsan ne olur?", ["Turbocharger", "Motor oil"]),
  S("Katalitik konvertör ne işe yarar, çıkarılırsa ne olur?", ["Catalytic converter"]),
  S("Akü bittiğinde araç çalışırken akü şarjını kim sağlar?", ["Automotive battery", "Alternator"]),
  S("Hava yastığı çarpışmada saniyenin kaçta biri içinde şişer?", ["Airbag"]),
  S("Aracı yokuşta el frenini çekmeden bırakırsan ne olur?", ["Parking brake", "Disc brake"]),
  S("Vites küçültünce motor freni araca nasıl yavaşlatır?", ["Engine braking", "Manual transmission"]),
  S("Elektrikli araçlar neden çok vitesli şanzıman kullanmaz?", ["Electric vehicle", "Electric motor"]),
  S("Motoru kırmızı çizgiye kadar zorlarsan ne olur?", ["Rev limiter", "Internal combustion engine"]),
  S("Rölanti nedir, durduğumuzda motor neden çalışmaya devam eder?", ["Idle speed", "Internal combustion engine"]),
  S("Dört çeker ile iki çeker arasındaki fark nedir?", ["Four-wheel drive", "Front-wheel drive"]),
  S("Diferansiyel olmasaydı araç virajı nasıl dönerdi?", ["Differential (mechanical device)"]),
  S("Amortisör olmasaydı araç yolda nasıl davranırdı?", ["Shock absorber", "Suspension (vehicle)"]),
  S("Egzozdaki susturucu ne yapar, olmasa ne olur?", ["Muffler"]),
  S("Hidrolik direksiyon olmasa direksiyon neden ağırlaşır?", ["Power steering"]),
  S("Hız sabitleyici (cruise control) nasıl çalışır?", ["Cruise control"]),
  S("Motosiklet virajda neden yatar?", ["Countersteering", "Motorcycle"]),
  S("CVT şanzıman vitessiz gibi nasıl çalışır?", ["Continuously variable transmission"]),
  S("Çift kavramalı şanzıman neden bu kadar hızlı vites değiştirir?", ["Dual-clutch transmission"]),
  S("Arkadan itişli araçlar neden spor sürüşte sevilir?", ["Rear-wheel drive", "Front-wheel drive"]),
  S("Marş motoru aracı çalıştırırken tam olarak ne yapar?", ["Starter (engine)", "Internal combustion engine"]),
  S("Soğuk havada dizel araç neden zor çalışır?", ["Glow plug", "Diesel engine"]),
  S("Yakıt filtresi tıkanırsa araç neden gücünü kaybeder?", ["Fuel pump", "Fuel injection"]),
  S("Şanzıman yağı hiç değişmezse ne olur?", ["Transmission fluid", "Automatic transmission"]),
  S("Lastik üzerindeki sayılar ne anlama gelir?", ["Tire code"]),
  S("Aerodinamik, aracın yakıt tüketimini nasıl etkiler?", ["Automobile drag coefficient", "Aerodynamics"]),
  S("Islak yolda aracın lastikleri neden suyun üstünde kayar?", ["Aquaplaning", "Tire"]),
  S("Yağ ikaz lambası yanınca yola devam edersen ne olur?", ["Motor oil", "Internal combustion engine"]),
  S("Neden bazı araçlar 4, bazıları 8 silindirli?", ["Straight-four engine", "V8 engine"]),
  S("Hibrit araç hem benzin hem elektrikle nasıl çalışır?", ["Hybrid electric vehicle", "Regenerative braking"]),
  S("Rejeneratif frenleme enerjiyi nasıl geri kazanır?", ["Regenerative braking", "Electric vehicle"]),
  S("Uçak koca gövdesiyle havada nasıl kalır?", ["Lift (force)", "Airplane"]),
  S("Jet motoru nasıl çalışır?", ["Jet engine"]),
  S("Denizaltı suyun altında nasıl dalar ve yüzeye çıkar?", ["Submarine", "Buoyancy"]),
  S("Tren raylardan neden çıkmaz?", ["Rail transport", "Flange"]),
  S("Formula 1 aracı neden bu kadar hızlı viraj alır?", ["Formula One car", "Downforce"]),
  S("Süper şarjlı ve turbolu motor arasındaki fark nedir?", ["Supercharger", "Turbocharger"]),
  S("Motor soğutma suyu kaynarsa ne yapmalı, neden olur?", ["Radiator (engine cooling)", "Thermostat"]),
  S("Bir aracın beygir gücü ile torku arasındaki fark nedir?", ["Horsepower", "Torque"]),
  S("Neden bazı araçların motoru arkada ya da ortada olur?", ["Rear-engine design", "Mid-engine design"]),
  S("Çarpma bölgeleri aracı sertleştirmek yerine neden ezilsin diye tasarlanır?", ["Crumple zone"]),
];

export const GARAGE_TOPICS = [...PARTS, ...SCENARIOS];
